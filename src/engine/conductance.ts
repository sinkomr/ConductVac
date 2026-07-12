import type { ConductanceSpec, GasId } from '../types';
import { GASES, molecularSpeciesFactor, viscousSpeciesFactor } from '../data/gases';

/**
 * Regime-aware conductance (§1.2). Air at 20 °C through a circular tube
 * (d, L in cm, p̄ in Torr, C in L/s):
 *
 *   viscous (Poiseuille):    C_visc = 180 · d⁴/L · p̄
 *   molecular (long tube):   C_mol  = 12.1 · d³/L
 *   molecular aperture:      C_ap   = 11.6 · A         (A in cm²)
 *   Knudsen interpolation:   C = C_visc + Z·C_mol,
 *     Z = (1 + 2.507·(d/2λ)) / (1 + 3.095·(d/2λ)),  λ [cm] = 5.0e-3 / p̄ [Torr]
 *
 * Short-tube correction (Dushman approximation, good to ~10% vs Clausing):
 *   1/C_mol_short = 1/C_ap + 1/C_mol_long
 *
 * Species scaling: molecular terms × sqrt(28.97/M_g), viscous × (μ_air/μ_g).
 * The Knudsen number is evaluated with the air mean free path at the TOTAL
 * mean pressure (documented approximation for mixtures).
 *
 * Apertures in the continuum limit are given the choked-orifice value
 * ~20·A L/s for air (blended smoothly from the molecular 11.6·A); this is
 * conservative for small pressure ratios (fidelity note).
 */

const LAMBDA_AIR = 5.0e-3; // cm·Torr

function knudsenZ(d: number, pMean: number): number {
  // d/(2λ) = d·p̄ / (2·5e-3) = 100·d·p̄
  const x = 100 * d * pMean;
  return (1 + 2.507 * x) / (1 + 3.095 * x);
}

/** Aperture conductance for air with viscous/choked blend, L/s. */
function apertureAir(area: number, pMean: number): number {
  const d = 2 * Math.sqrt(area / Math.PI);
  const x = 100 * d * pMean; // inverse Knudsen measure
  const blend = x / (x + 3); // 0 → molecular, 1 → continuum
  return area * (11.6 + (20 - 11.6) * blend);
}

export interface EdgeConductanceModel {
  /**
   * conductance for species index (of the active set) at mean total pressure
   * p̄, with valve opening fraction 0..1 (throttle valves scale the aperture
   * area; other elements scale C linearly — documented approximation)
   */
  cOf(gIdx: number, pMean: number, open: number): number;
  /** fully-open molecular-limit conductance for species (for display) */
  cMolecular(gIdx: number): number;
}

/** Precompiles a ConductanceSpec for the active species set (mesh factor applied by solver). */
export function compileConductance(spec: ConductanceSpec, species: GasId[]): EdgeConductanceModel {
  const mf = species.map((g) => molecularSpeciesFactor(g));
  const vf = species.map((g) => viscousSpeciesFactor(g));

  switch (spec.kind) {
    case 'tube': {
      const d = spec.d;
      const Leff = spec.L * (spec.lengthFactor ?? 1) + 1.33 * d * (spec.bends90 ?? 0);
      const L = Math.max(Leff, 1e-3);
      const area = Math.PI * (d / 2) ** 2;
      const cMolLong = 12.1 * d ** 3 / L;
      const cAp = 11.6 * area;
      const cMolShort = 1 / (1 / cAp + 1 / cMolLong);
      const viscFac = 180 * d ** 4 / L;
      return {
        cOf: (gi, pMean, open) =>
          open * (viscFac * pMean * vf[gi] + knudsenZ(d, pMean) * cMolShort * mf[gi]),
        cMolecular: (gi) => cMolShort * mf[gi],
      };
    }
    case 'aperture': {
      const area = spec.area;
      return {
        cOf: (gi, pMean, open) => open * apertureAir(area, pMean) * mf[gi],
        cMolecular: (gi) => 11.6 * area * mf[gi],
      };
    }
    case 'tubeAperture': {
      // butterfly/throttle: aperture (scaled by opening fraction) in series with the body tube
      const tube = compileConductance({ kind: 'tube', d: spec.d, L: spec.L }, species);
      const areaFull = Math.max(spec.apertureArea, 1e-12);
      return {
        cOf: (gi, pMean, open) => {
          if (open <= 0) return 0;
          const cT = tube.cOf(gi, pMean, 1);
          const cA = apertureAir(areaFull * open, pMean) * mf[gi];
          return 1 / (1 / cT + 1 / cA);
        },
        cMolecular: (gi) => 1 / (1 / tube.cMolecular(gi) + 1 / (11.6 * areaFull * mf[gi])),
      };
    }
    case 'fixed': {
      const scaling = spec.speciesScaling ?? 'molecular';
      const f = species.map((g) => (scaling === 'molecular' ? molecularSpeciesFactor(g) : 1));
      return {
        cOf: (gi, _pMean, open) => open * spec.value * f[gi],
        cMolecular: (gi) => spec.value * f[gi],
      };
    }
  }
}

/** Standalone helpers (used by tests and part definitions). */
export const conductanceFormulas = {
  viscousTubeAir: (d: number, L: number, pMean: number) => 180 * d ** 4 / L * pMean,
  molecularTubeLongAir: (d: number, L: number) => 12.1 * d ** 3 / L,
  molecularApertureAir: (area: number) => 11.6 * area,
  knudsenZ,
  meanFreePathAirCm: (p: number) => LAMBDA_AIR / p,
  molecularSpeciesFactor,
  viscousSpeciesFactor,
  gasMolarMass: (g: GasId) => GASES[g].M,
};

/** Equivalent orifice diameter (cm) for a standard-conditions leak rate. */
export function leakOrificeDiameterCm(qStd: number): number {
  const cAir = qStd / 760; // L/s
  const area = cAir / 11.6; // cm²
  return 2 * Math.sqrt(area / Math.PI);
}
