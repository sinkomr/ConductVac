import type {
  EngineSystemSpec, EventLogEntry, SimEvent, SimEventAction, SimSnapshot,
} from '../types';
import { buildNetwork, type Net } from './network';
import { BandMatrix } from './lin';
import { compileConductance } from './conductance';
import {
  BAKE_DOSE_MIN_C, BAKE_DOSE_REF_C, BAKE_DOSE_TARGET, T0K, TAU_COOL, TAU_HEAT, rampTo,
} from './thermal';
import { MATERIALS } from '../data/materials';
import { P_SAT_H2O_20C, pSatH2O } from '../data/gases';

/**
 * Numerical core (§1.6) — backward Euler with Newton iteration, integrating
 * u = ln(p) per node per species (guarantees positivity across 12 decades).
 *
 * Species are uncoupled through the network: conductances couple nodes, not
 * species, so each species' network is solved independently per step.
 * Everything that depends on TOTAL pressure (Knudsen conductances, pump
 * rolloff/critical-backing factors) is frozen at the step's start state and
 * refreshed in up-to-`maxOuter` outer iterations against the new totals —
 * a lagged-coefficient scheme whose error is controlled by the adaptive
 * timestep below.
 *
 * A key property of integrating in u: pure exponential decay (constant
 * du/dt) is reproduced EXACTLY at any dt, so pump-downs cost few steps.
 *
 * Jacobian: graph-Laplacian structure from edges plus 2×2 pump
 * inlet↔backing blocks; assembled banded after RCM ordering (lin.ts) and
 * factorized without pivoting (strongly diagonally dominant).
 *
 * Adaptive dt: starts at 1 ms after events; grows ×1.5 when Newton converges
 * in ≤3 iterations and the local-error estimate (BDF-style, from the
 * previous step's increment) is small; shrinks ×4 on Newton failure, ×2 on
 * error rejection; capped at dtMax (10 s live, raised for fast-forward).
 * Events stop the integrator exactly, apply the change, and restart at 1 ms.
 */

export interface SolverOptions {
  dtInit: number;
  dtMin: number;
  dtMax: number;
  newtonTol: number;
  maxNewton: number;
  /** reject step if local error estimate (in u ≈ relative in p) exceeds this */
  errAccept: number;
  /** grow dt only when estimate below this */
  errGrow: number;
  maxOuter: number;
  /** pressure floor, Torr */
  pFloor: number;
  /** steady-state criterion: max |d ln p / dt| below this, 1/s */
  steadyTol: number;
}

export const DEFAULT_SOLVER_OPTIONS: SolverOptions = {
  dtInit: 1e-3,
  dtMin: 1e-9,
  dtMax: 10,
  newtonTol: 1e-7,
  // a node near the pressure floor that gets flooded needs Δu ≈ ln(p_new/p_floor)
  // in one implicit step (at ANY dt — log-space jumps shrink only
  // logarithmically with dt), and damped Newton walks there 1-3 units/iteration
  maxNewton: 40,
  errAccept: 6e-3,
  errGrow: 8e-4,
  maxOuter: 2,
  pFloor: 1e-13,
  steadyTol: 1e-6,
};

// The pressure floor is 1e-13 Torr — 20× below the X-ray limit, so nothing
// measurable is affected. A deeper floor hurts twice: damped Newton WALKS
// log-space floods at ~1 unit/iteration, so every extra decade of floor
// costs ~2.3 iterations whenever an empty node fills; and the wider dynamic
// range strains the banded elimination.
const U_MIN = Math.log(1e-13);
const U_MAX = Math.log(2e6);
/**
 * Entries below ~1e-12 Torr are "don't care" — excluded from error control &
 * steady detection. Nothing measurable lives there (X-ray limit is 5e-12),
 * and partials wandering near the floor otherwise pin the timestep.
 */
const U_CARE = Math.log(1e-12);
const TIME_EPS = 1e-12;

export interface StepStats {
  steps: number;
  rejects: number;
  newtonFails: number;
  maxNewtonIters: number;
}

export class Sim {
  readonly net: Net;
  readonly opts: SolverOptions;
  t = 0;
  dt: number;
  /** partial pressures, layout [g * nNodes + i], Torr */
  readonly p: Float64Array;
  /** u = ln p for free nodes (same layout; boundary entries unused) */
  readonly u: Float64Array;
  readonly log: EventLogEntry[] = [];
  onLog?: (e: EventLogEntry) => void;
  onSample?: (t: number, sim: Sim) => void;
  stats: StepStats = { steps: 0, rejects: 0, newtonFails: 0, maxNewtonIters: 0 };
  /** max |du/dt| of the last accepted step (steady-state metric) */
  lastRate = Infinity;
  /** per-node max |du/dt| of the last accepted step (diagnosis gating) */
  readonly rateNode: Float64Array;
  /** diagnostic: why the last Newton solve failed */
  lastFail = '';
  /** diagnostic: node dominating the last error estimate */
  lastEstWorst = '';

