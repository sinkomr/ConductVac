import { describe, expect, it } from 'vitest';
import { Sim } from '../solver';
import { compileConductance } from '../conductance';
import { segmentTube } from '../network';
import type { EngineSystemSpec } from '../../types';

/**
 * Mixture transport and geometry bookkeeping: properties the single-gas
 * validation suite cannot see.
 */

describe('tube segmentation', () => {
  it('a segmented tube has the same molecular conductance as the unsegmented one', () => {
    for (const [d, L] of [[0.4, 100], [1.6, 100], [2.2, 200], [6.3, 100], [10, 100], [15, 50]]) {
      const single = compileConductance({ kind: 'tube', d, L }, ['air']).cMolecular(0);
      const seg = segmentTube({ id: 't', from: 'a', to: 'b', d, L });
      expect(seg.edges.length).toBeGreaterThan(1);
      let inv = 0;
      for (const e of seg.edges) inv += 1 / compileConductance(e.conductance, ['air']).cMolecular(0);
      expect(1 / inv / single).toBeCloseTo(1, 9);
    }
  });

  it('steady state through an ISO100 × 1 m line does not depend on segmentation', () => {
    const d = 10, L = 100;
    const pSteady = (segmented: boolean): number => {
      const seg = segmented
        ? segmentTube({ id: 't', from: 'ch', to: 'pn', d, L })
        : { nodes: [], edges: [{ id: 't', a: 'ch', b: 'pn', conductance: { kind: 'tube' as const, d, L } }] };
      const sim = new Sim({
        species: ['air'],
        nodes: [{ id: 'ch', volume: 50 }, { id: 'pn', volume: 0.5 }, ...seg.nodes.map((n) => ({ ...n, surfaces: [] }))],
        edges: seg.edges,
        pumps: [{ id: 'p', node: 'pn', model: { kind: 'displacement', sPeak: 1000, pUlt: 1e-30 }, on: true }],
        leaks: [{ id: 'lk', node: 'ch', qStd: 7.6e-5 }],
      });
      expect(sim.fastForward().converged).toBe(true);
      return sim.pressureOf('ch');
    };
    expect(pSteady(true) / pSteady(false)).toBeCloseTo(1, 3);
  });
});

describe('mixture transport', () => {
  it('viscous roughing through a narrow line does not un-mix the gas', () => {
    const spec: EngineSystemSpec = {
      species: ['air', 'H2O', 'H2', 'He'],
      nodes: [{ id: 'ch', volume: 100 }, { id: 'pn', volume: 0.01 }],
      edges: [{ id: 't', a: 'ch', b: 'pn', conductance: { kind: 'tube', d: 0.6, L: 200 } }],
      pumps: [{ id: 'p', node: 'pn', model: { kind: 'displacement', sPeak: 20, pUlt: 1e-3 }, on: true }],
    };
    const sim = new Sim(spec);
    const frac = (g: string) => sim.partialOf('ch', g) / sim.pressureOf('ch');
    const x0 = { H2O: frac('H2O'), He: frac('He'), H2: frac('H2') };
    for (const t of [30, 120, 480]) {
      sim.advance(t - sim.t);
      // still deep in the continuum regime for a 6 mm bore (d/2λ > 100)
      expect(sim.pressureOf('ch')).toBeGreaterThan(2);
      expect(frac('H2O') / x0.H2O).toBeCloseTo(1, 2);
      expect(frac('He') / x0.He).toBeCloseTo(1, 2);
      expect(frac('H2') / x0.H2).toBeCloseTo(1, 2);
    }
  });

  it('gas does not diffuse upstream against a viscous flow, and every species is conserved', () => {
    // a 760 Torr air volume discharging into a 50 Torr helium volume
    const Va = 10, Vb = 10;
    const spec: EngineSystemSpec = {
      species: ['air', 'He'],
      nodes: [
        { id: 'a', volume: Va, initial: { air: 760 } },
        { id: 'b', volume: Vb, initial: { He: 50 } },
      ],
      edges: [{ id: 't', a: 'a', b: 'b', conductance: { kind: 'tube', d: 1, L: 50 } }],
      startAtAtmosphere: false,
    };
    const sim = new Sim(spec);
    const floor = sim.opts.pFloor;
    const inventory = (g: string) => sim.partialOf('a', g) * Va + sim.partialOf('b', g) * Vb;
    const air0 = inventory('air'), he0 = inventory('He');
    sim.advance(30);
    // pressures have equalised…
    expect(sim.pressureOf('a') / sim.pressureOf('b')).toBeCloseTo(1, 3);
    // …each gas is conserved. Helium, which barely moves, exactly; the air
    // to ~1.5%: backward Euler in ln p is exact for decays but drops
    // O(Δ(ln p)²) of the inflow while a near-empty volume fills (README,
    // model limitations)
    expect(Math.abs(inventory('air') / air0 - 1)).toBeLessThan(0.02);
    expect(Math.abs((inventory('He') - floor * Va) / he0 - 1)).toBeLessThan(1e-4);
    expect(Math.abs(sim.pressureOf('a') / ((760 * Va + 50 * Vb) / (Va + Vb)) - 1)).toBeLessThan(0.02);
    // …and the helium is still on its own side: only gas-phase diffusion
    // (D ~ 1 cm²/s here ⇒ ~1e-5 L/s through this tube) can carry it upstream
    expect(sim.partialOf('a', 'He')).toBeLessThan(1e-2);
    expect(sim.partialOf('b', 'He')).toBeGreaterThan(49.9);
  });
});

describe('choked flow', () => {
  it('venting through a small valve is limited to the sonic-orifice throughput', () => {
    const V = 100, d = 0.4;
    const sim = new Sim({
      species: ['air'],
      nodes: [{ id: 'ch', volume: V, initial: { air: 1e-3 } }],
      edges: [{ id: 'v', a: 'ch', b: '_atm', conductance: { kind: 'tube', d, L: 5 }, open: 1 }],
      startAtAtmosphere: false,
    });
    while (sim.pressureOf('ch') < 380 && sim.t < 600) sim.advance(0.25);
    // dp/dt = 20·A·760/V while the valve is choked (O'Hanlon: C = 20·A L/s for air)
    const tChoked = (380 * V) / (20 * Math.PI * (d / 2) ** 2 * 760);
    expect(sim.t / tChoked).toBeGreaterThan(0.9);
    expect(sim.t / tChoked).toBeLessThan(1.15);
  });

  it('barely touches ordinary pump-limited roughing', () => {
    // KF25 × 1 m feeding a 5 L/s pump at 100 Torr: the gas moves at ~11 m/s,
    // about 5% of the choked speed, so the line keeps ≥ 94% of its Poiseuille
    // conductance (and its pressure drop is < 0.1% of p either way)
    const model = compileConductance({ kind: 'tube', d: 2.4, L: 100 }, ['air']);
    const cPoiseuille = model.cOf(0, 100, 1);
    const drop = (5 * 100) / cPoiseuille;
    const out = new Float64Array(2);
    model.split(100, 100 - drop, 1, 1, 1, 1, out);
    const ratio = (out[0] + out[1]) / cPoiseuille;
    expect(ratio).toBeGreaterThan(0.94);
    expect(ratio).toBeLessThan(1);
  });
});
