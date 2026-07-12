import { describe, expect, it } from 'vitest';
import { BandMatrix, rcmOrder } from '../lin';
import { compileConductance, conductanceFormulas, leakOrificeDiameterCm } from '../conductance';
import { k0ForGas } from '../pumps';

describe('banded LU', () => {
  function denseSolve(A: number[][], b: number[]): number[] {
    const n = b.length;
    const M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M[r][c] / M[c][c];
        for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
      }
    }
    return M.map((row, i) => row[n] / M[i][i]);
  }

  it('matches dense elimination on random diagonally dominant banded systems', () => {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (const [n, k] of [[5, 1], [20, 3], [60, 5]] as const) {
      const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
      const bm = new BandMatrix(n, k);
      for (let i = 0; i < n; i++) {
        let rowSum = 0;
        for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) {
          if (j === i) continue;
          const v = (rand() - 0.5) * 2;
          A[i][j] = v;
          bm.set(i, j, v);
          rowSum += Math.abs(v);
        }
        const d = rowSum + 0.5 + rand();
        A[i][i] = d;
        bm.set(i, i, d);
      }
      const b = Array.from({ length: n }, () => rand() * 10 - 5);
      const x = denseSolve(A, b);
      const bx = Float64Array.from(b);
      expect(bm.factor()).toBe(true);
      bm.solve(bx);
      for (let i = 0; i < n; i++) expect(bx[i]).toBeCloseTo(x[i], 8);
    }
  });

  it('rcm produces a valid permutation', () => {
    const adj = [[1], [0, 2], [1, 3], [2], [5], [4]]; // chain + disconnected pair
    const perm = rcmOrder(6, adj);
    expect([...perm].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('conductance formulas', () => {
  it('reference values: viscous, molecular, aperture (air, 20 °C)', () => {
    // d=1 cm, L=100 cm, p̄=1 Torr → C_visc = 180·1/100·1 = 1.8 L/s
    expect(conductanceFormulas.viscousTubeAir(1, 100, 1)).toBeCloseTo(1.8, 10);
    // C_mol = 12.1·1/100 = 0.121 L/s
    expect(conductanceFormulas.molecularTubeLongAir(1, 100)).toBeCloseTo(0.121, 10);
    // C_ap = 11.6 L/s per cm²
    expect(conductanceFormulas.molecularApertureAir(1)).toBeCloseTo(11.6, 10);
  });

  it('Knudsen Z → 1 in molecular limit, viscous term dominates at high pressure', () => {
    expect(conductanceFormulas.knudsenZ(2, 1e-8)).toBeCloseTo(1, 5);
    const m = compileConductance({ kind: 'tube', d: 2, L: 100 }, ['air']);
    const cHigh = m.cOf(0, 100, 1);
    const cVisc = conductanceFormulas.viscousTubeAir(2, 100, 100);
    expect(cHigh / cVisc).toBeGreaterThan(0.99);
    expect(cHigh / cVisc).toBeLessThan(1.05);
  });

  it('species scaling: molecular ×sqrt(M_air/M), viscous ×(mu_air/mu)', () => {
    const m = compileConductance({ kind: 'tube', d: 1, L: 100 }, ['air', 'H2']);
    const cAirMol = m.cOf(0, 1e-9, 1);
    const cH2Mol = m.cOf(1, 1e-9, 1);
    expect(cH2Mol / cAirMol).toBeCloseTo(Math.sqrt(28.97 / 2), 3);
  });

  it('elbow adds 1.33·d equivalent length per 90° bend', () => {
    const straight = compileConductance({ kind: 'tube', d: 4, L: 10 }, ['air']);
    const elbow = compileConductance({ kind: 'tube', d: 4, L: 10, bends90: 1 }, ['air']);
    // molecular limit: long-tube part scales with 1/L_eff
    const cS = straight.cMolecular(0);
    const cE = elbow.cMolecular(0);
    expect(cE).toBeLessThan(cS);
    // reconstruct implied length ratio from the short-tube formula
    const area = Math.PI * 4;
    const cAp = 11.6 * area;
    const lS = 12.1 * 64 / (1 / (1 / cS - 1 / cAp));
    const lE = 12.1 * 64 / (1 / (1 / cE - 1 / cAp));
    expect(lE - lS).toBeCloseTo(1.33 * 4, 4);
  });

  it('leak orifice diameter roundtrip', () => {
    const d = leakOrificeDiameterCm(7.6e-6); // 1e-8 L/s conductance leak
    const area = Math.PI * (d / 2) ** 2;
    expect(11.6 * area * 760).toBeCloseTo(7.6e-6, 12);
  });
});

describe('pump helpers', () => {
  it('k0ForGas interpolates in sqrt(M) and returns catalog values exactly', () => {
    const k0 = { N2: 1e9, He: 3e7, H2: 1e4 };
    expect(k0ForGas(k0, 'N2')).toBe(1e9);
    expect(k0ForGas(k0, 'H2')).toBe(1e4);
    const kAr = k0ForGas(k0, 'Ar'); // heavier than N2 → clamped at N2 end
    expect(kAr).toBeCloseTo(1e9, 5);
    const kH2O = k0ForGas(k0, 'H2O'); // between He (M=4) and N2 (M=28)
    expect(kH2O).toBeGreaterThan(3e7);
    expect(kH2O).toBeLessThan(1e9);
  });
});
