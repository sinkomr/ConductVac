/**
 * Perceptually-uniform viridis colormap over log10(pressure), 12 decades:
 * 1e-9 → 760 Torr (§3.3). 17-stop lookup with linear interpolation.
 */

const VIRIDIS: [number, number, number][] = [
  [68, 1, 84], [71, 24, 106], [72, 40, 120], [69, 55, 129], [64, 70, 136],
  [57, 85, 140], [50, 98, 142], [44, 112, 142], [39, 124, 142], [34, 138, 141],
  [31, 150, 139], [32, 163, 134], [41, 175, 127], [61, 188, 114], [90, 200, 100],
  [123, 209, 81], [160, 218, 57], [200, 224, 32], [237, 229, 27], [253, 231, 37],
];

export const LOG_P_MIN = -9;
export const LOG_P_MAX = Math.log10(760);

export function pressureColor(pTorr: number): string {
  if (!Number.isFinite(pTorr) || pTorr <= 0) return 'rgb(40,40,48)';
  const x = (Math.log10(pTorr) - LOG_P_MIN) / (LOG_P_MAX - LOG_P_MIN);
  const t = Math.max(0, Math.min(1, x)) * (VIRIDIS.length - 1);
  const i = Math.min(Math.floor(t), VIRIDIS.length - 2);
  const f = t - i;
  const a = VIRIDIS[i];
  const b = VIRIDIS[i + 1];
  const r = Math.round(a[0] + (b[0] - a[0]) * f);
  const g = Math.round(a[1] + (b[1] - a[1]) * f);
  const bl = Math.round(a[2] + (b[2] - a[2]) * f);
  return `rgb(${r},${g},${bl})`;
}

/** CSS gradient stops for the colorbar */
export function colorbarGradient(): string {
  const stops = VIRIDIS.map((c, i) => `rgb(${c[0]},${c[1]},${c[2]}) ${(i / (VIRIDIS.length - 1)) * 100}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

export const COLORBAR_TICKS = [-9, -7, -5, -3, -1, 1, LOG_P_MAX];