  private events: SimEvent[] = [];
  private readonly nS: number;
  private readonly nN: number;
  // frozen per-step coefficients
  private readonly edgeC: Float64Array; // [e * nS + g]
  private readonly qSrc: Float64Array; // [g * nNodes + i]
  private readonly pTotWork: Float64Array; // total pressure per node for freezing
  // Newton work arrays
  private readonly band: BandMatrix;
  private readonly rhs: Float64Array;
  private readonly uWork: Float64Array; // per-species iterate, [i]
  private readonly pWork: Float64Array;
  private readonly uNew: Float64Array; // accepted iterates all species
  private readonly du: Float64Array;
  private readonly duPrev: Float64Array;
  private dtPrev = NaN;
  private estValid = false;
  private readonly pumpsAtInlet: number[][];
  private readonly pumpsAtBacking: number[][];
  private readonly qPumpWork: Float64Array;
  private readonly pumpPartials: Float64Array;
  // per-node thermal terms for the attempted step (exact ramp to tEnd)
  private readonly tempEnd: Float64Array;
  private readonly dlnT: Float64Array;
  private readonly tRelEdge: Float64Array;
  private readonly relRates: Float64Array;
  // water condensation clamp: species index, wall area (cm²), and the frozen
  // per-node psat / exchange coefficient for the attempted step
  private readonly gH2O: number;
  private readonly areaNode: Float64Array;
  private readonly psatNode: Float64Array;
  private readonly condS: Float64Array;
  /** pumps/gauges knocked out by a power failure (null = power on) */
  powerLatch: { pumpIds: string[]; gaugeIds: string[] } | null = null;

  constructor(spec: EngineSystemSpec, opts?: Partial<SolverOptions>) {
    this.net = buildNetwork(spec);
    this.opts = { ...DEFAULT_SOLVER_OPTIONS, ...opts };
    this.dt = this.opts.dtInit;
    const { net } = this;
    this.nS = net.species.length;
    this.nN = net.nodes.length;
    this.p = new Float64Array(this.nS * this.nN);
    this.u = new Float64Array(this.nS * this.nN);
    this.uNew = new Float64Array(this.nS * this.nN);
    this.du = new Float64Array(this.nS * this.nN);
    this.duPrev = new Float64Array(this.nS * this.nN);
    this.edgeC = new Float64Array(net.edges.length * this.nS);
    this.qSrc = new Float64Array(this.nS * this.nN);
    this.pTotWork = new Float64Array(this.nN);
    this.band = new BandMatrix(net.nEq, Math.max(1, net.bandwidth));
    this.rhs = new Float64Array(net.nEq);
    this.uWork = new Float64Array(this.nN);
    this.pWork = new Float64Array(this.nN);
    this.qPumpWork = new Float64Array(this.nS);
    this.pumpPartials = new Float64Array(this.nS);
    this.tempEnd = new Float64Array(this.nN);
    this.dlnT = new Float64Array(this.nN);
    this.tRelEdge = new Float64Array(net.edges.length);
    this.relRates = new Float64Array(this.nS);
    this.rateNode = new Float64Array(this.nN).fill(Infinity);
    this.gH2O = net.species.indexOf('H2O');
    this.areaNode = new Float64Array(this.nN);
    for (const s of net.surfaces) this.areaNode[s.nodeIdx] += s.area;
    this.psatNode = new Float64Array(this.nN);
    this.condS = new Float64Array(this.nN);

    this.pumpsAtInlet = net.nodes.map(() => []);
    this.pumpsAtBacking = net.nodes.map(() => []);
    net.pumps.forEach((pm, k) => {
      this.pumpsAtInlet[pm.nodeIdx].push(k);
      if (pm.backingIdx >= 0) this.pumpsAtBacking[pm.backingIdx].push(k);
    });

    // initial state
    for (let i = 0; i < this.nN; i++) {
      const node = net.nodes[i];
      const src = node.fixed ?? node.initial;
      for (let g = 0; g < this.nS; g++) {
        const pv = Math.max(src[g], this.opts.pFloor);
        this.p[g * this.nN + i] = node.fixed ? src[g] : pv;
        this.u[g * this.nN + i] = Math.log(Math.max(pv, this.opts.pFloor));
      }
    }
  }

  // ------------------------------------------------------------ events ----

  scheduleEvent(e: SimEvent): void {
    this.events.push(e);
    this.events.sort((a, b) => a.t - b.t);
  }

  scheduleEvents(list: SimEvent[]): void {
    this.events.push(...list);
    this.events.sort((a, b) => a.t - b.t);
  }

  /** apply an action right now (live interaction) */
  applyAction(a: SimEventAction): void {
    this.applyOne(a);
    this.dt = this.opts.dtInit;
    this.estValid = false;
  }

  get nextEventTime(): number {
    return this.events.length ? this.events[0].t : Infinity;
  }

  private emit(entries: EventLogEntry[]): void {
    for (const e of entries) {
      this.log.push(e);
      this.onLog?.(e);
    }
  }

  private applyDueEvents(): void {
    let applied = false;
    while (this.events.length && this.events[0].t <= this.t + TIME_EPS * Math.max(1, this.t)) {
      const ev = this.events.shift()!;
      this.applyOne(ev.action);
      applied = true;
    }
    if (applied) {
      this.dt = this.opts.dtInit;
      this.estValid = false;
    }
  }

