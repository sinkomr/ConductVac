import { describe, expect, it } from 'vitest';
import type { Connection, PartInstance, SimEvent, SystemDefinition } from '../../types';
import { EXAMPLES } from '../../examples';
import { compileSystem, translateAction } from '../../compile';
import { Sim } from '../../engine/solver';
import { portPos } from './geometry';
import { segmentsCross, tidyConnections, wiringCost } from './tidy';

const sys = (parts: PartInstance[], connections: Connection[]): SystemDefinition => ({
  version: 1, name: 'test', parts, connections, script: [], humidityRH: 50,
});
const part = (id: string, def: string, x: number, y: number, rot: PartInstance['rot'] = 0, params: PartInstance['params'] = {}): PartInstance =>
  ({ id, def, x, y, rot, params });
const conn = (id: string, a: [string, number], b: [string, number], mesh?: boolean): Connection =>
  ({ id, a: { part: a[0], port: a[1] }, b: { part: b[0], port: b[1] }, ...(mesh ? { mesh } : {}) });

/** straight-chord wire crossings over a whole system */
function crossings(s: SystemDefinition, connections: Connection[]): number {
  const byId = new Map(s.parts.map((p) => [p.id, p]));
  const segs = connections
    .map((c) => {
      const pa = byId.get(c.a.part);
      const pb = byId.get(c.b.part);
      return pa && pb ? [portPos(pa, c.a.port), portPos(pb, c.b.port)] as const : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  let n = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segmentsCross(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) n++;
    }
  }
  return n;
}

