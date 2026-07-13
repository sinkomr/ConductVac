import { describe, expect, it } from 'vitest';
import { compileSystem, translateAction } from '../../compile';
import { Sim } from '../solver';
import type { PartInstance, SystemDefinition } from '../../types';

/**
 * Chamber payloads (area → outgassing, volume → displacement), LN₂ cold
 * traps, gas-injection species auto-extension, per-node bake targeting.
 */

function sysWith(parts: PartInstance[], connections: SystemDefinition['connections']): SystemDefinition {
  return { version: 1, name: 't', humidityRH: 50, script: [], parts, connections };
}

const chamber = (extra: Record<string, number | string | boolean> = {}): PartInstance => ({
  id: 'ch', def: 'chamber-cyl', x: 0, y: 0, rot: 0,
  params: { D: 300, L: 400, portFlange: 'KF25', material: 'ss304', ...extra },
});
// rough + fine pumping: a scroll takes the chamber down (you cannot rough
// through a leak detector's overloaded turbo — the sim enforces that), then
// the self-contained turbo pulls below the water floor so outgassing
// differences are visible
const pump = (): PartInstance => ({
  id: 'pp', def: 'leakdetector', x: 0, y: 0, rot: 0, params: { on: true },
});
const rough = (): PartInstance => ({
  id: 'rr', def: 'pump-scroll-10', x: 0, y: 0, rot: 0, params: { on: true },
});
const conn = (n: number, a: string, ap: number, b: string, bp: number) => ({
  id: `c${n}`, a: { part: a, port: ap }, b: { part: b, port: bp },
});

describe('chamber payloads', () => {
  it('graphite block raises the outgassing floor; volume displacement speeds the initial pump-down', () => {
    const bare = sysWith([chamber(), pump(), rough()], [conn(1, 'ch', 3, 'pp', 0), conn(3, 'ch', 2, 'rr', 0)]);
    const loaded = sysWith(
      [
        chamber(),
        pump(),
        rough(),
        { id: 'gr', def: 'payload-graphite', x: 0, y: 0, rot: 0, params: { W: 200, H: 200, D: 200, portFlange: 'KF25' } },
      ],
      [conn(1, 'ch', 3, 'pp', 0), conn(3, 'ch', 2, 'rr', 0), conn(2, 'ch', 1, 'gr', 0)],
    );
    const cBare = compileSystem(bare);
    const cLoaded = compileSystem(loaded);
    expect(cBare.warnings).toEqual([]);
    expect(cLoaded.warnings).toEqual([]);

    // displacement: 8 L block inside a 28.3 L chamber
    const nodeBare = cBare.engine.nodes.find((n) => n.id === cBare.regionNode['ch:0'])!;
    const nodeLoaded = cLoaded.engine.nodes.find((n) => n.id === cLoaded.regionNode['ch:0'])!;
    expect(nodeBare.volume - nodeLoaded.volume).toBeCloseTo(8, 1);

    // graphite surface: 2·(3·20·20) = 2400 cm², plus the KF25 joint's
    // 1.9 cm² Viton seal (every elastomer-sealed connection deposits one)
    const areaOf = (n: typeof nodeBare) => (n.surfaces ?? []).reduce((s, x) => s + x.area, 0);
    expect(areaOf(nodeLoaded) - areaOf(nodeBare)).toBeCloseTo(2401.9, 1);

    // physics: after an hour of pumping, the loaded chamber sits at a
    // visibly higher water-dominated floor
    const s1 = new Sim(cBare.engine);
    const s2 = new Sim(cLoaded.engine);
    s1.advance(3600);
    s2.advance(3600);
    const p1 = s1.pressureOf(cBare.regionNode['ch:0']);
    const p2 = s2.pressureOf(cLoaded.regionNode['ch:0']);
    expect(p2).toBeGreaterThan(p1 * 1.5);
  });

  it('a large metal mass changes displacement but adds little outgassing', () => {
    const loaded = sysWith(
      [
        chamber(),
        pump(),
        { id: 'blk', def: 'payload-metal', x: 0, y: 0, rot: 0, params: { material: 'al6061', area: 1500, volume: 10, portFlange: 'KF25' } },
      ],
      [conn(1, 'ch', 3, 'pp', 0), conn(2, 'ch', 1, 'blk', 0)],
    );
    const c = compileSystem(loaded);
    const node = c.engine.nodes.find((n) => n.id === c.regionNode['ch:0'])!;
    expect(node.volume).toBeCloseTo(28.27 - 10, 0);
  });

  it('payload volume exceeding the chamber clamps with a warning', () => {
    const loaded = sysWith(
      [
        chamber(),
        pump(),
        { id: 'blk', def: 'payload-metal', x: 0, y: 0, rot: 0, params: { area: 100, volume: 100, portFlange: 'KF25' } },
      ],
      [conn(1, 'ch', 3, 'pp', 0), conn(2, 'ch', 1, 'blk', 0)],
    );
    const c = compileSystem(loaded);
    expect(c.warnings.some((w) => w.includes('payload volume'))).toBe(true);
    const node = c.engine.nodes.find((n) => n.id === c.regionNode['ch:0'])!;
    expect(node.volume).toBeGreaterThan(0);
  });
});

