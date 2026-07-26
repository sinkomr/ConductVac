import type { GasId } from '../types';
import { ION_SENSITIVITY } from './gaugespecs';

/**
 * Electron-impact cracking patterns for the virtual RGA: each species'
 * ion current lands on a set of m/z peaks (parent + fragments), so e.g.
 * water shows the classic 18/17/16 ladder and CO2 contributes to 28.
 * Fractions sum to 1 per species. The lumped 'air' pseudo-species is
 * pre-cracked from 0.78 N2 / 0.21 O2 / 0.01 Ar.
 */
export const CRACKING: Record<GasId, [mz: number, frac: number][]> = {
  H2: [[2, 0.95], [1, 0.05]],
  He: [[4, 1]],
  H2O: [[18, 0.74], [17, 0.20], [16, 0.03], [1, 0.03]],
  N2: [[28, 0.93], [14, 0.07]],
  O2: [[32, 0.90], [16, 0.10]],
  Ar: [[40, 0.85], [20, 0.15]],
  CO2: [[44, 0.78], [28, 0.08], [16, 0.09], [12, 0.05]],
  air: [[28, 0.725], [14, 0.055], [32, 0.189], [16, 0.021], [40, 0.0085], [20, 0.0015]],
};

export const RGA_MAX_MZ = 50;

/**
 * Partial pressures → m/z spectrum (index = m/z, 0..RGA_MAX_MZ), weighted by
 * each species' ionization sensitivity — it is an ionizing instrument, so H2
 * under-reads and Ar/CO2 over-read exactly like on an ion gauge.
 */
export function buildSpectrum(species: GasId[], partials: ArrayLike<number>): Float64Array {
  const amp = new Float64Array(RGA_MAX_MZ + 1);
  for (let gi = 0; gi < species.length; gi++) {
    const g = species[gi];
    const sens = ION_SENSITIVITY[g] ?? 1;
    for (const [mz, frac] of CRACKING[g] ?? []) {
      if (mz <= RGA_MAX_MZ) amp[mz] += partials[gi] * sens * frac;
    }
  }
  return amp;
}
