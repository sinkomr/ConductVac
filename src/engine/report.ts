import type { Sim } from './solver';
import type { PumpRuntime } from './pumps';

/**
 * Gas-load flow report for the Sankey view plus per-chamber bottleneck
 * diagnosis ("what's limiting me"), in Torr·L/s, computed from the CURRENT
 * state.
 */
export interface FlowReport {
  t: number;
  sources: {
    id: string;
    label: string;
    kind: 'leak' | 'outgassing' | 'permeation';
    q: number;
    /** engine node the source feeds */
    nodeId: string;
    /** per-species q, ordered like the sim's species */
    bySpecies: number[];
  }[];
  sinks: { id: string; label: string; q: number; backed: boolean }[];
  /** total pressure-volume accumulation rate (imbalance), Torr·L/s */
  imbalance: number;
  diagnoses: ChamberDiagnosis[];
}

export interface ChamberDiagnosis {
  nodeId: string;
  label: string;
  /** total pressure at the chamber, Torr */
  p: number;
  verdict: 'conductance' | 'pump' | 'load' | 'leak' | 'transient';
  /** delivered pumping speed seen AT the chamber, L/s */
  sDelivered: number;
  /** the dominant pump's effective speed at its own inlet, L/s */
  sPump: number;
  pumpId: string | null;
  /** an edge of the worst pressure-drop PART on the dominant path (conductance verdicts) */
  bottleneckEdgeId: string | null;
  /**
   * pressure ratio across the bottleneck part (conductance verdicts — drops
   * are aggregated per part so a 20-segment hose beats a single adapter
   * edge); p_chamber/p_pumpInlet otherwise
   */
  dropFactor: number;
  topSources: { id: string; q: number; share: number }[];
  /** every edge on the chamber→pump dominant path */
  pathEdgeIds: string[];
}

/** signed throughput through an edge, positive = out of `from`, Torr·L/s */
function edgeFlowFrom(sim: Sim, eIdx: number, from: number): number {
  const net = sim.net;
  const e = net.edges[eIdx];
  const other = e.a === from ? e.b : e.a;
  const pMean = 0.5 * (sim.totalAt(e.a) + sim.totalAt(e.b));
  const scale = e.meshFactor * (e.pumpInternal ? e.pumpInternal.offConductance() : 1);
  let q = 0;
  for (let g = 0; g < net.species.length; g++) {
    const C = e.model.cOf(g, pMean, e.open) * scale;
    q += C * (sim.p[g * net.nodes.length + from] - sim.p[g * net.nodes.length + other]);
  }
  return q;
}

function pumpThroughput(sim: Sim, pm: PumpRuntime): number {
  const net = sim.net;
  let q = 0;
  for (let g = 0; g < net.species.length; g++) {
    const pi = sim.p[g * net.nodes.length + pm.nodeIdx];
    const pb = pm.backingIdx >= 0 ? sim.p[g * net.nodes.length + pm.backingIdx] : 0;
    q += pm.q(g, pi, pb);
  }
  return q;
}

/**
 * Walk the dominant gas path from a chamber: at each node follow the largest
 * outbound flow (edge or co-located pump); a pump taking the most gas ends
 * the walk. Returns the path and the terminal pump (if any).
 */
function dominantPath(sim: Sim, start: number): { pathEdges: number[]; pump: PumpRuntime | null; inlet: number } {
  const net = sim.net;
  const incident: number[][] = net.nodes.map(() => []);
  net.edges.forEach((e, i) => {
    incident[e.a].push(i);
    incident[e.b].push(i);
  });
  const visited = new Set<number>([start]);
  const pathEdges: number[] = [];
  let cur = start;
  for (let depth = 0; depth < 64; depth++) {
    let bestPump: PumpRuntime | null = null;
    let bestPumpQ = 0;
    for (const pm of net.pumps) {
      if (pm.nodeIdx !== cur) continue;
      const q = pumpThroughput(sim, pm);
      if (q > bestPumpQ) {
        bestPumpQ = q;
        bestPump = pm;
      }
    }
    let bestEdge = -1;
    let bestEdgeQ = 0;
    for (const ei of incident[cur]) {
      const e = net.edges[ei];
      const other = e.a === cur ? e.b : e.a;
      if (visited.has(other) || net.nodes[other].fixed) continue;
      const q = edgeFlowFrom(sim, ei, cur);
      if (q > bestEdgeQ) {
        bestEdgeQ = q;
        bestEdge = ei;
      }
    }
    if (bestPump && bestPumpQ >= bestEdgeQ) {
      return { pathEdges, pump: bestPump, inlet: cur };
    }
    if (bestEdge < 0 || bestEdgeQ <= 1e-30) break;
    pathEdges.push(bestEdge);
    cur = net.edges[bestEdge].a === cur ? net.edges[bestEdge].b : net.edges[bestEdge].a;
    visited.add(cur);
  }
  return { pathEdges, pump: null, inlet: cur };
}

