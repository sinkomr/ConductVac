import { describe, expect, it } from 'vitest';
import { compileSystem } from '../../compile';
import { Sim } from '../solver';
import type { SystemDefinition } from '../../types';

/**
 * He leak-check workflow (§3.4): a leak-detector part on a leaky chamber.
 * Spraying He at the leak must raise the detector's He-throughput signal by
 * orders of magnitude above the atmospheric-helium background, then decay
 * after the dwell — with physical transport through the network.
 */

function leakCheckSystem(): SystemDefinition {
  return {
    version: 1,
    name: 'leak check',
    humidityRH: 50,
    parts: [
      { id: 'ch', def: 'chamber-cell', x: 0, y: 0, rot: 0, params: { D: 150, L: 250, portFlange: 'KF25' } },
      { id: 'lk', def: 'leak', x: 0, y: 0, rot: 0, params: { qStd: 1e-7, portFlange: 'KF25' } },
      { id: 'ld', def: 'leakdetector', x: 0, y: 0, rot: 0, params: { on: true } },
      { id: 'hose', def: 'flex-KF25', x: 0, y: 0, rot: 0, params: { length: 500 } },
    ],
    connections: [
      { id: 'c1', a: { part: 'ch', port: 1 }, b: { part: 'lk', port: 0 } },
      { id: 'c2', a: { part: 'ch', port: 3 }, b: { part: 'hose', port: 0 } },
      { id: 'c3', a: { part: 'hose', port: 1 }, b: { part: 'ld', port: 0 } },
    ],
    script: [],
  };
}

describe('He leak check', () => {
  it('spraying He at a leak spikes the detector signal, which decays after the dwell', () => {
    const compiled = compileSystem(leakCheckSystem());
    expect(compiled.warnings).toEqual([]);
    const sim = new Sim(compiled.engine);
    // pump down and let the He background establish
    sim.advance(1800);
    const heIdx = sim.net.species.indexOf('He');
    const det = sim.net.pumps.find((p) => p.spec.id === 'ld.t')!;
    const qHe = () =>
      det.q(heIdx, sim.p[heIdx * sim.net.nodes.length + det.nodeIdx],
        sim.p[heIdx * sim.net.nodes.length + det.backingIdx]);

    // the baseline is dominated by He permeation through the three KF25
    // Viton seals (~5.7 cm² × 1e-9) — the physically-real detection floor
    const background = qHe();
    expect(background).toBeGreaterThan(1e-10);
    expect(background).toBeLessThan(1e-8);

    // spray for 20 s: the signal should approach the leak's full-He rate,
    // qStd × sqrt(28.97/4) (molecular flow enhances light-gas flux)
    sim.applyAction({ type: 'heSpray', leakId: 'lk', dwell: 20 });
    sim.advance(20);
    const peak = qHe();
    const expected = 1e-7 * Math.sqrt(28.97 / 4);
    expect(peak).toBeGreaterThan(background * 20);
    expect(peak).toBeGreaterThan(expected / 2);
    expect(peak).toBeLessThan(expected * 2);

    // signal decays after the spray ends
    sim.advance(600);
    const after = qHe();
    expect(after).toBeLessThan(peak / 5);
  });
});
