import type {
  EngineEdgeSpec, EngineGaugeSpec, EngineNodeSpec,
  EngineSystemSpec, GasId,
} from '../types';
import { DEFAULT_SPECIES } from '../types';
import { atmosphereComposition } from '../data/gases';
import { compileConductance, type EdgeConductanceModel } from './conductance';
import { PumpRuntime } from './pumps';
import { SurfaceRuntime } from './loads';
import { GaugeRuntime } from './gauges';
import { rcmOrder } from './lin';

/**
 * Builds the runtime network the solver integrates: nodes (with the implicit
 * atmosphere and helium-spray boundary nodes), edges with compiled
 * conductance models, pump runtimes (with internal off-conductance edges),
 * leak edges, surfaces, gauges, and the RCM equation ordering.
 */

export const ATM_NODE = '_atm';
export const HE_NODE = '_he';

export interface NodeRuntime {
  id: string;
  label: string;
  volume: number;
  /** fixed partial pressures (boundary node) or null */
  fixed: Float64Array | null;
  initial: Float64Array;
}

export interface EdgeRuntime {
  id: string;
  label: string;
  a: number;
  b: number;
  model: EdgeConductanceModel;
  meshFactor: number;
  /** current opening fraction */
  open: number;
  /** actuation target + slew rate (fraction/s; Infinity = instant) */
  openTarget: number;
  slewRate: number;
  /** true for auto-generated pump internal (rotor) edges */
  pumpInternal?: PumpRuntime;
  /** for leak edges: index into leaks[] */
  leakIdx?: number;
}

export interface LeakRuntime {
  id: string;
  edgeIdx: number;
  qStd: number;
  /** when > sim time, the leak draws from the He boundary node */
  heSprayUntil: number;
  baseBoundary: number; // node idx (atmosphere)
}

export interface Net {
  species: GasId[];
  nodes: NodeRuntime[];
  nodeIndex: Map<string, number>;
  edges: EdgeRuntime[];
  pumps: PumpRuntime[];
  surfaces: SurfaceRuntime[];
  leaks: LeakRuntime[];
  gauges: GaugeRuntime[];
  /** equation index per node (-1 for boundary), and node per equation */
  eqOf: Int32Array;
  nodeOfEq: Int32Array;
  nEq: number;
  bandwidth: number;
  atmIdx: number;
  heIdx: number;
  humidityRH: number;
  /** adjacency (node -> incident edge indices), for assembly */
  incident: number[][];
}