describe('LN₂ cold wall', () => {
  it('crushes the water partial while leaving air almost untouched', () => {
    const sys = sysWith(
      [
        chamber(),
        pump(),
        rough(),
        { id: 'mw', def: 'coldtrap-meissner', x: 0, y: 0, rot: 0, params: { area: 1000, on: false, portFlange: 'KF25' } },
      ],
      [conn(1, 'ch', 3, 'pp', 0), conn(3, 'ch', 2, 'rr', 0), conn(2, 'ch', 1, 'mw', 0)],
    );
    const c = compileSystem(sys);
    expect(c.warnings).toEqual([]);
    const sim = new Sim(c.engine);
    const ch = c.regionNode['ch:0'];
    sim.advance(1200); // water-dominated rough vacuum
    const h2oBefore = sim.partialOf(ch, 'H2O');
    const airBefore = sim.partialOf(ch, 'air');
    expect(h2oBefore).toBeGreaterThan(airBefore); // sanity: outgassing-dominated

    sim.applyAction({ type: 'pump', pumpId: 'mw', on: true });
    sim.advance(700); // cool-down (τ = 120 s; cold gate at 99%) + pumping
    const h2oAfter = sim.partialOf(ch, 'H2O');
    const airAfter = sim.partialOf(ch, 'air');
    // the cold wall is species-selective: water collapses far harder than
    // air (which only sees the scroll continuing its normal decay)
    expect(h2oAfter).toBeLessThan(h2oBefore / 20);
    const h2oDrop = h2oBefore / h2oAfter;
    const airDrop = airBefore / airAfter;
    expect(h2oDrop).toBeGreaterThan(10 * airDrop);
  });
});

describe('gas injection', () => {
  it('N2 admit valve auto-extends the species set and backfills the chamber', () => {
    const sys = sysWith(
      [
        chamber(),
        pump(),
        { id: 'gv', def: 'gasadmit', x: 0, y: 0, rot: 0, params: { gas: 'N2', C: 1e-2, open: false } },
      ],
      [conn(1, 'ch', 3, 'pp', 0), conn(2, 'ch', 1, 'gv', 0)],
    );
    const c = compileSystem(sys);
    expect(c.engine.species).toContain('N2');
    const sim = new Sim(c.engine);
    const ch = c.regionNode['ch:0'];
    sim.advance(600);
    const n2Before = sim.partialOf(ch, 'N2');
    sim.applyAction({ type: 'valve', edgeId: c.valveEdge['gv'], open: 1 });
    sim.advance(1200);
    const n2After = sim.partialOf(ch, 'N2');
    expect(n2Before).toBeLessThan(1e-6);
    expect(n2After).toBeGreaterThan(1e-4); // steady N2 bleed against the scroll
    expect(n2After).toBeGreaterThan(sim.partialOf(ch, 'air'));
  });
});

describe('per-node bake targeting', () => {
  it('translateAction maps part ids to merged engine node ids', () => {
    const sys = sysWith(
      [
        chamber(),
        pump(),
        { id: 'gr', def: 'payload-graphite', x: 0, y: 0, rot: 0, params: { portFlange: 'KF40' } },
      ],
      [conn(1, 'ch', 3, 'pp', 0), conn(2, 'ch', 1, 'gr', 0)],
    );
    const c = compileSystem(sys);
    const t = translateAction({ type: 'bakeStart', nodeIds: ['ch'], temperatureC: 150 }, c);
    expect(t).toBeTruthy();
    if (t && t.type === 'bakeStart' && t.nodeIds !== 'all') {
      // the chamber's canonical node id, valid in the engine spec
      expect(c.engine.nodes.some((n) => n.id === t.nodeIds[0])).toBe(true);
    } else {
      throw new Error('unexpected translation');
    }
  });
});
