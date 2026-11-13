import { describe, expect, it } from 'vitest';
import { Sim } from '../solver';
import type { EngineSystemSpec, GasId, PumpModelSpec } from '../../types';

/** effective inlet speed of a backed pump for one pure gas, deep in molecular flow */
function speedFor(model: PumpModelSpec, gas: GasId): number {
  const spec: EngineSystemSpec = {
    species: [gas],
    nodes: [
      { id: 'ch', volume: 10, initial: { [gas]: 1e-6 } },
      { id: 'fl', volume: 1, initial: { [gas]: 1e-9 } },
    ],
    edges: [],
    pumps: [
      { id: 'hv', node: 'ch', backingNode: 'fl', model, on: true },
      { id: 'bp', node: 'fl', model: { kind: 'displacement', sPeak: 4, pUlt: 1e-30 }, on: true },
    ],
    startAtAtmosphere: false,
  };
  const sim = new Sim(spec);
  sim.advance(1e-4);
  return sim.snapshot().pumps[0].sEffective;
}

const turbo: PumpModelSpec = {
  kind: 'turbo', sPeak: 260, k0: { N2: 1e9, air: 1e9, He: 3e7, H2: 1e4 },
  pCritBack: 2, tauSpin: 90, cOff: 5,
};

describe('per-gas pumping speed', () => {
  it('a turbo pumps light gases near its N2 speed, not √(28/M) faster', () => {
    // datasheets for a 260 L/s class pump quote ~255 (He) and ~220 (H2)
    expect(speedFor(turbo, 'N2')).toBeCloseTo(260, 0);
    expect(speedFor(turbo, 'air')).toBeCloseTo(260, 0);
    expect(speedFor(turbo, 'He')).toBeCloseTo(260, 0);
    expect(speedFor(turbo, 'H2')).toBeCloseTo(221, 0);
    expect(speedFor(turbo, 'H2')).toBeLessThan(260 * Math.sqrt(28 / 2) / 4);
  });

  it('a diffusion pump pumps He and H2 at 1.25× its air speed', () => {
    const diff: PumpModelSpec = {
      kind: 'diffusion', sPeak: 300, k0: { N2: 1e8, air: 1e8, He: 1e6, H2: 1e5 },
      pCritBack: 0.4, tauSpin: 300, cOff: 40,
    };
    expect(speedFor(diff, 'air')).toBeCloseTo(300, 0);
    expect(speedFor(diff, 'He')).toBeCloseTo(375, 0);
    expect(speedFor(diff, 'H2')).toBeCloseTo(375, 0);
  });

  it('a catalog entry can override the class default', () => {
    expect(speedFor({ ...turbo, sRel: { H2: 0.65 } }, 'H2')).toBeCloseTo(169, 0);
  });
});
