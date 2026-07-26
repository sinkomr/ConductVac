import { describe, expect, it } from 'vitest';
import { Sim } from './solver';
import { computeFlows } from './report';
import { CRACKING, buildSpectrum } from '../data/cracking';
import { ION_SENSITIVITY } from '../data/gaugespecs';
import type { EngineSystemSpec, GasId } from '../types';

/**
 * Diagnosis verdicts on hand-built topologies with known physics, plus the
 * cracking-pattern table sanity.
 */

const base = (over: Partial<EngineSystemSpec>): EngineSystemSpec => ({
  nodes: [], edges: [], pumps: [], leaks: [], gauges: [],
  species: ['air', 'H2O', 'H2', 'He'],
  startAtAtmosphere: true,
  ...over,
});

describe('flow report diagnoses', () => {
  it('starved pump behind a thin tube → conductance verdict with the tube as bottleneck', () => {
    // 50 L chamber, 1 m of 1 cm tube (~0.1 L/s molecular) into a 50 L/s pump
    const sim = new Sim(base({
      nodes: [
        { id: 'ch', volume: 50, label: 'chamber' },
        { id: 'pn', volume: 0.1, label: 'pump inlet' },
      ],
      edges: [{ id: 'thin', a: 'ch', b: 'pn', conductance: { kind: 'tube', d: 1, L: 100 } }],
      pumps: [{ id: 'pump1', node: 'pn', model: { kind: 'displacement', sPeak: 50, pUlt: 1e-9 }, on: true }],
      leaks: [{ id: 'lk', node: 'ch', qStd: 1e-5 }],
    }));
    sim.advance(600);
    sim.fastForward(86400);
    const rep = computeFlows(sim, ['ch']);
    expect(rep.diagnoses).toHaveLength(1);
    const d = rep.diagnoses[0];
    expect(d.verdict).toBe('conductance');
    expect(d.bottleneckEdgeId).toBe('thin');
    expect(d.pumpId).toBe('pump1');
    expect(d.dropFactor).toBeGreaterThan(10);
    expect(d.sDelivered).toBeLessThan(0.5 * d.sPump);
    expect(d.pathEdgeIds).toEqual(['thin']);
  });

  it('big pump on a big leak → leak verdict', () => {
    const sim = new Sim(base({
      nodes: [{ id: 'ch', volume: 10, label: 'chamber' }],
      pumps: [{ id: 'pump1', node: 'ch', model: { kind: 'displacement', sPeak: 20, pUlt: 1e-9 }, on: true }],
      leaks: [{ id: 'biglk', node: 'ch', qStd: 1e-3 }],
    }));
    sim.advance(600);
    sim.fastForward(86400);
    const rep = computeFlows(sim, ['ch']);
    const d = rep.diagnoses[0];
    expect(d.verdict).toBe('leak');
    expect(d.topSources[0].id).toBe('biglk');
  });

  it('well-plumbed outgassing-dominated chamber → load verdict with the surface on top', () => {
    const sim = new Sim(base({
      nodes: [{
        id: 'ch', volume: 10, label: 'chamber',
        surfaces: [{ area: 5000, material: 'ss304' }],
      }],
      pumps: [{ id: 'pump1', node: 'ch', model: { kind: 'displacement', sPeak: 20, pUlt: 1e-9 }, on: true }],
    }));
    sim.advance(3600);
    const rep = computeFlows(sim, ['ch']);
    const d = rep.diagnoses[0];
    expect(d.verdict).toBe('load');
    expect(d.topSources[0].id).toBe('outgas.ch');
  });

  it('no running pump → pump verdict with null pumpId', () => {
    const sim = new Sim(base({
      nodes: [{ id: 'ch', volume: 10, label: 'chamber' }],
      pumps: [{ id: 'pump1', node: 'ch', model: { kind: 'displacement', sPeak: 20, pUlt: 1e-9 }, on: false }],
      leaks: [{ id: 'lk', node: 'ch', qStd: 1e-6 }],
    }));
    sim.advance(10);
    const rep = computeFlows(sim, ['ch']);
    expect(rep.diagnoses[0].verdict).toBe('pump');
    expect(rep.diagnoses[0].pumpId).toBeNull();
  });

  it('early pump-down → transient verdict', () => {
    const sim = new Sim(base({
      nodes: [{ id: 'ch', volume: 50, label: 'chamber' }],
      pumps: [{ id: 'pump1', node: 'ch', model: { kind: 'displacement', sPeak: 5, pUlt: 1e-3 }, on: true }],
      leaks: [{ id: 'lk', node: 'ch', qStd: 1e-6 }],
    }));
    sim.advance(2); // mid-roughing: massive volume-gas accumulation imbalance
    const rep = computeFlows(sim, ['ch']);
    expect(rep.diagnoses[0].verdict).toBe('transient');
  });

  it('viton system reports a distinct permeation source', () => {
    const sim = new Sim(base({
      nodes: [{
        id: 'ch', volume: 5, label: 'chamber',
        surfaces: [{ area: 10, material: 'viton' }],
      }],
      pumps: [{ id: 'pump1', node: 'ch', model: { kind: 'displacement', sPeak: 20, pUlt: 1e-9 }, on: true }],
    }));
    sim.advance(60);
    const rep = computeFlows(sim);
    const kinds = rep.sources.map((s) => s.kind);
    expect(kinds).toContain('permeation');
    const perm = rep.sources.find((s) => s.kind === 'permeation')!;
    const he = rep.t >= 0 ? perm.bySpecies[3] : 0; // species order: air, H2O, H2, He
    expect(he).toBeGreaterThan(0);
  });
});

