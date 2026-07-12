import type { EnginePumpSpec, EventLogEntry, GasId, PumpModelSpec } from '../types';
import { GASES, isNoble } from '../data/gases';

/**
 * Pump models (§1.3).
 *
 * Per species g, each pump's throughput during a step is frozen into one of:
 *   linear:    Q_g = B_g · p_in,g                       (displacement, capture)
 *   compress:  Q_g = A_g · σ(p_in,g − κ_g · p_back,g)   (turbo, diffusion, Roots)
 * where σ is a relatively-smoothed max(0,·) so backstreaming is clipped
 * (per spec) but Newton sees a smooth derivative. A/B/κ absorb every factor
 * that depends on TOTAL pressures or pump state (rolloff, critical backing,
 * spin fraction, ultimate pressure, capacity taper) — those are refreshed in
 * the solver's outer coefficient iterations; the species partials stay live
 * inside Newton.
 *
 * Compression equilibrium emerges from the clip: with zero net flow,
 * p_in,g floats at p_back,g / K0_g fed by outgassing — which is exactly what
 * makes H2 dominate a well-baked turbo system, and a failing backing pump
 * stall the turbo.
 */

function smoothstep01(t: number): number {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
}

function logSmoothstep(p: number, from: number, to: number): number {
  if (p <= 0) return 0;
  return smoothstep01((Math.log10(p) - Math.log10(from)) / (Math.log10(to) - Math.log10(from)));
}

/** Relative-smoothed max(0,x): scale is the local pressure magnitude. */
function smax(x: number, scale: number): number {
  const eps = 1e-3 * scale + 1e-300;
  return 0.5 * (x + Math.sqrt(x * x + eps * eps));
}
function dsmax(x: number, scale: number): number {
  const eps = 1e-3 * scale + 1e-300;
  return 0.5 * (1 + x / Math.sqrt(x * x + eps * eps));
}

/** Interpolate ln K0 in sqrt(M) between the species given in the catalog. */
export function k0ForGas(k0: Partial<Record<GasId, number>>, gas: GasId): number {
  const direct = k0[gas];
  if (direct !== undefined) return direct;
  const pts: [number, number][] = [];
  for (const [g, v] of Object.entries(k0) as [GasId, number][]) {
    if (v !== undefined) pts.push([Math.sqrt(GASES[g].M), Math.log(v)]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  const x = Math.sqrt(GASES[gas].M);
  if (pts.length === 0) return 1e9;
  if (pts.length === 1 || x <= pts[0][0]) return Math.exp(pts[0][1]);
  if (x >= pts[pts.length - 1][0]) return Math.exp(pts[pts.length - 1][1]);
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return Math.exp(pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]));
    }
  }
  return Math.exp(pts[pts.length - 1][1]);
}

const SQRT28 = Math.sqrt(28);

export class PumpRuntime {
  readonly spec: EnginePumpSpec;
  readonly model: PumpModelSpec;
  readonly nodeIdx: number;
  readonly backingIdx: number; // -1 = exhausts to atmosphere / captures
  readonly species: GasId[];

  on: boolean;
  ballast: boolean;
  /** rotor speed / warm-up fraction 0..1 */
  spinFrac: number;
  /** Torr·L captured per species (capture pumps) */
  capacityUsed: Float64Array;

  // frozen per-step coefficients
  mode: 'linear' | 'compress' = 'linear';
  B: Float64Array;
  A: Float64Array;
  kap: Float64Array;
  /** frozen critical-backing factor (for stall detection/UI) */
  critFactor = 1;
  rollFactor = 1;

  // event latches
  private stallLogged = false;
  private backstreamLogged = false;
  private oilBackstreamLogged = false;
  private crossoverLogged = false;
  private saturationLogged: Set<string> = new Set();
  private atSpeedLogged = false;
  private overTripTime = 0;

  constructor(spec: EnginePumpSpec, nodeIdx: number, backingIdx: number, species: GasId[]) {
    this.spec = spec;
    this.model = spec.model;
    this.nodeIdx = nodeIdx;
    this.backingIdx = backingIdx;
    this.species = species;
    this.on = spec.on ?? false;
    this.ballast = spec.ballast ?? false;
    const m = this.model;
    const instantStart = m.kind === 'ion' || m.kind === 'neg' || m.kind === 'sorption';
    this.spinFrac = this.on ? (instantStart ? 1 : 1) : 0; // pumps that start "on" are assumed already at speed
    this.B = new Float64Array(species.length);
    this.A = new Float64Array(species.length);
    this.kap = new Float64Array(species.length);
    this.capacityUsed = new Float64Array(species.length);
  }

