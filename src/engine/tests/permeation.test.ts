import { describe, expect, it } from 'vitest';
import { Sim } from '../solver';
import { computeFlows } from '../report';
import { sealPermeation } from '../../data/materials';
import type { EngineSystemSpec, SurfaceSpec } from '../../types';

const permeationOf = (surfaces: SurfaceSpec[], humidityRH = 50): number[] => {
  const spec: EngineSystemSpec = {
    species: ['air', 'H2O', 'H2', 'He'],
    humidityRH,
    nodes: [{ id: 'ch', volume: 5, surfaces }],
    edges: [],
    pumps: [{ id: 'p', node: 'ch', model: { kind: 'displacement', sPeak: 20, pUlt: 1e-9 }, on: true }],
  };
  const sim = new Sim(spec);
  sim.advance(1);
  return computeFlows(sim).sources.find((s) => s.kind === 'permeation')?.bySpecies ?? [0, 0, 0, 0];
};

describe('seal permeation', () => {
  it('Viton in lab air: ~1e-8 Torr·L/s per cm² each of air and water, negligible helium', () => {
    // Q = K · 1e-3 · (A/0.3 cm) · p_outside, K in scc·cm/(s·cm²·atm)
    expect(sealPermeation('viton', 'He', 4e-3, 1)).toBeCloseTo(12e-8 * 1e-3 * 4e-3 / 0.3, 20);
    const [air, h2o, h2, he] = permeationOf([{ area: 1, material: 'viton', seal: true }]);
    expect(air).toBeGreaterThan(5e-9);
    expect(air).toBeLessThan(2e-8);
    expect(h2o).toBeGreaterThan(5e-9);
    expect(h2o).toBeLessThan(2e-8);
    expect(he).toBeLessThan(1e-11);
    expect(he).toBeGreaterThan(1e-13);
    expect(h2).toBeLessThan(he);
  });

  it('water permeation follows the room humidity; air does not', () => {
    const dry = permeationOf([{ area: 1, material: 'viton', seal: true }], 10);
    const wet = permeationOf([{ area: 1, material: 'viton', seal: true }], 80);
    expect(wet[1] / dry[1]).toBeCloseTo(8, 6);
    expect(wet[0] / dry[0]).toBeCloseTo(1, 1); // air partial shifts by the water it displaces
  });

  it('an elastomer part inside the chamber outgasses but does not permeate', () => {
    expect(permeationOf([{ area: 10, material: 'viton' }])).toEqual([0, 0, 0, 0]);
  });
});