function diagnose(
  sim: Sim,
  nodeIdx: number,
  sources: FlowReport['sources'],
): ChamberDiagnosis {
  const net = sim.net;
  const pC = sim.totalAt(nodeIdx);
  const totalQ = sources.reduce((a, s) => a + s.q, 0);
  const leakQ = sources.filter((s) => s.kind === 'leak').reduce((a, s) => a + s.q, 0);
  const topSources = [...sources]
    .sort((a, b) => b.q - a.q)
    .slice(0, 3)
    .map((s) => ({ id: s.id, q: s.q, share: totalQ > 0 ? s.q / totalQ : 0 }))
    .filter((s) => s.share >= 0.15);

  const { pathEdges, pump, inlet } = dominantPath(sim, nodeIdx);
  const pathEdgeIds = pathEdges.map((ei) => net.edges[ei].id);
  const pIn = sim.totalAt(inlet);
  const dropFactor = pIn > 0 ? pC / pIn : 1;

  // delivered speed at the chamber: everything the network + local pumps draw
  const incidentQ = net.edges.reduce((a, e, i) => {
    if (e.a !== nodeIdx && e.b !== nodeIdx) return a;
    const q = edgeFlowFrom(sim, i, nodeIdx);
    return a + Math.max(0, q);
  }, 0);
  const localPumpQ = net.pumps.filter((pm) => pm.nodeIdx === nodeIdx)
    .reduce((a, pm) => a + Math.max(0, pumpThroughput(sim, pm)), 0);
  const sDelivered = pC > 0 ? (incidentQ + localPumpQ) / pC : 0;

  const sPump = pump
    ? pump.effectiveSpeed(sim.partialsAt(pump.nodeIdx), pump.backingIdx >= 0 ? sim.partialsAt(pump.backingIdx) : null)
    : 0;

  const base = {
    nodeId: net.nodes[nodeIdx].id,
    label: net.nodes[nodeIdx].label,
    p: pC,
    sDelivered,
    sPump,
    pumpId: pump ? pump.spec.id : null,
    bottleneckEdgeId: null as string | null,
    dropFactor,
    topSources,
    pathEdgeIds,
  };

  // fast transient (roughing, just-fired events): the pressure DISTRIBUTION
  // isn't established yet, so attribution misleads. A slow quasi-static
  // drain (constriction-limited chamber emptying for hours, rate ~3e-3/s)
  // is exactly when diagnosis is wanted — gate on the solver's slew rate
  // well above that but below roughing rates (~0.1/s).
  if (sim.lastRate > 2e-2) {
    return { ...base, verdict: 'transient' };
  }
  if (!pump || !pump.on) {
    return { ...base, verdict: 'pump' };
  }
  // a starved pump is the structural flaw whatever the load is — check first
  if (sPump > 0 && sDelivered < 0.5 * sPump) {
    // aggregate the pressure drop per PART along the path (a segmented hose
    // spreads its drop over many small edges; summing ln-ratios per part
    // prefix keeps it from losing to a single concentrated adapter edge)
    const drops = new Map<string, { lnSum: number; firstEdge: string }>();
    let cur = nodeIdx;
    for (const ei of pathEdges) {
      const e = net.edges[ei];
      const next = e.a === cur ? e.b : e.a;
      const drop = Math.log(Math.max(sim.totalAt(cur), 1e-30) / Math.max(sim.totalAt(next), 1e-30));
      const key = e.id.startsWith('_') ? e.id : e.id.split('.')[0];
      const rec = drops.get(key) ?? { lnSum: 0, firstEdge: e.id };
      rec.lnSum += Math.max(0, drop);
      drops.set(key, rec);
      cur = next;
    }
    let worst: { lnSum: number; firstEdge: string } | null = null;
    for (const rec of drops.values()) {
      if (!worst || rec.lnSum > worst.lnSum) worst = rec;
    }
    return {
      ...base,
      verdict: 'conductance',
      bottleneckEdgeId: worst ? worst.firstEdge : null,
      dropFactor: worst ? Math.exp(worst.lnSum) : dropFactor,
    };
  }
  if (totalQ > 0 && leakQ >= 0.5 * totalQ) {
    return { ...base, verdict: 'leak' };
  }
  const m = pump.model;
  const nearUltimate = m.kind === 'displacement' && pIn < 3 * m.pUlt;
  const capFrac = pump.capacityFraction();
  if (pump.critFactor < 0.7 || pump.rollFactor < 0.5 || (capFrac !== null && capFrac > 0.9) || nearUltimate) {
    return { ...base, verdict: 'pump' };
  }
  return { ...base, verdict: 'load' };
}