  private applyOne(a: SimEventAction): void {
    const { net } = this;
    switch (a.type) {
      case 'valve': {
        const e = net.edges.find((x) => x.id === a.edgeId);
        if (!e) return;
        e.openTarget = Math.max(0, Math.min(1, a.open));
        if (a.actuateTime && a.actuateTime > 0) {
          e.slewRate = Math.abs(e.openTarget - e.open) / a.actuateTime;
        } else {
          e.slewRate = Infinity;
          e.open = e.openTarget;
        }
        break;
      }
      case 'pump': {
        const pm = net.pumps.find((x) => x.spec.id === a.pumpId);
        if (!pm) return;
        const pTot = this.totalAt(pm.nodeIdx);
        this.emit(pm.setOn(a.on, pTot, this.t));
        break;
      }
      case 'ballast': {
        const pm = net.pumps.find((x) => x.spec.id === a.pumpId);
        if (pm) pm.ballast = a.on;
        break;
      }
      case 'regenerate': {
        const pm = net.pumps.find((x) => x.spec.id === a.pumpId);
        if (pm) this.emit(pm.regenerate(this.t));
        break;
      }
      case 'gauge': {
        const gg = net.gauges.find((x) => x.spec.id === a.gaugeId);
        if (!gg) return;
        this.emit(gg.setEnabled(a.enabled, this.totalAt(gg.nodeIdx), this.t));
        break;
      }
      case 'bakeStart': {
        const ids = a.nodeIds;
        for (const s of net.surfaces) {
          if (ids === 'all' || ids.includes(net.nodes[s.nodeIdx].id)) {
            s.bakingAtC = a.temperatureC;
          }
        }
        this.setNodeTemps(ids, a.temperatureC, undefined);
        this.emit([{ t: this.t, severity: 'info', message: `Bake started at ${a.temperatureC} °C` }]);
        break;
      }
      case 'bakeEnd': {
        const ids = a.nodeIds;
        for (const s of net.surfaces) {
          if (ids === 'all' || ids.includes(net.nodes[s.nodeIdx].id)) {
            if (s.bakingAtC !== null) s.completeBake();
          }
        }
        this.setNodeTemps(ids, 20, undefined);
        this.emit([{ t: this.t, severity: 'info', message: 'Bake complete' }]);
        break;
      }
      case 'setTemperature': {
        const n = this.setNodeTemps(a.nodeIds, a.temperatureC, a.tauOverride);
        this.emit([{
          t: this.t, severity: 'info',
          message: `Temperature setpoint ${a.temperatureC} °C on ${n} node(s)`,
        }]);
        break;
      }
      case 'powerFail': {
        if (this.powerLatch) break; // already dark
        const pumpIds: string[] = [];
        const gaugeIds: string[] = [];
        for (const pm of net.pumps) {
          if (pm.on) {
            pumpIds.push(pm.spec.id);
            this.emit(pm.setOn(false, this.totalAt(pm.nodeIdx), this.t));
          }
        }
        for (const gg of net.gauges) {
          // bourdon tubes are mechanical and survive; everything electronic dies
          if (gg.enabled && gg.spec.type !== 'bourdon') {
            gaugeIds.push(gg.spec.id);
            this.emit(gg.setEnabled(false, this.totalAt(gg.nodeIdx), this.t));
          }
        }
        this.powerLatch = { pumpIds, gaugeIds };
        this.emit([{ t: this.t, severity: 'error', message: 'POWER FAILURE — pumps coasting, gauges dark' }]);
        if (a.restoreAfter && a.restoreAfter > 0) {
          this.events.push({ t: this.t + a.restoreAfter, action: { type: 'powerRestore', pumpIds: 'all', gaugeIds: 'all' } });
          this.events.sort((x, y) => x.t - y.t);
        }
        break;
      }
      case 'powerRestore': {
        const latch = this.powerLatch;
        const pumpIds = a.pumpIds === 'all' ? latch?.pumpIds ?? [] : a.pumpIds;
        const gaugeIds = a.gaugeIds === 'all' ? latch?.gaugeIds ?? [] : a.gaugeIds;
        this.emit([{ t: this.t, severity: 'info', message: 'Power restored' }]);
        for (const id of pumpIds) {
          const pm = net.pumps.find((x) => x.spec.id === id);
          if (pm) this.emit(pm.setOn(true, this.totalAt(pm.nodeIdx), this.t));
        }
        for (const id of gaugeIds) {
          const gg = net.gauges.find((x) => x.spec.id === id);
          if (gg) this.emit(gg.setEnabled(true, this.totalAt(gg.nodeIdx), this.t));
        }
        this.powerLatch = null;
        break;
      }
      case 'heSpray': {
        const lk = net.leaks.find((x) => x.id === a.leakId);
        if (!lk) return;
        if (a.dwell > 0) {
          lk.heSprayUntil = this.t + a.dwell;
          this.events.push({ t: this.t + a.dwell, action: { type: 'heSpray', leakId: a.leakId, dwell: 0 } });
          this.events.sort((x, y) => x.t - y.t);
          this.emit([{ t: this.t, severity: 'info', message: `He spray at ${lk.id} for ${a.dwell} s` }]);
        } else {
          lk.heSprayUntil = this.t;
        }
        break;
      }
      case 'setLeak': {
        const lk = net.leaks.find((x) => x.id === a.leakId);
        if (!lk) return;
        lk.qStd = a.qStd;
        net.edges[lk.edgeIdx].model = compileConductance(
          { kind: 'fixed', value: a.qStd / 760, speciesScaling: 'molecular' },
          net.species,
        );
        break;
      }
    }
  }

  // ------------------------------------------------------------ helpers ----

