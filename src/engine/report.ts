import type { Sim } from './solver';

/**
 * Gas-load flow report for the Sankey view: where throughput comes from and
 * which pump swallows it, in Torr·L/s, computed from the CURRENT state.
 */
export interface FlowReport {
  t: number;
  sources: { id: string; label: string; kind: 'leak' | 'outgassing' | 'permeation'; q: number }[];
  sinks: { id: string; label: string; q: number }[];
  /** total pressure-volume accumulation rate (imbalance), Torr·L/s */
  imbalance: number;
}

export function computeFlows(sim: Sim): FlowReport {
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
    const pMean = 0.5 * (sim.totalAt(e.a) + sim.totalAt(e.b));
    for (let g = 0; g < nS; g++) {
      const C = e.model.cOf(g, pMean, e.open) * e.meshFactor;
      const pOut = sim.t < lk.heSprayUntil
        ? (net.species[g] === 'He' ? 760 : 0)
        : sim.p[g * net.nodes.length + outer];
      q += C * (pOut - sim.p[g * net.nodes.length + inner]);
    }
    if (q > 1e-30) sources.push({ id: lk.id, label: `Leak ${lk.id}`, kind: 'leak', q });
  }

  // outgassing + permeation per node (surface groups)
  const byNode = new Map<number, { outgas: number; perm: number }>();
  const tmp = new Float64Array(nS);
  for (const s of net.surfaces) {
    tmp.fill(0);
    s.addLoads(sim.t, net.species, net.humidityRH, tmp);
    let all = 0;
    for (let g = 0; g < nS; g++) all += tmp[g];
    // split permeation (constant part from elastomers) approximately: recompute without permeation is
    // overkill — attribute elastomer surfaces wholly to "outgassing+permeation" per material
    const rec = byNode.get(s.nodeIdx) ?? { outgas: 0, perm: 0 };
    rec.outgas += all;
    byNode.set(s.nodeIdx, rec);
  }
  for (const [nodeIdx, rec] of byNode) {
    if (rec.outgas > 1e-30) {
      sources.push({
        id: `outgas.${net.nodes[nodeIdx].id}`,
        label: `Outgassing: ${net.nodes[nodeIdx].label}`,
        kind: 'outgassing',
        q: rec.outgas,
      });
    }
  }

  // pumps
  for (const pm of net.pumps) {
    let q = 0;
    for (let g = 0; g < nS; g++) {
      const pi = sim.p[g * net.nodes.length + pm.nodeIdx];
      const pb = pm.backingIdx >= 0 ? sim.p[g * net.nodes.length + pm.backingIdx] : 0;
      q += pm.q(g, pi, pb);
    }
    // backed pumps hand gas to the foreline; only terminal pumps remove it
    // from the system — but per-pump throughput is what the user wants to see
    if (q > 1e-30) sinks.push({ id: pm.spec.id, label: pm.label, q });
  }

  const totalIn = sources.reduce((a, s) => a + s.q, 0);
  const totalOut = sinks.filter((s) => {
    const pm = net.pumps.find((p) => p.spec.id === s.id)!;
    return pm.backingIdx < 0; // terminal pumps only
  }).reduce((a, s) => a + s.q, 0);

  return { t: sim.t, sources, sinks, imbalance: totalIn - totalOut };
}