  get isBacked(): boolean {
    return this.model.kind === 'turbo' || this.model.kind === 'diffusion' || this.model.kind === 'roots';
  }

  /** Spin-up / warm-up time constant, s. */
  get tau(): number {
    switch (this.model.kind) {
      case 'turbo':
      case 'diffusion':
        return this.model.tauSpin;
      case 'roots':
        return 5;
      case 'displacement':
        return 1.5;
      case 'cryo':
        return 120;
      default:
        return 0.5;
    }
  }

  /** Conductance through the pump body when not at speed (backed pumps), L/s air. */
  offConductance(): number {
    const m = this.model;
    if (!this.isBacked) return 0;
    const cOff = (m as { cOff: number }).cOff ?? 0;
    const f = 1 - this.spinFrac;
    // the 0.02 floor: even at full speed an overloaded (zero-S) pump passes a
    // trickle, so a stalled turbo grinds the chamber down and can recover
    return cOff * (f * f + 0.02);
  }

  /**
   * Refresh frozen coefficients from state + total pressures.
   * pTotIn/pTotBack: total pressures at inlet/backing nodes.
   */
  freeze(pTotIn: number, pTotBack: number): void {
    const m = this.model;
    const n = this.species.length;
    this.A.fill(0);
    this.B.fill(0);
    this.critFactor = 1;
    this.rollFactor = 1;

    switch (m.kind) {
      case 'displacement': {
        this.mode = 'linear';
        if (this.spinFrac <= 1e-3) return;
        for (let gi = 0; gi < n; gi++) {
          const g = this.species[gi];
          let pUlt = m.pUlt;
          if (this.ballast && m.hasBallast) pUlt *= g === 'H2O' ? 10 : 2;
          // smoothed (1 - pUlt/p)+ : bounded slope at the ultimate keeps the
          // solver's outer coefficient iteration contracting there
          const x = 1 - pUlt / Math.max(pTotIn, 1e-300);
          const delta = 0.02;
          const f = 0.5 * (x + Math.sqrt(x * x + delta * delta));
          this.B[gi] = m.sPeak * this.spinFrac * f;
        }
        return;
      }
      case 'roots': {
        this.mode = 'compress';
        if (this.spinFrac <= 1e-3) return;
        const dP = pTotBack - pTotIn;
        const over = Math.max(0, dP - m.maxDeltaP);
        const dpFac = Math.exp(-over / (0.2 * m.maxDeltaP));
        this.critFactor = dpFac;
        for (let gi = 0; gi < n; gi++) {
          this.A[gi] = m.sPeak * this.spinFrac * dpFac;
          this.kap[gi] = 1 / m.k0;
        }
        return;
      }
      case 'turbo':
      case 'diffusion': {
        this.mode = 'compress';
        if (this.spinFrac <= 1e-3) return;
        const rollStart = m.rolloffStart ?? 1e-2;
        const rollEnd = m.rolloffEnd ?? 1;
        this.rollFactor = 1 - logSmoothstep(pTotIn, rollStart, rollEnd);
        this.critFactor = 1 - logSmoothstep(pTotBack, 0.6 * m.pCritBack, 1.6 * m.pCritBack);
        const common = this.spinFrac * this.rollFactor * this.critFactor;
        for (let gi = 0; gi < n; gi++) {
          const g = this.species[gi];
          this.A[gi] = m.sPeak * (SQRT28 / Math.sqrt(GASES[g].M)) * common;
          this.kap[gi] = 1 / k0ForGas(m.k0, g);
        }
        return;
      }
      case 'ion': {
        this.mode = 'linear';
        if (!this.on) return;
        const lg = Math.log10(Math.max(pTotIn, 1e-300));
        const bell = Math.pow(2, -(((lg + 6) / 2) ** 2)); // 1 at 1e-6, 0.5 at 1e-8 / 1e-4
        for (let gi = 0; gi < n; gi++) {
          const g = this.species[gi];
          this.B[gi] = m.sPeak * bell * (isNoble(g) ? m.nobleFraction : 1);
        }
        return;
      }
      case 'cryo': {
        this.mode = 'linear';
        if (!this.on || this.spinFrac < 0.99) return;
        const sN2 = m.sPeak.N2 ?? m.sPeak.air ?? 0;
        for (let gi = 0; gi < n; gi++) {
          const g = this.species[gi];
          const s = m.sPeak[g] ?? sN2 * Math.sqrt(28 / GASES[g].M);
          const cap = m.capacity[g] ?? Infinity;
          const fill = cap === Infinity ? 0 : this.capacityUsed[gi] / cap;
          this.B[gi] = s * Math.max(0, 1 - Math.pow(Math.min(fill, 1), 8));
        }
        return;
      }
      case 'neg': {
        this.mode = 'linear';
        if (!this.on) return;
        let used = 0;
        for (let gi = 0; gi < n; gi++) used += this.capacityUsed[gi];
        const fac = Math.max(0, 1 - Math.pow(Math.min(used / m.capacity, 1), 8));
        for (let gi = 0; gi < n; gi++) {
          const s = m.sPeak[this.species[gi]];
          this.B[gi] = s ? s * fac : 0;
        }
        return;
      }
      case 'sorption': {
        this.mode = 'linear';
        if (!this.on) return;
        let used = 0;
        for (let gi = 0; gi < n; gi++) used += this.capacityUsed[gi];
        const fac = Math.max(0, 1 - Math.pow(Math.min(used / m.capacity, 1), 8));
        const x = 1 - m.pUlt / Math.max(pTotIn, 1e-300);
        const f = 0.5 * (x + Math.sqrt(x * x + 4e-4));
        const s = m.sPeak * f * fac;
        for (let gi = 0; gi < n; gi++) this.B[gi] = s;
        return;
      }
    }
  }