export function computeFlows(sim: Sim, focus?: string[]): FlowReport {
  const net = sim.net;
  const nS = net.species.length;
  const sources: FlowReport['sources'] = [];
  const sinks: FlowReport['sinks'] = [];

  // leaks: flow through their boundary edges
  for (const lk of net.leaks) {
    const e = net.edges[lk.edgeIdx];
    const inner = net.nodes[e.a].fixed ? e.b : e.a;
    const outer = net.nodes[e.a].fixed ? e.a : e.b;
    let q = 0;
    const bySpecies = new Array<number>(nS).fill(0);
    const pMean = 0.5 * (sim.totalAt(e.a) + sim.totalAt(e.b));
    for (let g = 0; g < nS; g++) {
      const C = e.model.cOf(g, pMean, e.open) * e.meshFactor;
      const pOut = sim.t < lk.heSprayUntil
        ? (net.species[g] === 'He' ? 760 : 0)
        : sim.p[g * net.nodes.length + outer];
      const qg = C * (pOut - sim.p[g * net.nodes.length + inner]);
      bySpecies[g] = qg;
      q += qg;
    }
    if (q > 1e-30) {
      sources.push({ id: lk.id, label: `Leak ${lk.id}`, kind: 'leak', q, nodeId: net.nodes[inner].id, bySpecies });
    }
  }

  // outgassing vs permeation, per node (surface groups)
  const byNode = new Map<number, { outgas: Float64Array; perm: Float64Array }>();
  const tmp = new Float64Array(nS);
  const tmpPerm = new Float64Array(nS);
  for (const s of net.surfaces) {
    tmp.fill(0);
    tmpPerm.fill(0);
    s.addLoads(sim.t, net.species, net.humidityRH, tmp, tmpPerm);
    const rec = byNode.get(s.nodeIdx) ?? { outgas: new Float64Array(nS), perm: new Float64Array(nS) };
    for (let g = 0; g < nS; g++) {
      rec.outgas[g] += tmp[g];
      rec.perm[g] += tmpPerm[g];
    }
    byNode.set(s.nodeIdx, rec);
  }
  for (const [nodeIdx, rec] of byNode) {
    const qOut = rec.outgas.reduce((a, b) => a + b, 0);
    const qPerm = rec.perm.reduce((a, b) => a + b, 0);
    if (qOut > 1e-30) {
      sources.push({
        id: `outgas.${net.nodes[nodeIdx].id}`,
        label: `Outgassing: ${net.nodes[nodeIdx].label}`,
        kind: 'outgassing',
        q: qOut,
        nodeId: net.nodes[nodeIdx].id,
        bySpecies: Array.from(rec.outgas),
      });
    }
    if (qPerm > 1e-30) {
      sources.push({
        id: `perm.${net.nodes[nodeIdx].id}`,
        label: `Permeation: ${net.nodes[nodeIdx].label}`,
        kind: 'permeation',
        q: qPerm,
        nodeId: net.nodes[nodeIdx].id,
        bySpecies: Array.from(rec.perm),
      });
    }
  }

  // pumps
  for (const pm of net.pumps) {
    const q = pumpThroughput(sim, pm);
    // backed pumps hand gas to the foreline; only terminal pumps remove it
    // from the system — but per-pump throughput is what the user wants to see
    if (q > 1e-30) sinks.push({ id: pm.spec.id, label: pm.label, q, backed: pm.backingIdx >= 0 });
  }

  const totalIn = sources.reduce((a, s) => a + s.q, 0);
  const totalOut = sinks.filter((s) => !s.backed).reduce((a, s) => a + s.q, 0);
  const imbalance = totalIn - totalOut;

  // chamber diagnoses: caller-specified focus nodes, else the 3 biggest volumes
  let focusIdx: number[];
  if (focus && focus.length) {
    focusIdx = focus
      .map((id) => net.nodes.findIndex((n) => n.id === id))
      .filter((i) => i >= 0);
  } else {
    focusIdx = net.nodes
      .map((n, i) => ({ i, v: n.fixed ? -1 : n.volume }))
      .filter((x) => x.v > 0)
      .sort((a, b) => b.v - a.v)
      .slice(0, 3)
      .map((x) => x.i);
  }
  const diagnoses = [...new Set(focusIdx)].map((i) => diagnose(sim, i, sources));

  return { t: sim.t, sources, sinks, imbalance, diagnoses };
}
