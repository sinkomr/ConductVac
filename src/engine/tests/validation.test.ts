import { describe, expect, it } from 'vitest';
import { Sim } from '../solver';
import { compileConductance } from '../conductance';
import type { EngineSystemSpec } from '../../types';

/**
 * The §1.6 validation suite — all seven must pass before any UI work.
 * Single-species (air) systems are used where the reference is analytic.
 */

/** analytic solution of p' = A p for 2×2 A with distinct real eigenvalues */
function twoByTwo(A: number[][], p0: [number, number]): (t: number) => [number, number] {
  const tr = A[0][0] + A[1][1];
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const disc = Math.sqrt(tr * tr - 4 * det);
  const l1 = (tr + disc) / 2;
  const l2 = (tr - disc) / 2;
  // eigenvectors (A - λI)v = 0 → v = [b, λ - a] (works when b ≠ 0)
  const v1 = [A[0][1], l1 - A[0][0]];
  const v2 = [A[0][1], l2 - A[0][0]];
  // solve c1 v1 + c2 v2 = p0
  const D = v1[0] * v2[1] - v2[0] * v1[1];
  const c1 = (p0[0] * v2[1] - v2[0] * p0[1]) / D;
  const c2 = (v1[0] * p0[1] - p0[0] * v1[1]) / D;
  return (t) => {
    const e1 = c1 * Math.exp(l1 * t);
    const e2 = c2 * Math.exp(l2 * t);
    return [e1 * v1[0] + e2 * v2[0], e1 * v1[1] + e2 * v2[1]];
  };
}

/** a fixed-speed pump = displacement model with negligible ultimate pressure */
const fixedS = (sPeak: number) => ({ kind: 'displacement' as const, sPeak, pUlt: 1e-30 });

