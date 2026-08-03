import { PumpRuntime } from '../../engine/pumps';
import type { GasId, PumpModelSpec } from '../../types';

/**
 * Honest S(p) for the catalog browser: sampled from the SAME PumpRuntime the
 * solver integrates — at full speed, fresh capture surfaces, and (for backed
 * classes) a well-backed foreline. What the browser plots is exactly what
 * the engine will do, rolloff, ultimate and capacity taper included.
 */

export interface SpeedCurve {
  /** inlet total pressure samples, Torr (log-spaced 1e-10 … 760) */
  p: number[];
  /** effective speed for air at each sample, L/s */
  s: number[];
  pUlt?: number;
  pCritBack?: number;
  /** inlet-pressure span over which throughput rolls off */
  rolloff?: [number, number];
}

export function speedCurve(model: PumpModelSpec, points = 61): SpeedCurve {
  const species: GasId[] = ['air'];
  const pm = new PumpRuntime({ id: '_probe', node: '_n', model, on: true }, 0, -1, species);
  pm.spinFrac = 1;
  const backed = model.kind === 'turbo' || model.kind === 'diffusion' || model.kind === 'roots';
  const pBack = backed
    ? Math.min(1e-2, 0.1 * ('pCritBack' in model ? model.pCritBack : 1))
    : 760;
  const backPartials = backed ? Float64Array.from([Math.min(1e-2, pBack)]) : null;
  const partials = new Float64Array(1);
  const lo = -10;
  const hi = Math.log10(760);
  const out: SpeedCurve = { p: [], s: [] };
  for (let k = 0; k < points; k++) {
    const p = 10 ** (lo + (k * (hi - lo)) / (points - 1));
    partials[0] = p;
    pm.capacityUsed.fill(0);
    pm.freeze(p, pBack, partials);
    out.p.push(p);
    out.s.push(Math.max(0, pm.effectiveSpeed(partials, backPartials)));
  }
  if (model.kind === 'displacement') out.pUlt = model.pUlt;
  if (model.kind === 'turbo' || model.kind === 'diffusion') {
    out.pCritBack = model.pCritBack;
    out.rolloff = [model.rolloffStart ?? 1e-2, model.rolloffEnd ?? 1];
  }
  return out;
}

/** nearest-sample lookup, for tests and cursor readouts */
export function sAt(curve: SpeedCurve, p: number): number {
  let best = 0;
  let dBest = Infinity;
  for (let i = 0; i < curve.p.length; i++) {
    const d = Math.abs(Math.log10(curve.p[i]) - Math.log10(p));
    if (d < dBest) {
      dBest = d;
      best = i;
    }
  }
  return curve.s[best];
}