  /** set temperature targets on matching free nodes; returns how many matched */
  private setNodeTemps(ids: string[] | 'all', temperatureC: number, tauOverride?: number): number {
    const targetK = temperatureC + 273.15;
    let n = 0;
    for (const node of this.net.nodes) {
      if (node.fixed) continue;
      if (ids !== 'all' && !ids.includes(node.id)) continue;
      node.tempTargetK = targetK;
      node.tauT = tauOverride ?? (targetK > node.tempK ? TAU_HEAT : TAU_COOL);
      n++;
    }
    return n;
  }

  totalAt(nodeIdx: number): number {
    let s = 0;
    for (let g = 0; g < this.nS; g++) s += this.p[g * this.nN + nodeIdx];
    return s;
  }

  partialsAt(nodeIdx: number): Float64Array {
    const out = new Float64Array(this.nS);
    for (let g = 0; g < this.nS; g++) out[g] = this.p[g * this.nN + nodeIdx];
    return out;
  }

  pressureOf(nodeId: string): number {
    const idx = this.net.nodeIndex.get(nodeId);
    if (idx === undefined) throw new Error(`unknown node ${nodeId}`);
    return this.totalAt(idx);
  }

  partialOf(nodeId: string, gas: string): number {
    const idx = this.net.nodeIndex.get(nodeId);
    const gi = this.net.species.indexOf(gas as never);
    if (idx === undefined || gi < 0) throw new Error(`unknown node/gas ${nodeId}/${gas}`);
    return this.p[gi * this.nN + idx];
  }

  /** boundary partial pressure seen through an edge (handles He-spray overrides) */
  private boundaryPartial(edgeIdx: number, nodeIdx: number, g: number): number {
    const e = this.net.edges[edgeIdx];
    if (e.leakIdx !== undefined) {
      const lk = this.net.leaks[e.leakIdx];
      if (this.t < lk.heSprayUntil) {
        return this.net.species[g] === 'He' ? 760 : 0;
      }
    }
    return this.p[g * this.nN + nodeIdx];
  }

  // --------------------------------------------------- coefficient freeze ----

  /** Freeze conductances, pump coefficients and source terms from `p`-state totals at time tEnd. */
  private freeze(tEnd: number): void {
    const { net, nS, nN } = this;
    // node totals
    for (let i = 0; i < nN; i++) this.pTotWork[i] = this.totalAt(i);

    // temperatures: exact first-order ramp to the end of the attempted step;
    // the gas balance picks up Δu = ln(T_end/T_start) (isochoric ideal gas),
    // exactly 0 while everything sits at ambient
    const dtT = Math.max(0, tEnd - this.t);
    for (let i = 0; i < nN; i++) {
      const node = net.nodes[i];
      if (node.fixed || node.tempK === node.tempTargetK) {
        this.tempEnd[i] = node.tempK;
        this.dlnT[i] = 0;
      } else {
        const Tend = rampTo(node.tempK, node.tempTargetK, dtT, node.tauT);
        this.tempEnd[i] = Tend;
        this.dlnT[i] = Math.log(Tend / node.tempK);
      }
    }

    // edges
    for (let e = 0; e < net.edges.length; e++) {
      const edge = net.edges[e];
      const tRel = 0.5 * (this.tempEnd[edge.a] + this.tempEnd[edge.b]) / T0K;
      this.tRelEdge[e] = tRel;
      let open = edge.open;
      let scale = edge.meshFactor;
      if (edge.pumpInternal) {
        scale *= edge.pumpInternal.offConductance();
        open = 1;
      }
      if (open <= 0 || scale <= 0) {
        for (let g = 0; g < nS; g++) this.edgeC[e * nS + g] = 0;
        continue;
      }
      // mean pressure across the edge; He-spray overrides only change composition, not total
      const pMean = 0.5 * (this.pTotWork[edge.a] + this.pTotWork[edge.b]);
      for (let g = 0; g < nS; g++) {
        this.edgeC[e * nS + g] = scale * edge.model.cOf(g, pMean, open, tRel);
      }
    }

    // pumps
    for (const pm of net.pumps) {
      const pIn = this.pTotWork[pm.nodeIdx];
      const pBack = pm.backingIdx >= 0 ? this.pTotWork[pm.backingIdx] : 760;
      for (let g = 0; g < nS; g++) this.pumpPartials[g] = this.p[g * nN + pm.nodeIdx];
      pm.freeze(pIn, pBack, this.pumpPartials);
    }

    // sources (outgassing + permeation, at the node temperature) at end time
    this.qSrc.fill(0);
    const tmp = new Float64Array(nS);
    for (const s of net.surfaces) {
      tmp.fill(0);
      s.addLoads(tEnd, net.species, tmp, undefined, this.tempEnd[s.nodeIdx] - 273.15);
      for (let g = 0; g < nS; g++) this.qSrc[g * nN + s.nodeIdx] += tmp[g];
    }

    // warming cryo cold heads re-emit their sorbed inventory
    for (const pm of net.pumps) {
      if (pm.releaseRates(this.relRates)) {
        for (let g = 0; g < nS; g++) this.qSrc[g * nN + pm.nodeIdx] += this.relRates[g];
      }
    }

    // water condensation clamp: a node at/above psat(T_wall), or one holding
    // condensate, exchanges H2O with its walls through a linear S·(psat − p)
    // term this step. S is a sticking-limited estimate from wall area (with a
    // V^(2/3) floor so surface-less junctions still clamp); evaporation is
    // capped so a step can never release more than the inventory.
    if (this.gH2O >= 0) {
      const horizon = Math.max(dtT, 1e-9);
      for (let i = 0; i < nN; i++) {
        this.condS[i] = 0;
        const node = net.nodes[i];
        if (node.fixed) continue;
        const psat = pSatH2O(this.tempEnd[i]);
        this.psatNode[i] = psat;
        const pw = this.p[this.gH2O * nN + i];
        if (pw <= psat && node.condensedH2O <= 0) continue;
        let Sc = 0.5 * this.areaNode[i] + 20 * Math.cbrt(node.volume * node.volume);
        if (pw < psat) Sc = Math.min(Sc, node.condensedH2O / (horizon * (psat - pw)));
        this.condS[i] = Sc;
      }
    }
  }