export function buildNetwork(spec: EngineSystemSpec): Net {
  const species = spec.species ?? DEFAULT_SPECIES;
  const humidityRH = spec.humidityRH ?? 50;
  const atmComp = atmosphereComposition(species, humidityRH);

  const nodes: NodeRuntime[] = [];
  const nodeIndex = new Map<string, number>();

  const heComp = species.map((g) => (g === 'He' ? 760 : 0));
  const addNode = (n: EngineNodeSpec): number => {
    if (nodeIndex.has(n.id)) throw new Error(`duplicate node id: ${n.id}`);
    const idx = nodes.length;
    const fixed = n.fixed
      ? Float64Array.from(species.map((g) => n.fixed![g] ?? 0))
      : null;
    const startAtm = spec.startAtAtmosphere ?? true;
    const initial = n.initial
      ? Float64Array.from(species.map((g) => n.initial![g] ?? 0))
      : fixed ?? Float64Array.from(startAtm ? atmComp : species.map(() => 1e-12));
    nodes.push({
      id: n.id,
      label: n.label ?? n.id,
      volume: Math.max(n.volume, 1e-6),
      fixed,
      initial,
    });
    nodeIndex.set(n.id, idx);
    return idx;
  };

  const atmIdx = addNode({ id: ATM_NODE, volume: 1, fixed: Object.fromEntries(species.map((g, i) => [g, atmComp[i]])), label: 'Atmosphere' });
  const heIdx = addNode({ id: HE_NODE, volume: 1, fixed: { He: 760 }, label: 'He spray' });
  void heComp;

  for (const n of spec.nodes) addNode(n);

  const requireNode = (id: string, what: string): number => {
    const idx = nodeIndex.get(id);
    if (idx === undefined) throw new Error(`${what} references unknown node "${id}"`);
    return idx;
  };

  // edges
  const edges: EdgeRuntime[] = [];
  const addEdge = (e: EngineEdgeSpec, leakIdx?: number): number => {
    const a = requireNode(e.a, `edge ${e.id}`);
    const b = requireNode(e.b, `edge ${e.id}`);
    if (a === b) throw new Error(`edge ${e.id} connects node to itself`);
    edges.push({
      id: e.id,
      label: e.label ?? e.id,
      a, b,
      model: compileConductance(e.conductance, species),
      meshFactor: e.meshFactor ?? 1,
      open: e.open ?? 1,
      openTarget: e.open ?? 1,
      slewRate: Infinity,
      leakIdx,
    });
    return edges.length - 1;
  };
  for (const e of spec.edges) addEdge(e);

  // leaks: fixed-conductance orifice edges from atmosphere
  const leaks: LeakRuntime[] = [];
  for (const l of spec.leaks ?? []) {
    const leakIdx = leaks.length;
    const edgeIdx = addEdge(
      {
        id: `_leak_${l.id}`,
        a: ATM_NODE,
        b: l.node,
        conductance: { kind: 'fixed', value: l.qStd / 760, speciesScaling: 'molecular' },
        label: l.label ?? `leak ${l.id}`,
      },
      leakIdx,
    );
    leaks.push({ id: l.id, edgeIdx, qStd: l.qStd, heSprayUntil: -1, baseBoundary: atmIdx });
  }

  // pumps (+ hidden exhaust volume if a backed pump has no foreline, + rotor off-conductance edge)
  const pumps: PumpRuntime[] = [];
  for (const p of spec.pumps ?? []) {
    const inlet = requireNode(p.node, `pump ${p.id}`);
    let backingIdx = -1;
    const backed = p.model.kind === 'turbo' || p.model.kind === 'diffusion' || p.model.kind === 'roots';
    if (backed) {
      if (p.backingNode) {
        backingIdx = requireNode(p.backingNode, `pump ${p.id} backing`);
      } else {
        backingIdx = addNode({ id: `_${p.id}_exhaust`, volume: 0.1, label: `${p.id} exhaust (unconnected!)` });
      }
    }
    const pump = new PumpRuntime(p, inlet, backingIdx, species);
    pumps.push(pump);
    if (backed) {
      // conductance through the stopped rotor / stack — value refreshed from
      // pump state each coefficient freeze (see solver)
      edges.push({
        id: `_${p.id}_rotor`,
        label: `${p.id} rotor duct`,
        a: inlet,
        b: backingIdx,
        model: compileConductance({ kind: 'fixed', value: 1, speciesScaling: 'molecular' }, species),
        meshFactor: 1,
        open: 1,
        openTarget: 1,
        slewRate: Infinity,
        pumpInternal: pump,
      });
    }
  }

  // surfaces
  const surfaces: SurfaceRuntime[] = [];
  for (const n of spec.nodes) {
    if (!n.surfaces) continue;
    const idx = nodeIndex.get(n.id)!;
    for (const s of n.surfaces) surfaces.push(new SurfaceRuntime(idx, s));
  }

  // gauges
  const gauges: GaugeRuntime[] = (spec.gauges ?? []).map(
    (g: EngineGaugeSpec) => new GaugeRuntime(g, requireNode(g.node, `gauge ${g.id}`), species),
  );

  // equation ordering: free nodes only, RCM over edges + pump couplings
  const nNodes = nodes.length;
  const isFree = nodes.map((n) => n.fixed === null);
  const freeList: number[] = [];
  for (let i = 0; i < nNodes; i++) if (isFree[i]) freeList.push(i);
  const freePos = new Int32Array(nNodes).fill(-1);
  freeList.forEach((n, i) => (freePos[n] = i));

  const adj: number[][] = freeList.map(() => []);
  const link = (x: number, y: number) => {
    const fx = freePos[x], fy = freePos[y];
    if (fx >= 0 && fy >= 0 && fx !== fy) {
      if (!adj[fx].includes(fy)) adj[fx].push(fy);
      if (!adj[fy].includes(fx)) adj[fy].push(fx);
    }
  };
  for (const e of edges) link(e.a, e.b);
  for (const p of pumps) if (p.backingIdx >= 0) link(p.nodeIdx, p.backingIdx);

  const perm = rcmOrder(freeList.length, adj); // perm[eq] = freeListIdx
  const nodeOfEq = new Int32Array(freeList.length);
  const eqOf = new Int32Array(nNodes).fill(-1);
  for (let e = 0; e < perm.length; e++) {
    const node = freeList[perm[e]];
    nodeOfEq[e] = node;
    eqOf[node] = e;
  }

  let bandwidth = 0;
  const span = (x: number, y: number) => {
    const ex = eqOf[x], ey = eqOf[y];
    if (ex >= 0 && ey >= 0) bandwidth = Math.max(bandwidth, Math.abs(ex - ey));
  };
  for (const e of edges) span(e.a, e.b);
  for (const p of pumps) if (p.backingIdx >= 0) span(p.nodeIdx, p.backingIdx);

  const incident: number[][] = nodes.map(() => []);
  edges.forEach((e, i) => {
    incident[e.a].push(i);
    incident[e.b].push(i);
  });

  return {
    species, nodes, nodeIndex, edges, pumps, surfaces, leaks, gauges,
    eqOf, nodeOfEq, nEq: freeList.length, bandwidth, atmIdx, heIdx,
    humidityRH, incident,
  };
}

