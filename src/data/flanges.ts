import type { FlangeSize, FlangeStandard } from '../types';

/**
 * Flange standards & nominal bores (§2.1).
 * KF/ISO carry Viton seals (wetted area per joint below); CF is copper-sealed
 * (no elastomer load); Swagelok-style compression lines are treated with a
 * small Viton-equivalent ferrule wetted area of ~0.1 cm² (approximation).
 */
export const FLANGES: FlangeSize[] = [
  // KF (QF/NW) — elastomer sealed
  { id: 'KF10', standard: 'KF', name: 'KF10', boreMm: 10, sealMaterial: 'viton', sealAreaCm2: 0.9 },
  { id: 'KF16', standard: 'KF', name: 'KF16', boreMm: 16, sealMaterial: 'viton', sealAreaCm2: 1.3 },
  { id: 'KF25', standard: 'KF', name: 'KF25', boreMm: 24, sealMaterial: 'viton', sealAreaCm2: 1.9 },
  { id: 'KF40', standard: 'KF', name: 'KF40', boreMm: 41, sealMaterial: 'viton', sealAreaCm2: 3.1 },
  { id: 'KF50', standard: 'KF', name: 'KF50', boreMm: 50, sealMaterial: 'viton', sealAreaCm2: 3.8 },
  // CF — copper gasket, bakeable
  { id: 'CF16', standard: 'CF', name: 'CF16 (1.33")', boreMm: 16, sealMaterial: null, sealAreaCm2: 0 },
  { id: 'CF40', standard: 'CF', name: 'CF40 (2.75")', boreMm: 38, sealMaterial: null, sealAreaCm2: 0 },
  { id: 'CF63', standard: 'CF', name: 'CF63 (4.5")', boreMm: 63, sealMaterial: null, sealAreaCm2: 0 },
  { id: 'CF100', standard: 'CF', name: 'CF100 (6")', boreMm: 100, sealMaterial: null, sealAreaCm2: 0 },
  { id: 'CF160', standard: 'CF', name: 'CF160 (8")', boreMm: 150, sealMaterial: null, sealAreaCm2: 0 },
  { id: 'CF200', standard: 'CF', name: 'CF200 (10")', boreMm: 200, sealMaterial: null, sealAreaCm2: 0 },
  { id: 'CF250', standard: 'CF', name: 'CF250 (12")', boreMm: 250, sealMaterial: null, sealAreaCm2: 0 },
];

// ISO-K/F seal area scales with circumference: O-ring wetted strip ~0.55 cm wide
// (comparable to the KF40 ratio: 3.1 cm² / (π·4.85 cm ring) ≈ 0.2 cm... we use
// measured KF trend extrapolated: area ≈ 0.024 cm²/mm of bore circumference).
const ISO_BORES: [string, number][] = [
  ['ISO63', 70], ['ISO80', 83], ['ISO100', 102], ['ISO160', 153], ['ISO200', 213],
  ['ISO250', 261], ['ISO320', 318], ['ISO400', 400], ['ISO500', 501],
];
for (const [id, bore] of ISO_BORES) {
  FLANGES.push({
    id, standard: 'ISO', name: id, boreMm: bore, sealMaterial: 'viton',
    sealAreaCm2: Math.round(Math.PI * bore * 0.024 * 10) / 10,
  });
}

// Compression / Swagelok-style small gas lines
FLANGES.push(
  { id: 'SWG14', standard: 'SWG', name: '1/4" compression', boreMm: 4.6, sealMaterial: 'viton', sealAreaCm2: 0.1 },
  { id: 'SWG38', standard: 'SWG', name: '3/8" compression', boreMm: 7.7, sealMaterial: 'viton', sealAreaCm2: 0.15 },
  { id: 'SWG12', standard: 'SWG', name: '1/2" compression', boreMm: 10.2, sealMaterial: 'viton', sealAreaCm2: 0.2 },
);

export const FLANGE_BY_ID: Record<string, FlangeSize> = Object.fromEntries(
  FLANGES.map((f) => [f.id, f]),
);

export function flangesOfStandard(std: FlangeStandard): FlangeSize[] {
  return FLANGES.filter((f) => f.standard === std);
}

/** Adapters exist between any two standards; the smaller bore governs conductance. */
export function adapterExists(a: string, b: string): boolean {
  return a in FLANGE_BY_ID && b in FLANGE_BY_ID;
}
