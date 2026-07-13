import type { MaterialId, MaterialSpec } from '../types';

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
    permeationHe: 1e-9, permeationH2O: 1e-9,
  },
  'buna-n': {
    id: 'buna-n', name: 'Buna-N (seal)',
    q1Unbaked: 3e-6, n: 0.5, speciesUnbaked: H2O_ONLY,
    q1Baked: null, speciesBaked: null, bakeable: false,
    permeationHe: 2e-9, permeationH2O: 2e-9,
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
  // Constant-rate synthetic material for the validation suite (n = 0).
  'test-constant': {
    id: 'test-constant', name: 'Test (constant rate)',
    q1Unbaked: 1e-7, n: 0.0, speciesUnbaked: { air: 1 },
    q1Baked: null, speciesBaked: null, bakeable: false,
  },
};

/** Bake enhancement: ×10 per 60 °C above 20 °C (documented Arrhenius stand-in). */
export function bakeEnhancement(temperatureC: number): number {
  return Math.pow(10, Math.max(0, temperatureC - 20) / 60);
}