describe('§1.6 validation suite', () => {
  it('1. single volume + fixed-S pump: p = p0 exp(-St/V) within 0.5% over 6 decades', () => {
    const V = 10;
    const S = 5;
    const spec: EngineSystemSpec = {
      species: ['air'],
      nodes: [{ id: 'ch', volume: V }],
      edges: [],
      pumps: [{ id: 'p1', node: 'ch', model: fixedS(S), on: true }],
    };
    const sim = new Sim(spec);
    const p0 = sim.pressureOf('ch');
    expect(p0).toBeCloseTo(760, 6);
    const tEnd = (V / S) * Math.log(1e6); // 6 decades
    const nCheck = 12;
    for (let k = 1; k <= nCheck; k++) {
      sim.advance(tEnd / nCheck);
      const expected = p0 * Math.exp((-S * sim.t) / V);
      const rel = Math.abs(sim.pressureOf('ch') - expected) / expected;
      expect(rel).toBeLessThan(0.005);
    }
    expect(sim.pressureOf('ch') / p0).toBeLessThan(1.1e-6);
  });

  it('2. two volumes through a fixed conductance, one pumped: matches two-exponential analytic', () => {
    const V1 = 20, V2 = 5, C = 2, S = 4;
    const spec: EngineSystemSpec = {
      species: ['air'],
      nodes: [
        { id: 'a', volume: V1 },
        { id: 'b', volume: V2 },
      ],
      edges: [{ id: 'e', a: 'a', b: 'b', conductance: { kind: 'fixed', value: C, speciesScaling: 'none' } }],
      pumps: [{ id: 'p1', node: 'a', model: fixedS(S), on: true }],
    };
    const sim = new Sim(spec);
    const exact = twoByTwo(
      [
        [-(C + S) / V1, C / V1],
        [C / V2, -C / V2],
      ],
      [760, 760],
    );
    // sample through both the fast transient and the slow tail (~4 decades)
    const samples = [0.5, 1, 2, 4, 8, 15, 25, 40, 60, 90];
    let tPrev = 0;
    for (const ts of samples) {
      sim.advance(ts - tPrev);
      tPrev = ts;
      const [ea, eb] = exact(ts);
      expect(Math.abs(sim.pressureOf('a') - ea) / ea).toBeLessThan(0.01);
      expect(Math.abs(sim.pressureOf('b') - eb) / eb).toBeLessThan(0.01);
    }
  });

  it('3. conductance-limited pumping: 1/S_eff = 1/S + 1/C', () => {
    const S = 100;
    const d = 2, L = 97;
    const qStd = 7.6e-5; // Torr·L/s leak keeps steady state deep in molecular flow
    const spec: EngineSystemSpec = {
      species: ['air'],
      nodes: [
        { id: 'ch', volume: 50 },
        { id: 'pn', volume: 0.5 },
      ],
      edges: [{ id: 'tube', a: 'ch', b: 'pn', conductance: { kind: 'tube', d, L } }],
      pumps: [{ id: 'p1', node: 'pn', model: fixedS(S), on: true }],
      leaks: [{ id: 'lk', node: 'ch', qStd }],
    };
    const sim = new Sim(spec);
    const ff = sim.fastForward();
    expect(ff.converged).toBe(true);
    const model = compileConductance({ kind: 'tube', d, L }, ['air']);
    const C = model.cMolecular(0);
    const sEff = 1 / (1 / S + 1 / C);
    const pCh = sim.pressureOf('ch');
    const qIn = (qStd / 760) * (760 - pCh);
    expect(pCh * sEff / qIn).toBeCloseTo(1, 2); // within ~1.5%
    // and the pump node sits lower by the conductance ratio
    expect(sim.pressureOf('pn') / pCh).toBeCloseTo(C / (C + S), 2);
  });

  it('4. long-tube molecular conductance within 1% of 12.1 d³/L', () => {
    const d = 1, L = 300;
    const model = compileConductance({ kind: 'tube', d, L }, ['air']);
    const cLong = 12.1 * d ** 3 / L;
    const cEngine = model.cOf(0, 1e-9, 1); // deep molecular
    expect(Math.abs(cEngine - cLong) / cLong).toBeLessThan(0.01);
  });

  it('5. viscous rough-down through a tube matches the quasi-static Poiseuille solution', () => {
    const V = 50, d = 2.5, L = 100;
    const sPeak = 5, pUlt = 1e-3;
    const spec: EngineSystemSpec = {
      species: ['air'],
      nodes: [
        { id: 'ch', volume: V },
        // negligible pump-node volume so the quasi-static reference (which
        // carries no inventory there) is exact; also exercises stiffness —
        // this node's time constant is ~30 ns against multi-second steps
        { id: 'pn', volume: 1e-4 },
      ],
      edges: [{ id: 'tube', a: 'ch', b: 'pn', conductance: { kind: 'tube', d, L } }],
      pumps: [{ id: 'p1', node: 'pn', model: { kind: 'displacement', sPeak, pUlt }, on: true }],
    };
    const sim = new Sim(spec);
    const model = compileConductance({ kind: 'tube', d, L }, ['air']);

    // quasi-static reference: V dp1/dt = -Q, where Q solves
    // C(p̄)·(p1 - p2) = S(p2)·p2 (pump-node volume neglected)
    const sOf = (p: number) => sPeak * Math.max(0, 1 - pUlt / p);
    const qOf = (p1: number): number => {
      let lo = pUlt, hi = p1;
      for (let i = 0; i < 200; i++) {
        const p2 = 0.5 * (lo + hi);
        const flow = model.cOf(0, 0.5 * (p1 + p2), 1) * (p1 - p2);
        const pumped = sOf(p2) * p2;
        if (flow > pumped) lo = p2;
        else hi = p2;
      }
      const p2 = 0.5 * (lo + hi);
      return sOf(p2) * p2;
    };
    // integrate the reference with RK4
    let pRef = 760;
    let tRef = 0;
    const refAt = (t: number): number => {
      const h = 0.002;
      while (tRef + h <= t) {
        const f = (p: number) => -qOf(p) / V;
        const k1 = f(pRef);
        const k2 = f(pRef + 0.5 * h * k1);
        const k3 = f(pRef + 0.5 * h * k2);
        const k4 = f(pRef + h * k3);
        pRef += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
        tRef += h;
      }
      return pRef;
    };

    // compare down to ~0.5 Torr (viscous/transitional region)
    let tPrev = 0;
    for (const ts of [2, 5, 10, 20, 35, 55, 80]) {
      sim.advance(ts - tPrev);
      tPrev = ts;
      const ref = refAt(ts);
      if (ref < 0.5) break;
      const rel = Math.abs(sim.pressureOf('ch') - ref) / ref;
      expect(rel).toBeLessThan(0.03);
    }
  });

  it('6. outgassing-dominated steady state: p_ss = Q_total / S_eff', () => {
    const area = 1000; // cm² of constant-rate test material: Q = 1e-7·1000 = 1e-4 Torr·L/s
    const S = 10;
    const spec: EngineSystemSpec = {
      species: ['air'],
      nodes: [{ id: 'ch', volume: 20, surfaces: [{ area, material: 'test-constant' }] }],
      edges: [],
      pumps: [{ id: 'p1', node: 'ch', model: fixedS(S), on: true }],
    };
    const sim = new Sim(spec);
    const ff = sim.fastForward();
    expect(ff.converged).toBe(true);
    const pExpected = (1e-7 * area) / S;
    expect(sim.pressureOf('ch') / pExpected).toBeCloseTo(1, 3);
  });

  it('7. stiffness: 0.05 L node between a 300 L/s pump and a 100 L chamber stays stable and accurate at dt >> V/C', () => {
    const V1 = 100, V2 = 0.05, C = 50, S = 300;
    // fast time constant V2/(C+S) ≈ 1.4e-4 s; dt is allowed to reach 10 s
    const spec: EngineSystemSpec = {
      species: ['air'],
      nodes: [
        { id: 'ch', volume: V1, initial: { air: 1e-3 } },
        { id: 'nd', volume: V2, initial: { air: 1e-3 } },
      ],
      edges: [{ id: 'e', a: 'ch', b: 'nd', conductance: { kind: 'fixed', value: C, speciesScaling: 'none' } }],
      pumps: [{ id: 'p1', node: 'nd', model: fixedS(S), on: true }],
      startAtAtmosphere: false,
    };
    const sim = new Sim(spec);
    let maxDtSeen = 0;
    sim.onSample = () => {
      maxDtSeen = Math.max(maxDtSeen, sim.dt);
    };
    const exact = twoByTwo(
      [
        [-C / V1, C / V1],
        [C / V2, -(C + S) / V2],
      ],
      [1e-3, 1e-3],
    );
    let tPrev = 0;
    for (const ts of [0.5, 1, 2, 4, 8, 12, 16, 20]) {
      sim.advance(ts - tPrev);
      tPrev = ts;
      const [ea, eb] = exact(ts);
      expect(Number.isFinite(sim.pressureOf('ch'))).toBe(true);
      expect(Math.abs(sim.pressureOf('ch') - ea) / ea).toBeLessThan(0.01);
      expect(Math.abs(sim.pressureOf('nd') - eb) / eb).toBeLessThan(0.02);
    }
    // solver must have escaped the stiff scale: dt far beyond V2/(C+S)
    expect(maxDtSeen).toBeGreaterThan(1.0);
    expect(sim.stats.steps).toBeLessThan(3000);
  });
});