describe('capacity snapshot', () => {
  it('capture pumps expose a growing capacityFrac; throughput pumps stay null', () => {
    const sim = new Sim(base({
      nodes: [{ id: 'ch', volume: 2, label: 'chamber' }],
      pumps: [
        { id: 'sorb', node: 'ch', model: { kind: 'sorption', sPeak: 5, pUlt: 1e-3, capacity: 300 }, on: true },
        { id: 'rough', node: 'ch', model: { kind: 'displacement', sPeak: 1, pUlt: 1e-3 }, on: false },
      ],
    }));
    sim.advance(120); // swallows a good chunk of 2 L × 760 Torr
    const snap = sim.snapshot();
    const sorb = snap.pumps.find((p) => p.id === 'sorb')!;
    const rough = snap.pumps.find((p) => p.id === 'rough')!;
    expect(sorb.capacityFrac).not.toBeNull();
    expect(sorb.capacityFrac!).toBeGreaterThan(0.5);
    expect(sorb.capacityUsed.reduce((a, b) => a + b, 0)).toBeGreaterThan(150);
    expect(rough.capacityFrac).toBeNull();
  });
});

describe('cracking patterns', () => {
  it('fractions sum to ~1 per species', () => {
    for (const [g, rows] of Object.entries(CRACKING)) {
      const sum = rows.reduce((a, [, f]) => a + f, 0);
      expect(Math.abs(sum - 1), g).toBeLessThan(0.02);
    }
  });

  it('air lands on 28/32/40 in atmospheric proportions', () => {
    const spec = buildSpectrum(['air'] as GasId[], [760]);
    expect(spec[28] / spec[32]).toBeCloseTo((0.725 * ION_SENSITIVITY.air) / (0.189 * ION_SENSITIVITY.air), 5);
    expect(spec[28]).toBeGreaterThan(spec[32]);
    expect(spec[32]).toBeGreaterThan(spec[40]);
  });

  it('mass-28 overlap stacks N2 and CO2 fragments', () => {
    const species = ['N2', 'CO2'] as GasId[];
    const spec = buildSpectrum(species, [1e-6, 1e-6]);
    const expected = 1e-6 * ION_SENSITIVITY.N2 * 0.93 + 1e-6 * ION_SENSITIVITY.CO2 * 0.08;
    expect(spec[28]).toBeCloseTo(expected, 12);
    // water ladder
    const w = buildSpectrum(['H2O'] as GasId[], [1e-6]);
    expect(w[18]).toBeGreaterThan(w[17]);
    expect(w[17]).toBeGreaterThan(w[16]);
  });
});
