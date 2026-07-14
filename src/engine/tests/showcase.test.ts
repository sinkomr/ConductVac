import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../../examples';
import { compileSystem, translateAction } from '../../compile';
import { Sim } from '../solver';
import type { SimEvent } from '../../types';

/** Showcase tutorial systems: compile clean and reproduce their story arcs. */

function simOf(exId: string) {
  const ex = EXAMPLES.find((e) => e.id === exId)!;
  const compiled = compileSystem(ex.system);
  expect(compiled.warnings).toEqual([]);
  const sim = new Sim(compiled.engine);
  const script: SimEvent[] = [];
  for (const row of ex.system.script) {
    const action = translateAction(row.action, compiled);
    if (action) script.push({ t: row.t, action });
  }
  sim.scheduleEvents(script);
  return { sim, compiled };
}

describe('showcase examples', () => {
  it('starter: pumps down and can be vented back up', () => {
    const { sim, compiled } = simOf('starter');
    const ch = compiled.regionNode['chamber:0'];
    sim.advance(600);
    const base = sim.pressureOf(ch);
    expect(base).toBeLessThan(0.05);
    // vent it (what the tooltip invites the user to do)
    sim.applyAction({ type: 'valve', edgeId: compiled.valveEdge['vent'], open: 1 });
    sim.advance(300);
    expect(sim.pressureOf(ch)).toBeGreaterThan(400);
  });

  it('coating station: rough → hot diffusion crossover → high-vac base → Ar process → recovery', () => {
    const { sim, compiled } = simOf('coater');
    const ch = compiled.regionNode['chamber:0'];

    sim.advance(295); // roughed
    const roughed = sim.pressureOf(ch);
    expect(roughed).toBeLessThan(1);
    expect(roughed).toBeGreaterThan(1e-3);

    sim.advance(3300 - sim.t); // gate open at 1600, pull to base
    const base = sim.pressureOf(ch);
    expect(base).toBeLessThan(3e-5);
    // Meissner is doing real work: water is NOT the runaway majority it
    // would be with a PTFE cable bundle and no cold surface
    const mw = sim.net.pumps.find((p) => p.spec.id === 'meissner')!;
    const capturedAt3300 = mw.capacityUsed.reduce((a, v) => a + v, 0);
    expect(capturedAt3300).toBeGreaterThan(0.1); // Torr·L of ice on the coil

    sim.advance(4700 - sim.t); // Ar process window
    const pAr = sim.partialOf(ch, 'Ar');
    expect(pAr).toBeGreaterThan(2e-3);
    expect(pAr).toBeLessThan(1e-1);
    expect(pAr).toBeGreaterThan(sim.partialOf(ch, 'H2O')); // Ar dominates during process

    sim.advance(6500 - sim.t); // recovered
    expect(sim.partialOf(ch, 'Ar')).toBeLessThan(pAr / 50);
    expect(sim.pressureOf(ch)).toBeLessThan(3e-5);
  }, 120000);

  // ~9 min of solver time (27 h scripted bake + multi-day ion/NEG hold):
  // runs locally, skipped in CI where examples.test.ts already covers the
  // bake physics. Verified passing: chamber holds < 2e-9 H2-dominated.
  it.skipIf(!!process.env.CI)('surface science: bake, then ion+NEG hold UHV with the gate closed', () => {
    const { sim, compiled } = simOf('uhvlab');
    const ch = compiled.regionNode['chamber:0'];
    const bakeEnd = 1800 + 24 * 3600;

    // run through the whole scripted sequence: bake, ion/NEG start, gate close
    sim.advance(bakeEnd + 14700);
    sim.fastForward(12 * 3600);

    const p = sim.pressureOf(ch);
    expect(p).toBeLessThan(2e-9); // UHV held WITHOUT the turbo
    expect(p).toBeGreaterThan(1e-12);
    expect(sim.partialOf(ch, 'H2')).toBeGreaterThan(0.4 * p); // hydrogen-limited

    const ion = sim.net.pumps.find((p2) => p2.spec.id === 'ion')!;
    const turbo = sim.net.pumps.find((p2) => p2.spec.id === 'turbo')!;
    expect(ion.on).toBe(true); // started below 1e-4 and never tripped
    expect(turbo.on).toBe(false); // endgame: gate closed, turbo off
  }, 240000);
});
