import type { ConductanceSpec, GasId } from '../types';
import { GASES, molecularSpeciesFactor, viscousSpeciesFactor } from '../data/gases';

/**
 * Regime-aware conductance. Air at 20 °C through a circular tube
 * (d, L in cm, p̄ in Torr, C in L/s):
 *
 *   viscous (Poiseuille):    C_visc = 180 · d⁴/L · p̄
 *   molecular (long tube):   C_mol  = 12.1 · d³/L
 *   molecular aperture:      C_ap   = 11.6 · A         (A in cm²)
 *   Knudsen interpolation:   C = C_visc + Z·C_mol,
 *     Z = (1 + 2.507·x) / (1 + 3.095·x),  x = d/2λ,  λ [cm] = 5.0e-3 / p̄ [Torr]
 *
 * Short-tube correction (Dushman approximation, good to ~10% vs Clausing):
 *   1/C_mol_short = w/C_ap + 1/C_mol_long
 * where w is the entrance weight: 1 for a stand-alone tube, and split across
 * the END segments of an auto-segmented tube so the entrance loss is counted
 * once per tube, not once per segment.
 *
 * Every element is evaluated as TWO parts, because a mixture does not flow
 * the way its components would alone:
 *
 *   diffusive part  — per species, driven by that species' own partial-
 *     pressure difference, scaling √(M_air/M_g). This is all of the flow in
 *     the molecular regime and fades as 1/(1 + k·x) in the continuum
 *     (Bosanquet interpolation between Knudsen and gas-phase diffusion:
 *     D_gas/D_Knudsen ≈ 1.8·λ/d, so k ≈ 1.1 for a tube; ≈ 1/1.2 for an
 *     aperture of depth ~d).
 *   bulk part  — everything else (Poiseuille + slip). It is driven by the
 *     TOTAL pressure difference and carries the upstream composition with
 *     it; it scales with the mixture's viscosity / mean molar mass.
 *
 * Choked-flow limit: laminar Poiseuille flow has no speed limit, so a short
 * fat element venting into vacuum would pass gas faster than sound. Tubes
 * therefore carry the sonic-orifice throughput cap Q ≤ 20·A·p_up (air),
 * applied as a series resistance b·(1 − p_dn/p_up)/(20·A) that vanishes for
 * small pressure ratios (ordinary pump-limited roughing is untouched) and in
 * the molecular regime (b = x/(x+3) → 0).
 *
 * Bare apertures in the continuum limit use the choked value ~20·A L/s for
 * air (blended smoothly from the molecular 11.6·A); this is conservative for
 * small pressure ratios (fidelity note).
 *
 * The Knudsen number is evaluated with the air mean free path at the TOTAL
 * mean pressure (documented approximation for mixtures).
 */

const LAMBDA_AIR = 5.0e-3; // cm·Torr
const C_AP_MOL = 11.6; // L/s per cm², air, molecular
const C_AP_CHOKED = 20; // L/s per cm², air, sonic orifice
/** continuum fade of the per-species (diffusive) part: C_d = C_mol/(1 + k·x) */
const K_DIFF_TUBE = 1.1;
const K_DIFF_APERTURE = 1 / 1.2;

function knudsenZx(x: number): number {
  return (1 + 2.507 * x) / (1 + 3.095 * x);
}

function knudsenZ(d: number, pMean: number): number {
  // d/(2λ) = d·p̄ / (2·5e-3) = 100·d·p̄
  return knudsenZx(100 * d * pMean);
}

export interface EdgeConductanceModel {
  /** per-species multiplier of the diffusive part (√(M_air/M_g), or 1 for unscaled fixed elements) */
  readonly molFactor: Float64Array;
  /**
   * Evaluate the element between end total pressures pA, pB (Torr) with
   * valve opening fraction 0..1 (throttle valves scale the aperture area;
   * other elements scale C linearly — documented approximation).
   *   out[0] = diffusive part for air; species g gets out[0]·molFactor[g]
   *   out[1] = bulk part for the mixture described by vfMix = μ_air/μ_mix
   *            and mfMix = √(M_air/M_mix)
   * tRel = T̄_edge/293 K scales molecular terms ×√tRel and the mean free
   * path ∝ T/p (viscosity kept at 20 °C — second-order).
   */
  split(
    pA: number, pB: number, open: number, tRel: number,
    vfMix: number, mfMix: number, out: Float64Array,
  ): void;
  /**
   * Conductance for PURE gas `gIdx` at mean pressure p̄ and negligible
   * pressure drop (so the choked-flow cap is inactive), L/s.
   */
  cOf(gIdx: number, pMean: number, open: number, tRel?: number): number;
  /** fully-open molecular-limit conductance for species (for display) */
  cMolecular(gIdx: number): number;
}

type SplitFn = EdgeConductanceModel['split'];

function finish(
  split: SplitFn, molFactor: Float64Array, vf: number[], mf: number[],
  cMolecular: (gi: number) => number,
): EdgeConductanceModel {
  const tmp = new Float64Array(2);
  return {
    molFactor,
    split,
    cOf: (gi, pMean, open, tRel = 1) => {
      split(pMean, pMean, open, tRel, vf[gi], mf[gi], tmp);
      return tmp[0] * molFactor[gi] + tmp[1];
    },
    cMolecular,
  };
}

/** aperture of `area` cm²: writes [diffusive(air), total(mixture)] */
function apertureParts(area: number, pMean: number, tRel: number, mfMix: number, out: Float64Array): void {
  const d = 2 * Math.sqrt(area / Math.PI);
  const x = (100 * d * pMean) / tRel; // inverse Knudsen measure
  const blend = x / (x + 3); // 0 → molecular, 1 → continuum
  const sT = Math.sqrt(tRel);
  out[0] = (C_AP_MOL * area * sT) / (1 + K_DIFF_APERTURE * x);
  out[1] = area * (C_AP_MOL + (C_AP_CHOKED - C_AP_MOL) * blend) * sT * mfMix;
}