  /**
   * Refresh pTotWork from the CANDIDATE state in uNew (outer iteration).
   * Damped with a geometric mean: coefficient maps with steep negative slope
   * (a displacement pump clipping at its ultimate pressure) turn the raw
   * fixed-point iteration into a limit cycle — the blend keeps it contracting.
   */
  private refreshTotalsFromCandidate(): void {
    const { nN, nS, net } = this;
    for (let i = 0; i < nN; i++) {
      if (net.nodes[i].fixed) continue; // boundary totals never change
      let s = 0;
      for (let g = 0; g < nS; g++) s += Math.exp(this.uNew[g * nN + i]);
      this.pTotWork[i] = Math.sqrt(this.pTotWork[i] * s);
    }
    // re-freeze edges & pumps against candidate totals (sources unchanged)
    for (let e = 0; e < net.edges.length; e++) {
      const edge = net.edges[e];
      let open = edge.open;
      let scale = edge.meshFactor;
      if (edge.pumpInternal) {
        scale *= edge.pumpInternal.offConductance();
        open = 1;
      }
      if (open <= 0 || scale <= 0) continue;
      const pMean = 0.5 * (this.pTotWork[edge.a] + this.pTotWork[edge.b]);
      for (let g = 0; g < nS; g++) {
        this.edgeC[e * nS + g] = scale * edge.model.cOf(g, pMean, open, this.tRelEdge[e]);
      }
    }
    for (const pm of net.pumps) {
      const pIn = this.pTotWork[pm.nodeIdx];
      const pBack = pm.backingIdx >= 0 ? this.pTotWork[pm.backingIdx] : 760;
      for (let g = 0; g < nS; g++) {
        this.pumpPartials[g] = net.nodes[pm.nodeIdx].fixed
          ? this.p[g * nN + pm.nodeIdx]
          : Math.exp(this.uNew[g * nN + pm.nodeIdx]);
      }
      pm.freeze(pIn, pBack, this.pumpPartials);
    }
  }

  // ------------------------------------------------------------- newton ----

