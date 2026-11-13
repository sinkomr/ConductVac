import type { GasId, MaterialId, MaterialSpec } from '../types';

/**
 * Outgassing table (§2.6). q1 in Torr·L/s/cm² at t1 = 1 h after air exposure.
 * These are order-of-magnitude, surface-history-dependent quantities.
 * Sources: O'Hanlon, "A User's Guide to Vacuum Technology" (outgassing
 * appendices); Pfeiffer Vacuum Know-How; Leybold Fundamentals.
 *
 * Species split: unbaked metals outgas overwhelmingly water; fully baked
 * metals outgas hydrogen (diffusion from the bulk, quasi-constant → the baked
 * component is applied without time decay, documented simplification).
 */
/**
 * Elastomer gas permeabilities, scc·cm/(s·cm²·atm) at 20–30 °C: mid-range of
 * the values tabulated by R. N. Peacock, J. Vac. Sci. Technol. 17, 330
 * (1980), as reproduced in Sturm et al., J. Geophys. Res. 109, D04309 (2004)
 * and P. Chiggiato, CERN Accelerator School notes (arXiv:2006.07124):
 *   Viton   He 9–16, N2 0.05–0.3, O2 1.0–1.1, CO2 5.8–6.0, H2O 40   (×1e-8)
 *   Buna-N  He 5.2–8, N2 0.2–2.0, O2 0.7–6.0, CO2 5.7–48, H2O 760   (×1e-8)
 * H2 from vendor tables (Viton 1–2, Buna-N 2.5). Sources disagree by up to
 * ×10 for a single gas/material pair — treat as order-of-magnitude.
 * 'air' is the 78/21 N2/O2 blend for the reduced species set; Ar is omitted
 * (no tabulated value; 1% of the atmosphere).
 */
const airBlend = (n2: number, o2: number) => 0.78 * n2 + 0.21 * o2;
const VITON_PERMEABILITY: Partial<Record<GasId, number>> = {
  He: 12e-8, H2: 1.5e-8, N2: 0.2e-8, O2: 1.0e-8, CO2: 5.9e-8, H2O: 40e-8,
  air: airBlend(0.2e-8, 1.0e-8),
};
const BUNA_PERMEABILITY: Partial<Record<GasId, number>> = {
  He: 6e-8, H2: 2.5e-8, N2: 1e-8, O2: 2.5e-8, CO2: 25e-8, H2O: 760e-8,
  air: airBlend(1e-8, 2.5e-8),
};

/**
 * Effective permeation path of an O-ring seal, cm. Q = K·A·Δp/w with A the
 * wetted seal area the flange table carries and w the distance through the
 * compressed cord; A/w ≈ 0.7 × the ring circumference for KF/ISO hardware.
 */
const SEAL_PATH_CM = 0.3;

/**
 * Steady permeation through a seal, Torr·L/s: gas `gas` at partial pressure
 * pOutsideTorr on the atmosphere side, vacuum inside.
 *   Q = K [scc·cm/(s·cm²·atm)] · 0.76 [Torr·L/scc] · (A/w) [cm] · p/760 [atm]
 * For Viton in 50% RH lab air that is ≈ 1e-8 (air) + 1e-8 (H2O) Torr·L/s per
 * cm² of seal — consistent with the ~1e-8 Torr·L/s per cm of O-ring rule of
 * thumb — and only ~2e-12 for helium at its 5 ppm atmospheric abundance.
 */
export function sealPermeation(material: MaterialId, gas: GasId, pOutsideTorr: number, areaCm2: number): number {
  const k = MATERIALS[material].permeability?.[gas];
  if (!k) return 0;
  return (k * 1e-3 * areaCm2 * pOutsideTorr) / SEAL_PATH_CM;
}

const METAL_UNBAKED = { H2O: 0.95, H2: 0.05 } as const;
const H2_ONLY = { H2: 1 } as const;
const H2O_ONLY = { H2O: 1 } as const;