  /** Throughput for species gi at partials pIn/pBack (Torr·L/s). */
  q(gi: number, pIn: number, pBack: number): number {
    if (this.mode === 'linear') return this.B[gi] * pIn;
    const a = this.A[gi];
    if (a === 0) return 0;
    const x = pIn - this.kap[gi] * pBack;
    return a * smax(x, pIn + this.kap[gi] * pBack);
  }

  /** [∂Q/∂pIn, ∂Q/∂pBack] */
  dq(gi: number, pIn: number, pBack: number): [number, number] {
    if (this.mode === 'linear') return [this.B[gi], 0];
    const a = this.A[gi];
    if (a === 0) return [0, 0];
    const kap = this.kap[gi];
    const s = dsmax(pIn - kap * pBack, pIn + kap * pBack);
    return [a * s, -a * s * kap];
  }

  /** Effective total speed for UI: Σ Q_g / p_total (L/s). */
  effectiveSpeed(partialsIn: Float64Array, partialsBack: Float64Array | null): number {
    let q = 0;
    let pTot = 0;
    for (let gi = 0; gi < this.species.length; gi++) {
      const pB = partialsBack ? partialsBack[gi] : 0;
      q += this.q(gi, partialsIn[gi], pB);
      pTot += partialsIn[gi];
    }
    return pTot > 0 ? q / pTot : 0;
  }

  get atSpeed(): boolean {
    return this.on && this.spinFrac > 0.95;
  }

  /** Turn on/off with class-specific behavior. Returns log entries. */
  setOn(on: boolean, pTotIn: number, t: number): EventLogEntry[] {
    const logs: EventLogEntry[] = [];
    const m = this.model;
    if (on && m.kind === 'ion' && pTotIn > m.maxStart) {
      logs.push({ t, severity: 'error', message: `${this.label} failed to start (pressure ${fmtP(pTotIn)} > ${fmtP(m.maxStart)})` });
      this.on = false;
      return logs;
    }
    this.on = on;
    if (!on) this.atSpeedLogged = false;
    const instant = m.kind === 'ion' || m.kind === 'neg' || m.kind === 'sorption';
    if (instant) this.spinFrac = on ? 1 : 0;
    return logs;
  }

  regenerate(t: number): EventLogEntry[] {
    if (this.on) {
      return [{ t, severity: 'warning', message: `${this.label}: cannot regenerate while running` }];
    }
    this.capacityUsed.fill(0);
    this.saturationLogged.clear();
    return [{ t, severity: 'info', message: `${this.label} regenerated` }];
  }

  get label(): string {
    return this.spec.label ?? this.spec.id;
  }