  /**
   * Solve the backward-Euler system for one species. Fills uNew[g] slice.
   * Returns Newton iteration count, or -1 on failure.
   */
  private newtonSpecies(g: number, dt: number): number {
    const { net, nN, opts } = this;
    const nEq = net.nEq;
    const off = g * nN;

    // start iterate: predictor from previous step where valid
    for (let e = 0; e < nEq; e++) {
      const i = net.nodeOfEq[e];
      let ug = this.u[off + i];
      if (this.estValid && Number.isFinite(this.dtPrev)) {
        const r = dt / this.dtPrev;
        const pred = this.duPrev[off + i] * r;
        ug += Math.max(-2, Math.min(2, pred));
      }
      this.uWork[i] = Math.max(U_MIN, Math.min(U_MAX, ug));
    }

    for (let iter = 1; iter <= opts.maxNewton; iter++) {
      // pressures at iterate (free) / state (boundary)
      for (let i = 0; i < nN; i++) {
        this.pWork[i] = net.nodes[i].fixed ? this.p[off + i] : Math.exp(this.uWork[i]);
      }
      this.band.zero();
      const band = this.band;
      const rhs = this.rhs;

      for (let e = 0; e < nEq; e++) {
        const i = net.nodeOfEq[e];
        const pi = this.pWork[i];
        const V = net.nodes[i].volume;
        let R = this.qSrc[off + i];
        let dRdui = 0; // ∂R_i/∂u_i

        // network edges
        for (const ei of net.incident[i]) {
          const C = this.edgeC[ei * this.nS + g];
          if (C === 0) continue;
          const edge = net.edges[ei];
          const j = edge.a === i ? edge.b : edge.a;
          const ej = net.eqOf[j];
          const pj = ej >= 0 ? this.pWork[j] : this.boundaryPartial(ei, j, g);
          R += C * (pj - pi);
          dRdui -= C * pi;
          if (ej >= 0) band.add(e, ej, -(dt / (V * pi)) * C * pj);
        }

        // pumps with inlet here
        for (const k of this.pumpsAtInlet[i]) {
          const pm = net.pumps[k];
          const bIdx = pm.backingIdx;
          const pb = bIdx >= 0 ? this.pWork[bIdx] : 0;
          const Qp = pm.q(g, pi, pb);
          R -= Qp;
          const [dIn, dBack] = pm.dq(g, pi, pb);
          dRdui -= dIn * pi;
          if (bIdx >= 0) {
            const eb = net.eqOf[bIdx];
            if (eb >= 0) band.add(e, eb, (dt / (V * pi)) * dBack * pb);
          }
        }
        // pumps exhausting here
        for (const k of this.pumpsAtBacking[i]) {
          const pm = net.pumps[k];
          const aIdx = pm.nodeIdx;
          const pa = this.pWork[aIdx];
          const Qp = pm.q(g, pa, pi);
          R += Qp;
          const [dIn, dBack] = pm.dq(g, pa, pi);
          dRdui += dBack * pi;
          const ea = net.eqOf[aIdx];
          if (ea >= 0) band.add(e, ea, -(dt / (V * pi)) * dIn * pa);
        }

        // wall condensation/evaporation of water: linear in p, exact Jacobian
        if (g === this.gH2O && this.condS[i] > 0) {
          const Sc = this.condS[i];
          R += Sc * (this.psatNode[i] - pi);
          dRdui -= Sc * pi;
        }

        const gfac = dt / (V * pi);
        rhs[e] = -(this.uWork[i] - this.u[off + i] - gfac * R - this.dlnT[i]);
        band.add(e, e, 1 - gfac * dRdui + gfac * R);
      }

      band.equilibrate(rhs);
      if (!band.factor()) {
        this.lastFail = `g=${g} iter=${iter} factor() zero/NaN pivot`;
        return -1;
      }
      band.solve(rhs); // rhs now holds δu

      // convergence is judged on post-clamp movement so entries pinned at the
      // pressure floor (which keep proposing further decrease) don't block it
      let dmax = 0;
      let eMax = -1;
      for (let e = 0; e < nEq; e++) {
        if (!Number.isFinite(rhs[e])) {
          this.lastFail = `g=${g} iter=${iter} non-finite delta at eq ${e} (${net.nodes[net.nodeOfEq[e]].id})`;
          return -1;
        }
        const i = net.nodeOfEq[e];
        const cur = this.uWork[i];
        const move = Math.max(U_MIN, Math.min(U_MAX, cur + rhs[e])) - cur;
        rhs[e] = move;
        const am = Math.abs(move);
        if (am > dmax) {
          dmax = am;
          eMax = e;
        }
      }
      this.lastWorstEq = eMax;
      this.lastDmax = dmax;
      if ((globalThis as { CV_DEBUG?: boolean }).CV_DEBUG && iter > 0) {
        const wi = net.nodeOfEq[eMax];
        console.log(
          `  newton g=${g} it=${iter} dmax=${dmax.toExponential(2)} worst=${net.nodes[wi].id} u=${this.uWork[wi].toFixed(3)} p=${Math.exp(this.uWork[wi]).toExponential(2)}`,
        );
      }
      const damp = dmax > 3 ? 3 / dmax : 1;
      for (let e = 0; e < nEq; e++) {
        const i = net.nodeOfEq[e];
        this.uWork[i] += damp * rhs[e];
      }
      if (dmax < opts.newtonTol) {
        for (let e = 0; e < nEq; e++) {
          const i = net.nodeOfEq[e];
          this.uNew[off + i] = this.uWork[i];
        }
        return iter;
      }
    }
    this.lastFail =
      `g=${g} no convergence in ${opts.maxNewton} iters; ` +
      `worst=${this.lastWorstEq >= 0 ? this.net.nodes[this.net.nodeOfEq[this.lastWorstEq]].id : '?'} ` +
      `dmax=${this.lastDmax.toExponential(2)} u=${this.lastWorstEq >= 0 ? this.uWork[this.net.nodeOfEq[this.lastWorstEq]].toFixed(2) : '?'}`;
    return -1;
  }

  private lastWorstEq = -1;
  private lastDmax = 0;

  // --------------------------------------------------------------- step ----

