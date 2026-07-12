import type { GasId, MaterialId, SurfaceSpec } from '../types';
import { MATERIALS, bakeEnhancement } from '../data/materials';

/**
 * Gas loads (§1.4): outgassing and permeation. Leaks are network edges to the
 * atmosphere boundary node (see network.ts), so they are handled implicitly
 * by the solver.
 *
 * Outgassing per wetted surface:
 *   Q_g(t) = q1_g · A · (t1/(t_exp + t0))^n,  t1 = 3600 s, t0 = 60 s,
 * with t_exp counted since the surface was last vented (its node exceeded
 * 100 Torr). Unbaked metals emit mostly H2O; a completed bake permanently
 * divides the H2O component by 100 and adds the material's baked H2 rate
 * (treated as constant — bulk-diffusion limited, documented simplification).
 * During a bake at T the whole rate is multiplied by 10^((T-20)/60).
 *
 * Permeation (elastomer seals only): constant Q = K_perm · A_seal for He and
 * H2O — the real, instructive floor of O-ring systems at ~1e-8..1e-9 Torr.
 */

const T1 = 3600;
const T0 = 60;

export class SurfaceRuntime {
  readonly nodeIdx: number;
  readonly area: number;
  readonly material: MaterialId;
  baked: boolean;
  /** sim time when this surface last saw > 100 Torr */
  exposureStart = 0;
  /** bake temperature currently applied, or null */
  bakingAtC: number | null = null;

  constructor(nodeIdx: number, spec: SurfaceSpec) {
    this.nodeIdx = nodeIdx;
    this.area = spec.area;
    this.material = spec.material;
    this.baked = spec.baked ?? false;
  }

  /**
   * Add this surface's outgassing + permeation into qOut (nSpecies-length,
   * Torr·L/s), for sim time t.
   */
  addLoads(t: number, species: GasId[], humidityRH: number, qOut: Float64Array): void {
    const mat = MATERIALS[this.material];
    const tExp = Math.max(0, t - this.exposureStart);
    const decay = mat.n === 0 ? 1 : Math.pow(T1 / (tExp + T0), mat.n);
    const bakeFac = this.bakingAtC !== null ? bakeEnhancement(this.bakingAtC) : 1;
    const rhFac = Math.max(0.02, humidityRH / 50);

    if (!this.baked) {
      const q = mat.q1Unbaked * this.area * decay * bakeFac;
      for (const [g, frac] of Object.entries(mat.speciesUnbaked) as [GasId, number][]) {
        const gi = species.indexOf(g);
        if (gi >= 0) qOut[gi] += q * frac * (g === 'H2O' ? rhFac : 1);
      }
    } else {
      // residual (100×-reduced) H2O component, still time-decaying
      const qResidual = (mat.q1Unbaked / 100) * this.area * decay * bakeFac;
      for (const [g, frac] of Object.entries(mat.speciesUnbaked) as [GasId, number][]) {
        if (g !== 'H2O') continue;
        const gi = species.indexOf(g);
        if (gi >= 0) qOut[gi] += qResidual * frac * rhFac;
      }
      // baked component (H2 for metals): constant rate from the table
      if (mat.q1Baked !== null && mat.speciesBaked) {
        const qB = mat.q1Baked * this.area * bakeFac;
        for (const [g, frac] of Object.entries(mat.speciesBaked) as [GasId, number][]) {
          const gi = species.indexOf(g);
          if (gi >= 0) qOut[gi] += qB * frac;
        }
      }
    }

    // permeation through elastomer seals: constant, He + H2O
    if (mat.permeationHe) {
      const gi = species.indexOf('He');
      if (gi >= 0) qOut[gi] += mat.permeationHe * this.area;
    }
    if (mat.permeationH2O) {
      const gi = species.indexOf('H2O');
      if (gi >= 0) qOut[gi] += mat.permeationH2O * this.area;
    }
  }

  /** Called when a bake completes on this surface. */
  completeBake(): void {
    if (this.bakingAtC !== null && MATERIALS[this.material].bakeable) {
      this.baked = true;
    }
    this.bakingAtC = null;
  }
}