describe('tidyConnections', () => {
  it('mis-wired inline valve: neighbors move to the near-side ports', () => {
    const s = sys(
      [
        part('A', 'nipple-KF25', 0, 0),
        part('V', 'ball-KF25', 4, 0),
        part('B', 'nipple-KF25', 7, 0),
      ],
      [
        conn('c1', ['A', 1], ['V', 1]), // crosses the valve body
        conn('c2', ['B', 0], ['V', 0]), // crosses back
      ],
    );
    const t = tidyConnections(s);
    expect(t.changed).toBe(true);
    const c1 = t.connections.find((c) => c.id === 'c1')!;
    const c2 = t.connections.find((c) => c.id === 'c2')!;
    expect(c1.b.port).toBe(0);
    expect(c2.b.port).toBe(1);
    expect(crossings(s, t.connections)).toBe(0);
  });

  it('tee chirality: run arms swap, branch endpoint stays pinned', () => {
    const s = sys(
      [
        part('T', 'tee-KF25', 0, 0),
        part('L', 'nipple-KF25', -4, 0.25),
        part('R', 'nipple-KF25', 4, 0.25),
        part('D', 'nipple-KF25', 1, 4, 90),
      ],
      [
        conn('cl', ['L', 1], ['T', 1]), // wrong chirality: forced crossing
        conn('cr', ['R', 0], ['T', 0]),
        conn('cd', ['D', 0], ['T', 2]), // branch drop
      ],
    );
    expect(crossings(s, s.connections)).toBeGreaterThan(0);
    const t = tidyConnections(s);
    expect(t.changed).toBe(true);
    expect(t.connections.find((c) => c.id === 'cl')!.b.port).toBe(0);
    expect(t.connections.find((c) => c.id === 'cr')!.b.port).toBe(1);
    // the branch is never reassigned (engine models it with a 90° bend)
    expect(t.connections.find((c) => c.id === 'cd')!.b.port).toBe(2);
    expect(crossings(s, t.connections)).toBe(0);
  });

  it('pump and adapter ports are never touched, even when geometrically wrong', () => {
    const s = sys(
      [
        part('P', 'pump-turbo-80', 0, 0),
        part('N', 'nipple-KF25', 4, 0),
        part('AD', 'adapter', 4, 2, 0, { flangeA: 'KF25', flangeB: 'KF40' }),
        part('M', 'nipple-KF40', 8, 2),
      ],
      [
        // nipple to pump BACKING (port 1) though the inlet (0) is closer — physics, not geometry
        conn('c1', ['N', 0], ['P', 1]),
        // adapter mated "backwards" relative to distance
        conn('c2', ['AD', 1], ['M', 0]),
        conn('c3', ['AD', 0], ['N', 1]),
      ],
    );
    const t = tidyConnections(s);
    // the symmetric nipple ends may legitimately move; the pump/adapter ends may not
    const after = (id: string) => t.connections.find((c) => c.id === id)!;
    expect(after('c1').b).toEqual({ part: 'P', port: 1 });
    expect(after('c2').a).toEqual({ part: 'AD', port: 1 });
    expect(after('c3').a).toEqual({ part: 'AD', port: 0 });
  });

  it('bundled examples: idempotent, collision-free, never more crossings', () => {
    for (const ex of EXAMPLES) {
      const t1 = tidyConnections(ex.system);
      // no two endpoints share a (part, port)
      const seen = new Set<string>();
      for (const c of t1.connections) {
        for (const side of ['a', 'b'] as const) {
          const key = `${c[side].part}:${c[side].port}`;
          expect(seen.has(key), `${ex.id}: duplicate ${key}`).toBe(false);
          seen.add(key);
        }
      }
      // ids, mesh flags, parts untouched
      expect(t1.connections.map((c) => c.id)).toEqual(ex.system.connections.map((c) => c.id));
      expect(t1.connections.map((c) => !!c.mesh)).toEqual(ex.system.connections.map((c) => !!c.mesh));
      // the wiring objective never increases (strict-improvement sweeps);
      // raw chord crossings alone may trade against through-body penalties
      expect(wiringCost(ex.system, t1.connections))
        .toBeLessThanOrEqual(wiringCost(ex.system, ex.system.connections) + 1e-9);
      // idempotent at the fixed point
      const t2 = tidyConnections({ ...ex.system, connections: t1.connections });
      expect(t2.changed, `${ex.id}: tidy not idempotent`).toBe(false);
    }
  });

  it('physics invariance: tidied ex5 simulates identically', () => {
    const ex = EXAMPLES.find((e) => e.id === 'ex5')!;
    const tidied: SystemDefinition = { ...ex.system, connections: tidyConnections(ex.system).connections };
    const run = (s: SystemDefinition) => {
      const compiled = compileSystem(s);
      expect(compiled.warnings).toEqual([]);
      const sim = new Sim(compiled.engine);
      const script: SimEvent[] = [];
      for (const row of s.script) {
        const action = translateAction(row.action, compiled);
        if (action) script.push({ t: row.t, action });
      }
      sim.scheduleEvents(script);
      sim.advance(60);
      return {
        nodes: compiled.engine.nodes.length,
        edges: compiled.engine.edges.length,
        pBig: sim.pressureOf(compiled.regionNode['bigchamber:0']),
        pMan: sim.pressureOf(compiled.regionNode['manifold:0']),
      };
    };
    const raw = run(ex.system);
    const tid = run(tidied);
    expect(tid.nodes).toBe(raw.nodes);
    expect(tid.edges).toBe(raw.edges);
    // same trajectory within solver tolerance (node merge order may differ)
    expect(Math.log10(tid.pBig)).toBeCloseTo(Math.log10(raw.pBig), 2);
    expect(Math.log10(tid.pMan)).toBeCloseTo(Math.log10(raw.pMan), 2);
  });
});

describe('tee branch bend (engine fidelity)', () => {
  it('branch stub carries one 90° bend; run stubs stay straight', () => {
    const s = sys(
      [part('T', 'tee-KF25', 0, 0)],
      [],
    );
    const compiled = compileSystem(s);
    const stub = (k: number) => compiled.engine.edges.find((e) => e.id === `T.s${k}`)!;
    expect(stub(0).conductance).toMatchObject({ kind: 'tube', bends90: 0 });
    expect(stub(1).conductance).toMatchObject({ kind: 'tube', bends90: 0 });
    expect(stub(2).conductance).toMatchObject({ kind: 'tube', bends90: 1 });
  });
});