  /**
   * Take one accepted step, not beyond tLimit. Returns actual dt advanced
   * (0 if tLimit reached exactly / nothing to do).
   */
  private stepOnce(tLimit: number): number {
    const { opts, net, nN, nS } = this;
    if (tLimit - this.t <= TIME_EPS * Math.max(1, this.t)) return 0;

    let attempts = 0;
    for (;;) {
      attempts++;
      const dtTry = Math.min(this.dt, tLimit - this.t);
      this.freeze(this.t + dtTry);

      let newtonIters = 0;
      let ok = true;
      for (let outer = 0; outer <= opts.maxOuter && ok; outer++) {
        newtonIters = 0;
        for (let g = 0; g < nS; g++) {
          const it = this.newtonSpecies(g, dtTry);
          if (it < 0) {
            ok = false;
            break;
          }
          newtonIters = Math.max(newtonIters, it);
        }
        if (!ok || outer === opts.maxOuter) break;
        this.refreshTotalsFromCandidate();
      }

      if (!ok) {
        this.stats.newtonFails++;
        if (this.dt <= opts.dtMin * 4) {
          // cannot shrink further — should not happen; log and signal stuck
          this.emit([{ t: this.t, severity: 'error', message: 'solver: Newton failed at minimum dt' }]);
          this.dt = opts.dtInit;
          this.estValid = false;
          return -1;
        }
        this.dt /= 4;
        continue;
      }

      // local error estimate (skipped right after events; entries at the
      // pressure floor don't participate — a species clamped at 1e-30 Torr
      // must not stall the controller)
      let est = 0;
      if (this.estValid && Number.isFinite(this.dtPrev)) {
        const r = dtTry / this.dtPrev;
        for (let g = 0; g < nS; g++) {
          const off = g * nN;
          for (let e = 0; e < net.nEq; e++) {
            const i = net.nodeOfEq[e];
            const un = this.uNew[off + i];
            const uo = this.u[off + i];
            if (Math.min(un, uo) < U_CARE) continue;
            // a species vastly below its node's total is physically
            // irrelevant there — it must not govern the global timestep
            // (1e-7 keeps ppm-level He leak-check signals controlled)
            if (Math.exp(un) < 1e-7 * this.pTotWork[i]) continue;
            const err = Math.abs(un - uo - r * this.duPrev[off + i]) / (1 + r);
            if (err > est) {
              est = err;
              this.lastEstWorst = `${net.species[g]}@${net.nodes[i].id} u=${un.toFixed(1)}`;
            }
          }
        }
        if (est > opts.errAccept && dtTry > opts.dtMin && attempts < 40) {
          this.stats.rejects++;
          this.dt = dtTry / 2;
          continue;
        }
      }

      // ---- accept ----
      let maxDu = 0;
      this.rateNode.fill(0);
      for (let g = 0; g < nS; g++) {
        const off = g * nN;
        for (let e = 0; e < net.nEq; e++) {
          const i = net.nodeOfEq[e];
          const un = this.uNew[off + i];
          const d = un - this.u[off + i];
          this.du[off + i] = d;
          if (Math.min(un, this.u[off + i]) >= U_CARE && Math.exp(un) >= 1e-7 * this.pTotWork[i]) {
            const ad = Math.abs(d);
            if (ad > maxDu) maxDu = ad;
            if (ad > this.rateNode[i]) this.rateNode[i] = ad;
          }
          this.u[off + i] = un;
          this.p[off + i] = Math.exp(un);
        }
      }
      this.t += dtTry;
      this.lastRate = maxDu / dtTry;
      for (let i = 0; i < nN; i++) this.rateNode[i] /= dtTry;
      this.stats.steps++;
      this.stats.maxNewtonIters = Math.max(this.stats.maxNewtonIters, newtonIters);
      this.duPrev.set(this.du);
      this.dtPrev = dtTry;
      this.estValid = true;

      this.afterAccept(dtTry);

      // adapt
      if (newtonIters <= 3 && (est <= opts.errGrow || !this.estValid)) {
        this.dt = Math.min(dtTry * 1.5, opts.dtMax);
      } else if (newtonIters >= opts.maxNewton - 8) {
        this.dt = Math.max(dtTry / 2, opts.dtMin);
      } else {
        this.dt = Math.min(Math.max(this.dt, dtTry), opts.dtMax);
      }
      return dtTry;
    }
  }

  /** state bookkeeping after an accepted step of size dt */
  private afterAccept(dt: number): void {
    const { net, nS, nN } = this;

    // valve actuation slew
    for (const e of net.edges) {
      if (e.open !== e.openTarget) {
        const step = e.slewRate * dt;
        const d = e.openTarget - e.open;
        e.open = Math.abs(d) <= step ? e.openTarget : e.open + Math.sign(d) * step;
      }
    }

    // commit node temperatures for the accepted step
    for (let i = 0; i < nN; i++) {
      if (!net.nodes[i].fixed) net.nodes[i].tempK = this.tempEnd[i];
    }

    // exposure clocks: node above 100 Torr keeps its surfaces "vented";
    // integrated thermal dose flips `baked` (16.7 h-equivalent at 150 °C)
    for (const s of net.surfaces) {
      if (this.pTotWork[s.nodeIdx] > 100 || this.totalAt(s.nodeIdx) > 100) {
        s.exposureStart = this.t;
        // record WHAT wet the walls: the H2O FRACTION of the gas, scaled so
        // lab air at RH r reads back r. Fraction, not absolute partial —
        // this fires on every step above 100 Torr, and during the early
        // rough-down all partials fall together, so a ratio stays put while
        // an absolute pH2O would record a bogus drying-out. Venting with dry
        // N2 leaves ventRH ≈ 0 (outgassing floor); lab air re-wets to r.
        if (this.gH2O >= 0) {
          const pTot = this.totalAt(s.nodeIdx);
          const frac = pTot > 0 ? this.p[this.gH2O * this.nN + s.nodeIdx] / pTot : 0;
          s.ventRH = Math.max(0, Math.min(100, (100 * frac * 760) / P_SAT_H2O_20C));
        }
      }
      if (!s.baked) {
        const tc = this.tempEnd[s.nodeIdx] - 273.15;
        if (tc >= BAKE_DOSE_MIN_C) {
          s.bakeDose += Math.pow(10, (tc - BAKE_DOSE_REF_C) / 60) * dt;
          if (s.bakeDose >= BAKE_DOSE_TARGET && MATERIALS[s.material].bakeable) {
            s.baked = true;
            this.emit([{
              t: this.t, severity: 'info',
              message: `${net.nodes[s.nodeIdx].label}: surfaces baked out (thermal dose reached)`,
            }]);
          }
        }
      }
    }

    // drain sorbed inventory released by warming cryo heads (rates as frozen)
    for (const pm of net.pumps) {
      if (pm.releaseRates(this.relRates)) pm.drainCapacity(this.relRates, dt);
    }

    // condensation inventory: ΔI = S·(p_end − psat)·dt (positive condenses,
    // negative evaporates; the freeze-side cap keeps the clamp from overdraw)
    if (this.gH2O >= 0) {
      for (let i = 0; i < nN; i++) {
        const Sc = this.condS[i];
        if (Sc <= 0) continue;
        const dI = Sc * (this.p[this.gH2O * nN + i] - this.psatNode[i]) * dt;
        net.nodes[i].condensedH2O = Math.max(0, net.nodes[i].condensedH2O + dI);
      }
    }

    // pumps: throughput at accepted state, then state advance
    for (const pm of net.pumps) {
      const pIn = this.totalAt(pm.nodeIdx);
      for (let g = 0; g < nS; g++) {
        const pi = this.p[g * nN + pm.nodeIdx];
        const pb = pm.backingIdx >= 0 ? this.p[g * nN + pm.backingIdx] : 0;
        this.qPumpWork[g] = pm.q(g, pi, pb);
      }
      this.emit(pm.advance(dt, this.t, pIn, this.qPumpWork));
    }

    // gauges (at their node's temperature — thermal transpiration)
    for (const gg of net.gauges) {
      this.emit(gg.advance(dt, this.t, this.partialsAt(gg.nodeIdx), net.nodes[gg.nodeIdx].tempK));
    }

    this.onSample?.(this.t, this);
  }

