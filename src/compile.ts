import type {
  EngineEdgeSpec, EngineGaugeSpec, EngineLeakSpec, EngineNodeSpec,
  EnginePumpSpec, EngineSystemSpec, GasId, GaugeType, SimEventAction,
  SurfaceSpec, SystemDefinition,
} from './types';
import { DEFAULT_SPECIES } from './types';
import { PART_BY_ID, portFlange } from './data/fittings';
import { FLANGE_BY_ID } from './data/flanges';
import { PUMP_BY_ID } from './data/pumps';
import { segmentTube } from './engine/network';

/**
 * Compiles the part-based SystemDefinition the builder edits into the
 * lumped-element EngineSystemSpec the solver integrates.
 *
 * Each part emits nodes/edges/pumps/gauges/leaks under its own id namespace;
 * connections then UNION the joined port nodes (a flange joint is a
 * zero-length junction). Elastomer-sealed joints deposit their wetted seal
 * area (outgassing + permeation) on the merged node; a KF centering ring
 * with mesh screen becomes an aperture edge with transmission 0.7 instead of
 * a union. Tubes longer than 15 cm auto-segment (§1.2) so the colormap can
 * show pressure gradients along plumbing; total auto-generated nodes are
 * capped at ~2000.
 */

export interface CompiledSystem {
  engine: EngineSystemSpec;
  /** `${partId}:${regionIdx}` → engine node id (colormap paint mapping) */
  regionNode: Record<string, string>;
  /** `${partId}:${portIdx}` → engine node id */
  portNode: Record<string, string>;
  /** valve part id → engine edge id */
  valveEdge: Record<string, string>;
  /** valve part id → actuation time (s) */
  valveActuate: Record<string, number>;
  /** leak part id → engine leak id */
  leakId: Record<string, string>;
  warnings: string[];
}

const NODE_BUDGET = 2000;