/**
 * Tube auto-segmentation (§1.2): split tubes/hoses longer than 15 cm into
 * ≤10 cm series segments with internal nodes carrying volume and wall area.
 * Returns node + edge specs to splice into an EngineSystemSpec. The UI
 * compiler uses this; tests can too.
 */
export function segmentTube(opts: {
  id: string;
  from: string;
  to: string;
  d: number; // cm
  L: number; // cm
  bends90?: number;
  lengthFactor?: number;
  material?: import('../types').MaterialId;
  meshFactor?: number;
  maxNewNodes?: number;
}): { nodes: EngineNodeSpec[]; edges: EngineEdgeSpec[] } {
  const { id, from, to, d, L } = opts;
  const material = opts.material ?? 'ss304';
  const lengthFactor = opts.lengthFactor ?? 1;
  if (L <= 15) {
    return {
      nodes: [],
      edges: [{
        id, a: from, b: to,
        conductance: { kind: 'tube', d, L, bends90: opts.bends90, lengthFactor },
        meshFactor: opts.meshFactor,
      }],
    };
  }
  let nSeg = Math.ceil(L / 10);
  if (opts.maxNewNodes !== undefined) nSeg = Math.min(nSeg, opts.maxNewNodes + 1);
  const segL = L / nSeg;
  const bendsPerSeg = (opts.bends90 ?? 0) / nSeg;
  const nodes: EngineNodeSpec[] = [];
  const edges: EngineEdgeSpec[] = [];
  const segVolume = (Math.PI * (d / 2) ** 2 * segL) / 1000; // liters
  const segArea = Math.PI * d * segL; // cm²
  let prev = from;
  for (let i = 0; i < nSeg; i++) {
    const isLast = i === nSeg - 1;
    const next = isLast ? to : `${id}#${i + 1}`;
    if (!isLast) {
      nodes.push({
        id: next,
        volume: segVolume,
        surfaces: [{ area: segArea, material }],
        label: `${id} segment ${i + 1}`,
      });
    }
    edges.push({
      id: `${id}~${i}`,
      a: prev,
      b: next,
      conductance: { kind: 'tube', d, L: segL, bends90: bendsPerSeg, lengthFactor },
      meshFactor: opts.meshFactor,
      label: `${id} [${i + 1}/${nSeg}]`,
    });
    prev = next;
  }
  return { nodes, edges };
}
