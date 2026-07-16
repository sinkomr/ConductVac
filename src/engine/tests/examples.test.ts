import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../examples';
import { compileSystem, translateAction } from '../../compile';
import { Sim } from '../solver';
import type { SimEvent } from '../../types';

/**
 * The bundled examples double as integration tests (§3.5): compile the
 * part-based definitions and check the headline physics of each.
 */

function simOf(exId: string) {
  const ex = EXAMPLES.find((e) => e.id === exId)!;
  const compiled = compileSystem(ex.system);
  // examples must compile without flange-mismatch warnings
  expect(compiled.warnings).toEqual([]);
  const sim = new Sim(compiled.engine);
  const script: SimEvent[] = [];
  for (const row of ex.system.script) {
    const action = translateAction(row.action, compiled);
    if (action) script.push({ t: row.t, action });
  }
  sim.scheduleEvents(script);
  return { sim, compiled, ex };
}

const chamberNode = (compiled: ReturnType<typeof compileSystem>, part: string) =>
  compiled.regionNode[`${part}:0`];

describe('bundled examples', () => {
  it('example 1: RV roughs 50 L to below 0.1 Torr in 10 min, knee visible', () => {
    const { sim, compiled } = simOf('ex1');
    const ch = chamberNode(compiled, 'chamber1');
    sim.advance(60);
    const p60 = sim.pressureOf(ch);
    expect(p60).toBeGreaterThan(1); // still in viscous knee territory
    sim.advance(540);
    const p600 = sim.pressureOf(ch);
    expect(p600).toBeLessThan(0.1);
    expect(p600).toBeGreaterThan(1e-4);
  });

  it('example 2: crossover reproduces the realistic curve (knee, plateau 1e-6..1e-5, H2O dominant)', () => {
    const { sim, compiled } = simOf('ex2');
    const ch = chamberNode(compiled, 'chamber1');
    sim.advance(419);
    const before = sim.pressureOf(ch);
    expect(before).toBeGreaterThan(0.02);
    expect(before).toBeLessThan(1);
    sim.advance(381); // t = 800
    const plateau = sim.pressureOf(ch);
    expect(plateau).toBeLessThan(3e-5);
    expect(plateau).toBeGreaterThan(1e-7);
    expect(sim.partialOf(ch, 'H2O')).toBeGreaterThan(0.5 * plateau);
    // gauge criterion (definition of done): Pirani flatlines at 1e-4 while
    // the full-range gauge keeps reading down
    const pirani = sim.net.gauges.find((g) => g.spec.type === 'pirani')!;
    const fullrange = sim.net.gauges.find((g) => g.spec.type === 'fullrange')!;
    const rp = pirani.reading(sim.partialsAt(pirani.nodeIdx));
    const rf = fullrange.reading(sim.partialsAt(fullrange.nodeIdx));
    expect(rp.value).toBeGreaterThan(0.8e-4);
    expect(rp.value).toBeLessThan(3e-4);
    expect(rf.value).toBeLessThan(3e-5);
  });

  it('example 2: colormap shows a pressure gradient along the roughing line while roughing', () => {
    const { sim, compiled } = simOf('ex2');
    // late roughing (transitional flow) — this is where the foreline gradient
    // becomes visible; in deep viscous flow C is enormous and ΔP is tiny
    sim.advance(100);
    const first = compiled.regionNode['hose1:0'];
    const keys = Object.keys(compiled.regionNode).filter((k) => k.startsWith('hose1:'));
    const last = compiled.regionNode[`hose1:${keys.length - 1}`];
    const pFirst = sim.pressureOf(first);
    const pLast = sim.pressureOf(last);
    expect(keys.length).toBeGreaterThan(5);
    // chamber side is at visibly higher pressure than the pump side
    expect(pFirst / pLast).toBeGreaterThan(1.3);
  });

  it('example 3: bell jar reaches a permeation/elastomer floor around 1e-9..1e-7', () => {
    const { sim, compiled } = simOf('ex3');
    const ch = chamberNode(compiled, 'bell1');
    sim.advance(2400); // rough + warm-up + pull-down
    const ff = sim.fastForward(14 * 86400);
    const p = sim.pressureOf(ch);
    expect(ff.t).toBeGreaterThan(3600);
    expect(p).toBeLessThan(1e-6);
    expect(p).toBeGreaterThan(1e-10);
    // He from permeation is a visible constituent
    expect(sim.partialOf(ch, 'He')).toBeGreaterThan(1e-12);
  });

  it('example 4: scripted bake reaches ~1e-10 Torr, H2-dominated', () => {
    const { sim, compiled } = simOf('ex4');
    const ch = chamberNode(compiled, 'chamber1');
    // run through bake end + ion/NEG start, then settle
    sim.advance(1800 + 24 * 3600 + 7200 + 120);
    sim.fastForward(20 * 86400);
    const p = sim.pressureOf(ch);
    expect(p).toBeLessThan(1e-9);
    expect(p).toBeGreaterThan(1e-12);
    const pH2 = sim.partialOf(ch, 'H2');
    expect(pH2).toBeGreaterThan(0.5 * p);
  }, 120000);

  it('example 5: the long KF25 hose starves the big chamber (conductance-limited)', () => {
    const { sim, compiled } = simOf('ex5');
    const big = chamberNode(compiled, 'bigchamber');
    const man = chamberNode(compiled, 'manifold');

    // roughing works viscously: whole system below ~1 Torr before crossover
    sim.advance(590);
    const roughed = sim.pressureOf(big);
    expect(roughed).toBeLessThan(1);
    expect(roughed).toBeGreaterThan(0.01);

    // 10 min after the gate opens: the manifold plunges to the turbo floor
    // while the chamber drains through ~0.4 L/s of molecular hose conductance
    sim.advance(1200 - sim.t);
    const pMan = sim.pressureOf(man);
    const pBig = sim.pressureOf(big);
    expect(pMan).toBeLessThan(1e-3);
    expect(pBig / pMan).toBeGreaterThan(10);

    // visible gradient along the hose (colormap criterion)
    const keys = Object.keys(compiled.regionNode).filter((k) => k.startsWith('longhose:'));
    const pFirst = sim.pressureOf(compiled.regionNode['longhose:0']);
    const pLast = sim.pressureOf(compiled.regionNode[`longhose:${keys.length - 1}`]);
    expect(keys.length).toBeGreaterThan(15); // 2 m auto-segments finely
    expect(pFirst / pLast).toBeGreaterThan(3);

    // settled: chamber pinned ~2 decades above the manifold by the
    // constriction; the chamber Pirani still reads it (in range), while the
    // manifold full-range shows the turbo floor
    sim.advance(3600 - sim.t);
    const pMan2 = sim.pressureOf(man);
    const pBig2 = sim.pressureOf(big);
    expect(pBig2 / pMan2).toBeGreaterThan(30);
    expect(pBig2).toBeGreaterThan(1e-4);
    expect(pBig2).toBeLessThan(1e-2);
    const pirani = sim.net.gauges.find((g) => g.spec.type === 'pirani')!;
    const rp = pirani.reading(sim.partialsAt(pirani.nodeIdx));
    expect(rp.value).toBeGreaterThan(pBig2 / 3);
    expect(rp.value).toBeLessThan(pBig2 * 3);
  });

  it('example 6: virtual leak produces the slow-bleed signature', () => {
    const { sim } = simOf('ex6');
    // pocket τ = V/C = 1 cm³ / 1e-6 L/s ≈ 1000 s: after 10 min it is still
    // fat with gas, after 1 h it has bled down past ~e^-3.6 of atmosphere
    sim.advance(600);
    const pocket600 = sim.pressureOf('vleak1.pocket');
    expect(pocket600).toBeGreaterThan(100);
    expect(pocket600).toBeLessThan(700);
    sim.advance(3000);
    const pocket3600 = sim.pressureOf('vleak1.pocket');
    expect(pocket3600).toBeGreaterThan(5);
    expect(pocket3600).toBeLessThan(100);
    // the bleed keeps the chamber in the mTorr range at the scroll floor
    const ch = chamberNode(simOf('ex6').compiled, 'cell1');
    expect(sim.pressureOf(ch)).toBeGreaterThan(2e-3);
  });
});