export const MATERIALS: Record<MaterialId, MaterialSpec> = {
  'ss304': {
    id: 'ss304', name: 'SS304/316 as-received',
    q1Unbaked: 3e-8, n: 1.0, speciesUnbaked: METAL_UNBAKED,
    q1Baked: 3e-11, speciesBaked: H2_ONLY, bakeable: true,
  },
  'ss-ep': {
    id: 'ss-ep', name: 'SS electropolished',
    q1Unbaked: 6e-9, n: 1.0, speciesUnbaked: METAL_UNBAKED,
    q1Baked: 1e-11, speciesBaked: H2_ONLY, bakeable: true,
  },
  'al6061': {
    id: 'al6061', name: 'Aluminum 6061',
    q1Unbaked: 6e-9, n: 1.0, speciesUnbaked: METAL_UNBAKED,
    q1Baked: 1e-11, speciesBaked: H2_ONLY, bakeable: true,
  },
  'mild-steel': {
    id: 'mild-steel', name: 'Mild steel',
    q1Unbaked: 3e-7, n: 0.9, speciesUnbaked: METAL_UNBAKED,
    q1Baked: null, speciesBaked: null, bakeable: false,
  },
  'copper-ofhc': {
    id: 'copper-ofhc', name: 'Copper (OFHC)',
    q1Unbaked: 2e-8, n: 1.0, speciesUnbaked: METAL_UNBAKED,
    q1Baked: 2e-11, speciesBaked: H2_ONLY, bakeable: true,
  },
  'borosilicate': {
    id: 'borosilicate', name: 'Borosilicate glass',
    q1Unbaked: 7e-9, n: 1.0, speciesUnbaked: H2O_ONLY,
    q1Baked: 1e-10, speciesBaked: H2O_ONLY, bakeable: true,
  },
  'alumina': {
    id: 'alumina', name: 'Alumina ceramic',
    q1Unbaked: 1e-8, n: 1.0, speciesUnbaked: H2O_ONLY,
    q1Baked: null, speciesBaked: null, bakeable: false,
  },
  'viton': {
    id: 'viton', name: 'Viton (seal)',
    q1Unbaked: 1e-6, n: 0.6, speciesUnbaked: H2O_ONLY,
    q1Baked: 2e-7, speciesBaked: H2O_ONLY, bakeable: true, // mild bake only
    permeability: VITON_PERMEABILITY,
  },
  'buna-n': {
    id: 'buna-n', name: 'Buna-N (seal)',
    q1Unbaked: 3e-6, n: 0.5, speciesUnbaked: H2O_ONLY,
    q1Baked: null, speciesBaked: null, bakeable: false,
    permeability: BUNA_PERMEABILITY,
  },
  'ptfe': {
    id: 'ptfe', name: 'PTFE',
    q1Unbaked: 8e-7, n: 0.5, speciesUnbaked: H2O_ONLY,
    q1Baked: null, speciesBaked: null, bakeable: false,
  },
  'peek': {
    id: 'peek', name: 'PEEK',
    q1Unbaked: 3e-7, n: 0.5, speciesUnbaked: H2O_ONLY,
    q1Baked: null, speciesBaked: null, bakeable: false,
  },
  'kapton': {
    id: 'kapton', name: 'Kapton',
    q1Unbaked: 1e-7, n: 0.7, speciesUnbaked: H2O_ONLY,
    q1Baked: null, speciesBaked: null, bakeable: false,
  },
  // Rate is per GEOMETRIC cm² with the porous internal surface folded in —
  // graphite adsorbs water throughout its open porosity and outgasses for
  // ages (n = 0.5, bulk-diffusion signature). Bakeable, and worth it.
  'graphite': {
    id: 'graphite', name: 'Graphite (porous)',
    q1Unbaked: 5e-7, n: 0.5, speciesUnbaked: { H2O: 0.85, H2: 0.15 },
    q1Baked: 5e-10, speciesBaked: H2_ONLY, bakeable: true,
  },
  'nylon': {
    id: 'nylon', name: 'Nylon / polyamide',
    q1Unbaked: 2e-6, n: 0.5, speciesUnbaked: H2O_ONLY,
    q1Baked: null, speciesBaked: null, bakeable: false,
  },
  'epoxy-fr4': {
    id: 'epoxy-fr4', name: 'Epoxy / FR4 board',
    q1Unbaked: 3e-7, n: 0.5, speciesUnbaked: H2O_ONLY,
    q1Baked: null, speciesBaked: null, bakeable: false,
  },
  // Constant-rate synthetic material for the validation suite (n = 0).
  'test-constant': {
    id: 'test-constant', name: 'Test (constant rate)',
    q1Unbaked: 1e-7, n: 0.0, speciesUnbaked: { air: 1 },
    q1Baked: null, speciesBaked: null, bakeable: false,
  },
};

/** Arrhenius stand-in: ×10 per 60 °C from 20 °C, continuous both directions (cold surfaces outgas less). */
export function bakeEnhancement(temperatureC: number): number {
  return Math.pow(10, (temperatureC - 20) / 60);
}