  /**
   * Advance pump state after an accepted step.
   * qPerSpecies: throughputs actually pumped this step (Torr·L/s).
   */
  advance(dt: number, t: number, pTotIn: number, qPerSpecies: Float64Array): EventLogEntry[] {
    const logs: EventLogEntry[] = [];
    const m = this.model;

    // spin-up / warm-up (exact first-order update)
    const target = this.on ? 1 : 0;
    const prevAtSpeed = this.spinFrac > 0.95;
    this.spinFrac += (target - this.spinFrac) * (1 - Math.exp(-dt / this.tau));
    if (this.spinFrac > 0.9999) this.spinFrac = 1;
    if (this.spinFrac < 1e-4) this.spinFrac = 0;
    if (this.on && !prevAtSpeed && this.spinFrac > 0.95 && !this.atSpeedLogged) {
      this.atSpeedLogged = true;
      const what = m.kind === 'diffusion' ? 'warmed up' : m.kind === 'cryo' ? 'cold' : 'at speed';
      logs.push({ t, severity: 'info', message: `${this.label} ${what}` });
    }

    // capacity integration
    if (m.kind === 'cryo' || m.kind === 'neg' || m.kind === 'sorption') {
      for (let gi = 0; gi < this.species.length; gi++) {
        this.capacityUsed[gi] += Math.max(0, qPerSpecies[gi]) * dt;
      }
      if (m.kind === 'cryo') {
        for (let gi = 0; gi < this.species.length; gi++) {
          const g = this.species[gi];
          const cap = m.capacity[g];
          if (cap !== undefined && cap !== Infinity && this.capacityUsed[gi] >= cap && !this.saturationLogged.has(g)) {
            this.saturationLogged.add(g);
            logs.push({ t, severity: 'warning', message: `${this.label} saturated for ${g} — regenerate` });
          }
        }
      } else {
        let used = 0;
        for (let gi = 0; gi < this.species.length; gi++) used += this.capacityUsed[gi];
        const cap = m.kind === 'neg' ? m.capacity : m.capacity;
        if (used >= cap && !this.saturationLogged.has('total')) {
          this.saturationLogged.add('total');
          logs.push({
            t, severity: 'warning',
            message: `${this.label} saturated — ${m.kind === 'neg' ? 'reactivate/replace cartridge' : 'regenerate'}`,
          });
        }
      }
    }

    // condition monitors
    if ((m.kind === 'turbo' || m.kind === 'diffusion') && this.on && this.spinFrac > 0.5) {
      if (this.critFactor < 0.5 || this.rollFactor < 0.3) {
        if (!this.stallLogged) {
          this.stallLogged = true;
          const why = this.critFactor < 0.5 ? 'backing pressure too high' : 'inlet pressure too high';
          logs.push({ t, severity: 'error', message: `${this.label} stalled — ${why}` });
        }
      } else if (this.critFactor > 0.9 && this.rollFactor > 0.7 && this.stallLogged) {
        this.stallLogged = false;
        logs.push({ t, severity: 'info', message: `${this.label} recovered` });
      }
    }
    if (m.kind === 'diffusion' && this.on && this.spinFrac > 0.8 && m.backstreamAbove && pTotIn > m.backstreamAbove) {
      if (!this.backstreamLogged) {
        this.backstreamLogged = true;
        logs.push({ t, severity: 'warning', message: `${this.label}: oil backstreaming — inlet above ${fmtP(m.backstreamAbove)} while hot` });
      }
    } else if (m.kind === 'diffusion' && pTotIn < (m.backstreamAbove ?? 0) / 10) {
      this.backstreamLogged = false;
    }
    if (m.kind === 'displacement' && m.oilBackstreamBelow && this.on && pTotIn < m.oilBackstreamBelow) {
      if (!this.oilBackstreamLogged) {
        this.oilBackstreamLogged = true;
        logs.push({ t, severity: 'warning', message: `${this.label}: oil backstreaming risk — inlet below ${fmtP(m.oilBackstreamBelow)} with no trap` });
      }
    }
    if (m.kind === 'cryo' && this.on && this.spinFrac > 0.99 && pTotIn > m.crossoverWarn) {
      if (!this.crossoverLogged) {
        this.crossoverLogged = true;
        logs.push({ t, severity: 'warning', message: `${this.label}: crossover too early — exposed above ${fmtP(m.crossoverWarn)}` });
      }
    } else if (m.kind === 'cryo' && pTotIn < m.crossoverWarn / 10) {
      this.crossoverLogged = false;
    }
    if (m.kind === 'ion' && this.on) {
      if (pTotIn > 5 * m.maxStart) {
        this.overTripTime += dt;
        if (this.overTripTime > 5) {
          this.on = false;
          this.spinFrac = 0;
          this.overTripTime = 0;
          logs.push({ t, severity: 'error', message: `${this.label} overpressure trip` });
        }
      } else {
        this.overTripTime = 0;
      }
    }
    return logs;
  }
}

function fmtP(p: number): string {
  return `${p.toExponential(1)} Torr`;
}