export function compileSystem(sys: SystemDefinition): CompiledSystem {
  const warnings: string[] = [];

  // Gas admittance valves must have their gas in the ACTIVE species set, or
  // injection silently no-ops (the reservoir's partial would be dropped).
  // The engine is species-general — extend the set automatically.
  const species: GasId[] = [...(sys.species ?? DEFAULT_SPECIES)];
  for (const inst of sys.parts) {
    const def = PART_BY_ID[inst.def];
    if (def?.kind === 'valve-gas') {
      const gas = String(inst.params.gas ?? def.defaults.gas ?? 'N2') as GasId;
      if (!species.includes(gas)) species.push(gas);
    }
  }
  const nodes: EngineNodeSpec[] = [];
  const edges: EngineEdgeSpec[] = [];
  const pumps: EnginePumpSpec[] = [];
  const gauges: EngineGaugeSpec[] = [];
  const leaks: EngineLeakSpec[] = [];
  const regionNode: Record<string, string> = {};
  const portNode: Record<string, string> = {};
  const valveEdge: Record<string, string> = {};
  const valveActuate: Record<string, number> = {};
  const leakId: Record<string, string> = {};

  // rough segmentation budget: reserve room for fixed nodes first
  let segBudget = NODE_BUDGET - sys.parts.length * 3;

  for (const inst of sys.parts) {
    const def = PART_BY_ID[inst.def];
    if (!def) {
      warnings.push(`unknown part definition "${inst.def}" (${inst.id}) — skipped`);
      continue;
    }
    const P = { ...def.defaults, ...inst.params };
    const num = (k: string, dflt = 0) => (typeof P[k] === 'number' ? (P[k] as number) : dflt);
    const bool = (k: string) => Boolean(P[k]);
    const str = (k: string, dflt = '') => String(P[k] ?? dflt);
    const id = inst.id;
    const material = (str('material', 'ss304') || 'ss304') as SurfaceSpec['material'];

    /** small junction node at a port */
    const junction = (idx: number, volume: number, surfaces?: SurfaceSpec[]): string => {
      const nid = `${id}.p${idx}`;
      nodes.push({ id: nid, volume, surfaces, label: `${id} port ${idx}` });
      portNode[`${id}:${idx}`] = nid;
      return nid;
    };

    switch (def.kind) {
      case 'chamber': {
        const D = num('D', 300) / 10; // cm
        const L = num('L', 400) / 10;
        let volume: number;
        let area: number;
        if (def.data.shape === 'sphere') {
          volume = (4 / 3) * Math.PI * (D / 2) ** 3 / 1000;
          area = 4 * Math.PI * (D / 2) ** 2;
        } else if (def.data.shape === 'box') {
          const W = num('W', 1000) / 10, H = num('H', 1000) / 10, Dep = num('D', 1000) / 10;
          volume = (W * H * Dep) / 1000;
          area = 2 * (W * H + H * Dep + W * Dep);
        } else {
          volume = (Math.PI * (D / 2) ** 2 * L) / 1000;
          area = 2 * Math.PI * (D / 2) ** 2 + Math.PI * D * L;
        }
        const surfaces: SurfaceSpec[] = [{ area, material, baked: bool('baked') }];
        if (def.data.elastomerBase) surfaces.push({ area: 40, material: 'viton' });
        const nid = `${id}.n`;
        nodes.push({ id: nid, volume, surfaces, label: id });
        regionNode[`${id}:0`] = nid;
        for (let k = 0; k < def.ports.length; k++) portNode[`${id}:${k}`] = nid;
        break;
      }

      case 'tube':
      case 'flex':
      case 'bellows': {
        const d = def.data.d as number;
        const lengthFactor = (def.data.lengthFactor as number) ?? 1;
        const L = Math.max(num('length', 100) / 10, 1); // cm
        const segL = Math.min(L, 10);
        const halfVol = (Math.PI * (d / 2) ** 2 * (segL / 2)) / 1000;
        const halfArea = Math.PI * d * (segL / 2);
        const mat = def.kind === 'tube' ? material : 'ss304';
        const a = junction(0, halfVol, [{ area: halfArea, material: mat }]);
        const b = junction(1, halfVol, [{ area: halfArea, material: mat }]);
        const maxNew = Math.max(0, Math.min(Math.ceil(L / 10), segBudget));
        const seg = segmentTube({
          id: `${id}.t`, from: a, to: b, d, L, lengthFactor, material: mat, maxNewNodes: maxNew,
        });
        segBudget -= seg.nodes.length;
        nodes.push(...seg.nodes);
        edges.push(...seg.edges);
        const chain = [a, ...seg.nodes.map((n) => n.id), b];
        for (let k = 0; k < chain.length - 1; k++) {
          regionNode[`${id}:${k}`] = chain[Math.min(k + (k > 0 ? 0 : 0), chain.length - 1)];
        }
        // paint spans by the node at their left end, last span by far port
        for (let k = 0; k < chain.length - 1; k++) regionNode[`${id}:${k}`] = chain[k];
        regionNode[`${id}:${chain.length - 2}`] = b;
        break;
      }

      case 'elbow':
      case 'adapter': {
        let d: number;
        if (def.kind === 'adapter') {
          const fa = FLANGE_BY_ID[str('flangeA', 'KF25')];
          const fb = FLANGE_BY_ID[str('flangeB', 'CF40')];
          d = Math.min(fa.boreMm, fb.boreMm) / 10;
        } else {
          d = def.data.d as number;
        }
        const L = ((def.data.lengthMm as number) ?? 40) / 10;
        const bends = (def.data.bends as number) ?? 0;
        const vol = (Math.PI * (d / 2) ** 2 * (L / 2)) / 1000;
        const areaHalf = Math.PI * d * (L / 2);
        const a = junction(0, vol, [{ area: areaHalf, material: 'ss304' }]);
        const b = junction(1, vol, [{ area: areaHalf, material: 'ss304' }]);
        edges.push({ id: `${id}.e`, a, b, conductance: { kind: 'tube', d, L, bends90: bends } });
        regionNode[`${id}:0`] = a;
        regionNode[`${id}:1`] = b;
        break;
      }

      case 'tee':
      case 'cross': {
        const d = def.data.d as number;
        const nPorts = def.ports.length;
        const bodyVol = (Math.PI * (d / 2) ** 2 * (d * nPorts)) / 1000;
        const bodyArea = Math.PI * d * d * nPorts;
        const c = `${id}.c`;
        nodes.push({ id: c, volume: bodyVol, surfaces: [{ area: bodyArea, material: 'ss304' }], label: id });
        regionNode[`${id}:0`] = c;
        for (let k = 0; k < nPorts; k++) {
          const pn = junction(k, 1e-4);
          // tee branch (port 2): flow entering/leaving sideways turns 90°;
          // run-to-run stays straight. Crosses stay symmetric hubs — a star
          // can't express per-pair bends (would need port-to-port edges).
          const bend = def.kind === 'tee' && k === 2 ? 1 : 0;
          edges.push({
            id: `${id}.s${k}`, a: c, b: pn,
            conductance: { kind: 'tube', d, L: 1.5 * d, bends90: bend },
          });
        }
        break;
      }

      case 'blank':
      case 'viewport':
      case 'feedthrough': {
        const d = def.data.d as number;
        const surfaces: SurfaceSpec[] = [];
        if (def.kind === 'viewport') surfaces.push({ area: def.data.glassArea as number, material: 'borosilicate' });
        if (def.kind === 'feedthrough') surfaces.push({ area: def.data.ceramicArea as number, material: 'alumina' });
        junction(0, (Math.PI * (d / 2) ** 2 * 1) / 1000, surfaces.length ? surfaces : undefined);
        regionNode[`${id}:0`] = portNode[`${id}:0`];
        break;
      }

      case 'valve':
      case 'valve-butterfly': {
        const d = def.data.d as number;
        const L = ((def.data.lengthMm as number) ?? 40) / 10;
        const vol = (Math.PI * (d / 2) ** 2 * (L / 2)) / 1000;
        const a = junction(0, vol);
        const b = junction(1, vol);
        const eid = `${id}.v`;
        if (def.kind === 'valve-butterfly') {
          const frac = Math.max(0, Math.min(1, num('open', 0) / 100));
          edges.push({
            id: eid, a, b,
            conductance: { kind: 'tubeAperture', d, L, apertureArea: Math.PI * (d / 2) ** 2 },
            open: frac,
          });
        } else {
          edges.push({
            id: eid, a, b,
            conductance: { kind: 'tube', d, L, bends90: (def.data.bends as number) ?? 0 },
            open: bool('open') ? 1 : 0,
          });
          valveActuate[id] = (def.data.actuateTime as number) ?? 0.5;
        }
        valveEdge[id] = eid;
        regionNode[`${id}:0`] = a;
        regionNode[`${id}:1`] = b;
        break;
      }

      case 'valve-metering': {
        const a = junction(0, 1e-4);
        const b = junction(1, 1e-4);
        const eid = `${id}.v`;
        edges.push({
          id: eid, a, b,
          conductance: { kind: 'fixed', value: num('C', 1e-4), speciesScaling: 'molecular' },
          open: bool('open') ? 1 : 0,
        });
        valveEdge[id] = eid;
        regionNode[`${id}:0`] = a;
        regionNode[`${id}:1`] = b;
        break;
      }

      case 'valve-vent': {
        const d = def.data.d as number;
        const a = junction(0, 1e-3);
        const eid = `${id}.v`;
        edges.push({
          id: eid, a, b: '_atm',
          conductance: { kind: 'tube', d, L: ((def.data.lengthMm as number) ?? 50) / 10 },
          open: bool('open') ? 1 : 0,
        });
        valveEdge[id] = eid;
        regionNode[`${id}:0`] = a;
        break;
      }

      case 'valve-gas': {
        const gas = str('gas', 'N2') as GasId;
        const res = `${id}.res`;
        nodes.push({ id: res, volume: 1, fixed: { [gas]: 800 } as Partial<Record<GasId, number>>, label: `${gas} reservoir` });
        const a = junction(0, 1e-3);
        const eid = `${id}.v`;
        edges.push({
          id: eid, a, b: res,
          conductance: { kind: 'fixed', value: num('C', 1e-3), speciesScaling: 'molecular' },
          open: bool('open') ? 1 : 0,
        });
        valveEdge[id] = eid;
        regionNode[`${id}:0`] = a;
        break;
      }

      case 'pump': {
        const entry = PUMP_BY_ID[def.data.pumpId as string];
        const inletVol = Math.max(0.05, entry.model.kind === 'turbo' || entry.model.kind === 'diffusion' ? 0.4 : 0.1);
        const a = junction(0, inletVol);
        let backing: string | undefined;
        if (def.data.backed) backing = junction(1, 0.05);
        pumps.push({
          id, node: a, backingNode: backing, model: entry.model,
          on: bool('on'), ballast: bool('ballast'), label: entry.name,
        });
        regionNode[`${id}:0`] = a;
        break;
      }

      case 'gauge': {
        const a = junction(0, 5e-3);
        gauges.push({
          id, node: a, type: def.data.gaugeType as GaugeType,
          fullScale: num('fullScale', 1000), enabled: bool('enabled'), label: def.name,
        });
        regionNode[`${id}:0`] = a;
        break;
      }

      case 'leak': {
        const a = junction(0, 1e-4);
        leaks.push({ id, node: a, qStd: num('qStd', 1e-6), label: id });
        leakId[id] = id;
        regionNode[`${id}:0`] = a;
        break;
      }

      case 'vleak': {
        const a = junction(0, 1e-4);
        const hid = `${id}.pocket`;
        nodes.push({ id: hid, volume: num('volume', 1) / 1000, label: `${id} trapped volume` });
        edges.push({
          id: `${id}.bleed`, a: hid, b: a,
          conductance: { kind: 'fixed', value: num('C', 1e-6), speciesScaling: 'molecular' },
        });
        regionNode[`${id}:0`] = a;
        break;
      }

      case 'payload': {
        // items INSIDE the chamber: area → outgassing, volume → displacement
        // (emitted as negative volume; the port junction merges into the host)
        let area: number;
        let volume: number;
        let mat = material;
        if (def.data.payload === 'graphite') {
          const W = num('W', 100) / 10, H = num('H', 100) / 10, D = num('D', 100) / 10; // cm
          area = 2 * (W * H + H * D + W * D);
          volume = (W * H * D) / 1000;
          mat = 'graphite';
        } else if (def.data.payload === 'cable') {
          const Lcm = num('length', 5) * 100;
          const dCm = num('diameter', 10) / 10;
          area = Math.PI * dCm * Lcm;
          volume = (Math.PI * (dCm / 2) ** 2 * Lcm * 0.6) / 1000; // 60% fill
          mat = (str('insulation', 'ptfe') || 'ptfe') as SurfaceSpec['material'];
        } else {
          area = num('area', 100);
          volume = num('volume', 0);
        }
        junction(0, -volume, [{ area, material: mat, baked: bool('baked') }]);
        regionNode[`${id}:0`] = portNode[`${id}:0`];
        break;
      }

      case 'coldtrap-meissner': {
        // 77 K surface: pumps H2O near the impingement rate, CO2 slower;
        // nothing with a high 77 K vapor pressure (N2/O2/H2/He/Ar)
        const A = num('area', 500);
        const a = junction(0, 1e-3);
        pumps.push({
          id, node: a,
          model: {
            kind: 'cryo',
            sPeak: { H2O: 10 * A, CO2: 5 * A },
            capacity: { H2O: 100 * A, CO2: 20 * A },
            crossoverWarn: 0.5,
          },
          on: bool('on'), label: `${id} (Meissner)`,
        });
        regionNode[`${id}:0`] = a;
        break;
      }

      case 'coldtrap-inline': {
        const f = FLANGE_BY_ID[str('portFlange', 'KF25')];
        const d = (f?.boreMm ?? 24) / 10;
        const a = junction(0, (Math.PI * (d / 2) ** 2 * d) / 1000);
        const b = junction(1, (Math.PI * (d / 2) ** 2 * d) / 1000);
        const mid = `${id}.body`;
        nodes.push({
          id: mid,
          volume: (Math.PI * (d / 2) ** 2 * 4 * d) / 1000,
          surfaces: [{ area: Math.PI * d * 4 * d, material: 'ss304' }],
          label: `${id} trap body`,
        });
        // two half-elbows, each ×√0.4 → elbow ×0.4 total (baffled path)
        const half = Math.sqrt(0.4);
        edges.push(
          { id: `${id}.e1`, a, b: mid, conductance: { kind: 'tube', d, L: 1.6 * d, bends90: 0.5 }, meshFactor: half },
          { id: `${id}.e2`, a: mid, b, conductance: { kind: 'tube', d, L: 1.6 * d, bends90: 0.5 }, meshFactor: half },
        );
        pumps.push({
          id, node: mid,
          model: {
            kind: 'cryo',
            sPeak: { H2O: 10 * Math.PI * d * 4 * d, CO2: 5 * Math.PI * d * 4 * d },
            capacity: { H2O: 500, CO2: 100 },
            crossoverWarn: 0.5,
          },
          on: bool('on'), label: `${id} (LN₂ trap)`,
        });
        regionNode[`${id}:0`] = a;
        regionNode[`${id}:1`] = mid;
        break;
      }

      case 'leakdetector': {
        // self-contained: hybrid drag turbo at the inlet, diaphragm backing
        const a = junction(0, 0.3);
        const fore = `${id}.fore`;
        nodes.push({ id: fore, volume: 0.1, label: `${id} internal foreline` });
        pumps.push({
          id: `${id}.t`, node: a, backingNode: fore,
          model: {
            kind: 'turbo', sPeak: 60, k0: { N2: 1e8, air: 1e8, He: 1e6, H2: 1e4 },
            pCritBack: 12, tauSpin: 20, cOff: 1,
          },
          on: bool('on'), label: `${id} detector turbo`,
        });
        pumps.push({
          id: `${id}.b`, node: fore,
          model: { kind: 'displacement', sPeak: 1.1, pUlt: 0.5 },
          on: bool('on'), label: `${id} backing`,
        });
        regionNode[`${id}:0`] = a;
        break;
      }
    }
  }

  // ---- connections: union-find over port nodes --------------------------
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const union = (x: string, y: string) => {
    const rx = find(x), ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  const sealSurfaces: { node: string; area: number }[] = [];

  for (const conn of sys.connections) {
    const na = portNode[`${conn.a.part}:${conn.a.port}`];
    const nb = portNode[`${conn.b.part}:${conn.b.port}`];
    if (!na || !nb) {
      warnings.push(`connection ${conn.id} references a missing port`);
      continue;
    }
    const defA = PART_BY_ID[sys.parts.find((p) => p.id === conn.a.part)?.def ?? ''];
    const defB = PART_BY_ID[sys.parts.find((p) => p.id === conn.b.part)?.def ?? ''];
    const instA = sys.parts.find((p) => p.id === conn.a.part)!;
    const instB = sys.parts.find((p) => p.id === conn.b.part)!;
    const fa = defA ? FLANGE_BY_ID[portFlange(defA, conn.a.port, { ...defA.defaults, ...instA.params })] : undefined;
    const fb = defB ? FLANGE_BY_ID[portFlange(defB, conn.b.port, { ...defB.defaults, ...instB.params })] : undefined;
    if (fa && fb && fa.id !== fb.id) {
      warnings.push(`joint ${conn.id}: ${fa.name} mated to ${fb.name} — insert an adapter for a proper joint (smaller bore governs)`);
    }
    const seal = fa && fb ? (fa.sealAreaCm2 && fb.sealAreaCm2 ? Math.min(fa.sealAreaCm2, fb.sealAreaCm2) : Math.max(fa.sealAreaCm2, fb.sealAreaCm2)) : 0;

    if (conn.mesh && fa) {
      // mesh centering ring: aperture with transmission 0.7 between the two nodes
      const dMin = Math.min(fa.boreMm, fb?.boreMm ?? fa.boreMm) / 10;
      edges.push({
        id: `${conn.id}.mesh`, a: na, b: nb,
        conductance: { kind: 'aperture', area: Math.PI * (dMin / 2) ** 2 },
        meshFactor: 0.7,
      });
      if (seal > 0) sealSurfaces.push({ node: na, area: seal });
    } else {
      union(na, nb);
      if (seal > 0) sealSurfaces.push({ node: na, area: seal });
    }
  }

  // ---- merge unioned nodes ----------------------------------------------
  // payload parts contribute NEGATIVE volume (gas displacement); track the
  // gross positive volume per merged node so we can sanity-clamp
  const canonical = new Map<string, EngineNodeSpec>();
  const grossVolume = new Map<string, number>();
  for (const n of nodes) {
    const root = find(n.id);
    grossVolume.set(root, (grossVolume.get(root) ?? 0) + Math.max(0, n.volume));
    const ex = canonical.get(root);
    if (!ex) {
      canonical.set(root, { ...n, id: root, surfaces: n.surfaces ? [...n.surfaces] : [] });
    } else {
      ex.volume += n.volume;
      if (n.surfaces) (ex.surfaces as SurfaceSpec[]).push(...n.surfaces);
      if (n.fixed) ex.fixed = n.fixed;
      if (n.label && (!ex.label || ex.label.includes('port'))) ex.label = n.label;
    }
  }
  for (const node of canonical.values()) {
    const gross = grossVolume.get(node.id) ?? 0;
    const floor = Math.max(0.02 * gross, 1e-4);
    if (node.volume < floor) {
      warnings.push(
        `${node.label ?? node.id}: payload volume nearly fills (or exceeds) the chamber — free volume clamped to ${floor.toFixed(3)} L`,
      );
      node.volume = floor;
    }
  }
  for (const s of sealSurfaces) {
    const root = find(s.node);
    const ex = canonical.get(root);
    if (ex) (ex.surfaces as SurfaceSpec[]).push({ area: s.area, material: 'viton' });
  }

  const remap = (nid: string) => (nid.startsWith('_') ? nid : find(nid));
  const outEdges: EngineEdgeSpec[] = [];
  for (const e of edges) {
    const a = remap(e.a), b = remap(e.b);
    if (a === b) {
      warnings.push(`edge ${e.id} short-circuited by connections — dropped`);
      continue;
    }
    outEdges.push({ ...e, a, b });
  }
  for (const p of pumps) {
    p.node = remap(p.node);
    if (p.backingNode) p.backingNode = remap(p.backingNode);
  }
  for (const g of gauges) g.node = remap(g.node);
  for (const l of leaks) l.node = remap(l.node);
  for (const k of Object.keys(regionNode)) regionNode[k] = remap(regionNode[k]);
  for (const k of Object.keys(portNode)) portNode[k] = remap(portNode[k]);

  const engine: EngineSystemSpec = {
    nodes: [...canonical.values()],
    edges: outEdges,
    pumps,
    gauges,
    leaks,
    species,
    humidityRH: sys.humidityRH,
  };

  return { engine, regionNode, portNode, valveEdge, valveActuate, leakId, warnings };
}

/**
 * Translate a part-level script action (targets are part ids) to the engine
 * action (targets are engine edge/pump/gauge/leak ids).
 */
export function translateAction(a: SimEventAction, c: CompiledSystem): SimEventAction | null {
  switch (a.type) {
    case 'valve': {
      const edgeId = c.valveEdge[a.edgeId] ?? a.edgeId;
      const actuateTime = a.actuateTime ?? c.valveActuate[a.edgeId];
      return { ...a, edgeId, actuateTime };
    }
    case 'heSpray':
    case 'setLeak':
      return { ...a, leakId: c.leakId[(a as { leakId: string }).leakId] ?? (a as { leakId: string }).leakId } as SimEventAction;
    case 'bakeStart':
    case 'bakeEnd': {
      // UI-level targets are PART ids; the engine wants (post-merge) node ids
      if (a.nodeIds === 'all') return a;
      const nodeIds = a.nodeIds
        .map((pid) => c.regionNode[`${pid}:0`] ?? c.portNode[`${pid}:0`] ?? pid)
        .filter((v, i, arr) => arr.indexOf(v) === i);
      return { ...a, nodeIds };
    }
    default:
      return a;
  }
}
