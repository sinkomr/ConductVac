import type { GasId, GasSpec } from '../types';
import { M_AIR, MU_AIR } from '../types';

/** Gas table (§2.7): M in g/mol, μ at 20 °C in µPa·s. */
export const GASES: Record<GasId, GasSpec> = {
  N2: { id: 'N2', name: 'Nitrogen', M: 28, mu: 17.9, color: '#4c78a8' },
  O2: { id: 'O2', name: 'Oxygen', M: 32, mu: 20.7, color: '#e45756' },
  air: { id: 'air', name: 'Air', M: M_AIR, mu: MU_AIR, color: '#72b7b2' },
  H2O: { id: 'H2O', name: 'Water', M: 18, mu: 9.7, color: '#54a24b' },
  H2: { id: 'H2', name: 'Hydrogen', M: 2, mu: 8.9, color: '#eeca3b' },
  He: { id: 'He', name: 'Helium', M: 4, mu: 19.9, color: '#b279a2' },
  Ar: { id: 'Ar', name: 'Argon', M: 40, mu: 22.6, color: '#ff9da6' },
  CO2: { id: 'CO2', name: 'Carbon dioxide', M: 44, mu: 14.9, color: '#9d755d' },
};

/** sqrt(M_air / M_g): multiply molecular-flow conductances by this. */
export function molecularSpeciesFactor(gas: GasId): number {
  return Math.sqrt(M_AIR / GASES[gas].M);
}

/** μ_air / μ_g: multiply viscous-flow conductances by this. */
export function viscousSpeciesFactor(gas: GasId): number {
  return MU_AIR / GASES[gas].mu;
}

/** Noble gases (for ion pump / NEG behavior). */
export function isNoble(gas: GasId): boolean {
  return gas === 'He' || gas === 'Ar';
}

/** Saturation vapor pressure of water at 20 °C, Torr. */
export const P_SAT_H2O_20C = 17.5;

/** Trace He in the atmosphere (5.2 ppm), Torr — the He leak-check background. */
export const P_ATM_HE = 4.0e-3;
/** Trace H2 in the atmosphere (~0.5 ppm), Torr. */
export const P_ATM_H2 = 4.0e-4;

/**
 * Atmospheric composition at a given relative humidity, expressed on an
 * arbitrary species set. Species not in the active set are folded into 'air'
 * when 'air' is active; otherwise into N2 (approximation, documented).
 */
export function atmosphereComposition(species: GasId[], humidityRH: number): number[] {
  const pH2O = P_SAT_H2O_20C * Math.max(0, Math.min(100, humidityRH)) / 100;
  const partial: Partial<Record<GasId, number>> = {};
  if (species.includes('H2O')) partial.H2O = pH2O;
  if (species.includes('He')) partial.He = P_ATM_HE;
  if (species.includes('H2')) partial.H2 = P_ATM_H2;
  let assigned = 0;
  for (const g of species) assigned += partial[g] ?? 0;
  const rest = Math.max(0, 760 - assigned);
  if (species.includes('air')) {
    partial.air = rest;
  } else {
    // full species mode: N2 78 / O2 21 / Ar 1 (+ CO2 ~0.04%)
    const hasCO2 = species.includes('CO2');
    const fN2 = 0.78, fO2 = 0.21, fAr = hasCO2 ? 0.0096 : 0.01, fCO2 = hasCO2 ? 0.0004 : 0;
    if (species.includes('N2')) partial.N2 = rest * fN2 + (species.includes('O2') ? 0 : rest * fO2) + (species.includes('Ar') ? 0 : rest * fAr);
    if (species.includes('O2')) partial.O2 = rest * fO2;
    if (species.includes('Ar')) partial.Ar = rest * fAr;
    if (hasCO2) partial.CO2 = rest * fCO2;
  }
  return species.map((g) => partial[g] ?? 0);
}