/** Precompiles a ConductanceSpec for the active species set (mesh factor applied by solver). */
export function compileConductance(spec: ConductanceSpec, species: GasId[]): EdgeConductanceModel {
  const mf = species.map((g) => molecularSpeciesFactor(g));
  const vf = species.map((g) => viscousSpeciesFactor(g));
  const mfArr = Float64Array.from(mf);

  switch (spec.kind) {
    case 'tube': {
      const d = spec.d;
      const w = spec.entrance ?? 1;
      const Leff = spec.L * (spec.lengthFactor ?? 1) + 1.33 * d * (spec.bends90 ?? 0);
      const L = Math.max(Leff, 1e-3);
      const area = Math.PI * (d / 2) ** 2;
      const cMolLong = 12.1 * d ** 3 / L;
      const cAp = C_AP_MOL * area;
      const cMolShort = 1 / (w / cAp + 1 / cMolLong);
      const viscFac = 180 * d ** 4 / L;
      const split: SplitFn = (pA, pB, open, tRel, vfMix, mfMix, out) => {
        if (open <= 0) {
          out[0] = 0;
          out[1] = 0;
          return;
        }
        const pMean = 0.5 * (pA + pB);
        const x = (100 * d * pMean) / tRel;
        const sT = Math.sqrt(tRel);
        const diff = sT / (w * (1 + K_DIFF_APERTURE * x) / cAp + (1 + K_DIFF_TUBE * x) / cMolLong);
        const cKnudsen = viscFac * pMean * vfMix + knudsenZx(x) * cMolShort * sT * mfMix;
        const pUp = Math.max(pA, pB);
        const ratio = pUp > 0 ? Math.min(pA, pB) / pUp : 1;
        const capRes = ((x / (x + 3)) * (1 - ratio)) / (C_AP_CHOKED * area * sT * mfMix);
        const total = 1 / (1 / cKnudsen + capRes);
        out[0] = open * diff;
        out[1] = open * Math.max(0, total - diff * mfMix);
      };
      return finish(split, mfArr, vf, mf, (gi) => cMolShort * mf[gi]);
    }
    case 'aperture': {
      const area = spec.area;
      const split: SplitFn = (pA, pB, open, tRel, _vfMix, mfMix, out) => {
        if (open <= 0) {
          out[0] = 0;
          out[1] = 0;
          return;
        }
        apertureParts(area, 0.5 * (pA + pB), tRel, mfMix, out);
        const diff = out[0];
        out[0] = open * diff;
        out[1] = open * Math.max(0, out[1] - diff * mfMix);
      };
      return finish(split, mfArr, vf, mf, (gi) => C_AP_MOL * area * mf[gi]);
    }
    case 'tubeAperture': {
      // butterfly/throttle: aperture (scaled by opening fraction) in series with the body tube
      const tube = compileConductance({ kind: 'tube', d: spec.d, L: spec.L }, species);
      const areaFull = Math.max(spec.apertureArea, 1e-12);
      const ap = new Float64Array(2);
      const split: SplitFn = (pA, pB, open, tRel, vfMix, mfMix, out) => {
        if (open <= 0) {
          out[0] = 0;
          out[1] = 0;
          return;
        }
        tube.split(pA, pB, 1, tRel, vfMix, mfMix, out);
        const tubeDiff = out[0];
        const tubeTotal = tubeDiff * mfMix + out[1];
        apertureParts(areaFull * open, 0.5 * (pA + pB), tRel, mfMix, ap);
        const diff = 1 / (1 / tubeDiff + 1 / ap[0]);
        const total = 1 / (1 / tubeTotal + 1 / ap[1]);
        out[0] = diff;
        out[1] = Math.max(0, total - diff * mfMix);
      };
      return finish(
        split, mfArr, vf, mf,
        (gi) => 1 / (1 / tube.cMolecular(gi) + 1 / (C_AP_MOL * areaFull * mf[gi])),
      );
    }
    case 'fixed': {
      const molecular = (spec.speciesScaling ?? 'molecular') === 'molecular';
      const f = molecular ? mfArr : new Float64Array(species.length).fill(1);
      const split: SplitFn = (_pA, _pB, open, tRel, _vfMix, _mfMix, out) => {
        out[0] = open * spec.value * (molecular ? Math.sqrt(tRel) : 1);
        out[1] = 0;
      };
      return finish(split, f, vf, mf, (gi) => spec.value * f[gi]);
    }
  }
}

/** Standalone helpers (used by tests and part definitions). */
export const conductanceFormulas = {
  viscousTubeAir: (d: number, L: number, pMean: number) => 180 * d ** 4 / L * pMean,
  molecularTubeLongAir: (d: number, L: number) => 12.1 * d ** 3 / L,
  molecularApertureAir: (area: number) => C_AP_MOL * area,
  chokedApertureAir: (area: number) => C_AP_CHOKED * area,
  knudsenZ,
  meanFreePathAirCm: (p: number) => LAMBDA_AIR / p,
  molecularSpeciesFactor,
  viscousSpeciesFactor,
  gasMolarMass: (g: GasId) => GASES[g].M,
};

/** Equivalent orifice diameter (cm) for a standard-conditions leak rate. */
export function leakOrificeDiameterCm(qStd: number): number {
  const cAir = qStd / 760; // L/s
  const area = cAir / C_AP_MOL; // cm²
  return 2 * Math.sqrt(area / Math.PI);
}