  // ------------------------------------------------------------ driving ----

  /** Advance exactly dtSim seconds of simulation time (splitting at events). */
  advance(dtSim: number): void {
    const tEnd = this.t + dtSim;
    let guard = 0;
    while (this.t < tEnd - TIME_EPS * Math.max(1, tEnd) && guard++ < 2_000_000) {
      this.applyDueEvents();
      const tLimit = Math.min(tEnd, this.nextEventTime);
      if (tLimit <= this.t + TIME_EPS * Math.max(1, this.t)) {
        // events exactly at current time were applied; if the next event is
        // in the future but we're at tEnd, stop
        if (this.nextEventTime <= this.t + TIME_EPS * Math.max(1, this.t)) continue;
        break;
      }
      const advanced = this.stepOnce(tLimit);
      if (advanced < 0) break; // solver stuck — pause rather than spin
      if (advanced === 0 && this.t >= tLimit - TIME_EPS * Math.max(1, this.t)) {
        if (tLimit === this.nextEventTime) this.applyDueEvents();
        if (tLimit >= tEnd) break;
      }
    }
    this.applyDueEvents();
  }

  /**
   * Fast-forward until steady state: max |d ln p/dt| < steadyTol for a few
   * consecutive steps and no events remain. Returns convergence flag.
   */
  fastForward(maxSimTime = 30 * 86400): { converged: boolean; t: number } {
    const saveDtMax = this.opts.dtMax;
    this.opts.dtMax = 3600;
    const tStop = this.t + maxSimTime;
    let calm = 0;
    let guard = 0;
    try {
      while (this.t < tStop && guard++ < 500_000) {
        this.applyDueEvents();
        const tLimit = Math.min(this.nextEventTime, tStop);
        const adv = this.stepOnce(tLimit);
        if (adv < 0) break; // solver stuck
        if (adv > 0 && this.lastRate < this.opts.steadyTol) calm++;
        else calm = 0;
        if (calm >= 3 && this.nextEventTime === Infinity) {
          return { converged: true, t: this.t };
        }
        if (adv === 0 && this.nextEventTime === Infinity && tLimit >= tStop) break;
      }
      return { converged: false, t: this.t };
    } finally {
      this.opts.dtMax = saveDtMax;
    }
  }

  // ----------------------------------------------------------- snapshot ----

  snapshot(): SimSnapshot {
    const { net, nS, nN } = this;
    return {
      t: this.t,
      dt: this.dt,
      species: net.species,
      nodes: net.nodes.map((n, i) => ({
        id: n.id,
        pTotal: this.totalAt(i),
        partials: Array.from({ length: nS }, (_, g) => this.p[g * nN + i]),
        tempC: n.tempK - 273.15,
        condensedH2O: n.condensedH2O,
      })),
      gauges: net.gauges.map((gg) => gg.reading(this.partialsAt(gg.nodeIdx))),
      valves: net.edges
        .filter((e) => !e.pumpInternal && e.leakIdx === undefined)
        .map((e) => ({ id: e.id, open: e.open })),
      pumps: net.pumps.map((pm) => {
        const heIdx = net.species.indexOf('He');
        const qHelium = heIdx >= 0
          ? pm.q(
              heIdx,
              this.p[heIdx * nN + pm.nodeIdx],
              pm.backingIdx >= 0 ? this.p[heIdx * nN + pm.backingIdx] : 0,
            )
          : 0;
        const capacityFrac = pm.capacityFraction();
        return {
          id: pm.spec.id,
          on: pm.on,
          sEffective: pm.effectiveSpeed(
            this.partialsAt(pm.nodeIdx),
            pm.backingIdx >= 0 ? this.partialsAt(pm.backingIdx) : null,
          ),
          atSpeed: pm.atSpeed,
          spinFraction: pm.spinFrac,
          qHelium,
          capacityFrac,
          capacityUsed: capacityFrac !== null ? Array.from(pm.capacityUsed) : [],
        };
      }),
      steadyState: this.lastRate < this.opts.steadyTol,
      powerFailed: this.powerLatch !== null,
    };
  }
}
