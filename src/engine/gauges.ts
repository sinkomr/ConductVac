import type { EngineGaugeSpec, EventLogEntry, GasId, GaugeReading } from '../types';
import {
  GAUGE_SPECS, ION_SENSITIVITY, THERMAL_FACTOR, XRAY_LIMIT, FULLRANGE_HANDOFF,
} from '../data/gaugespecs';

/**
 * Gauges (§1.5): simulated instruments that lie realistically. A gauge
 * produces a READING distinct from true pressure: gas-species sensitivity,
 * range clipping, first-order response lag, noise, strike/trip behavior.
 */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class GaugeRuntime {
  readonly spec: EngineGaugeSpec;
  readonly nodeIdx: number;
  readonly species: GasId[];
  enabled: boolean;

  /** lagged ideal reading (linear Torr) */
  private filtered = NaN;
  /** cold cathode discharge state */
  private struck = false;
  private strikeAt = Infinity;
  private strikeFailedLogged = false;
  /** hot cathode filament */
  private filamentOn = false;
  /** fixed calibration error (cold cathode "×2 accuracy") */
  private readonly calib: number;
  private readonly rng: () => number;
  /** capacitance manometer zero-drift knob (Torr) */
  zeroOffset = 0;

  constructor(spec: EngineGaugeSpec, nodeIdx: number, species: GasId[]) {
    this.spec = spec;
    this.nodeIdx = nodeIdx;
    this.species = species;
    this.enabled = spec.enabled ?? true;
    this.rng = mulberry32(spec.seed ?? hashString(spec.id));
    // log-uniform in [1/1.8, 1.8] for CC; mild for others
    const r = this.rng();
    this.calib = this.spec.type === 'coldcathode' || this.spec.type === 'fullrange'
      ? Math.exp((r * 2 - 1) * Math.log(1.8))
      : 1;
    this.filamentOn = this.enabled;
  }

  get label(): string {
    return this.spec.label ?? this.spec.id;
  }

  /** gas-corrected "ideal" input for thermal-conductivity gauges */
  private thermalValue(partials: Float64Array): number {
    let v = 0;
    for (let gi = 0; gi < this.species.length; gi++) v += THERMAL_FACTOR[this.species[gi]] * partials[gi];
    return v;
  }

  /** gas-corrected input for ionization gauges */
  private ionValue(partials: Float64Array): number {
    let v = 0;
    for (let gi = 0; gi < this.species.length; gi++) v += ION_SENSITIVITY[this.species[gi]] * partials[gi];
    return v;
  }

  setEnabled(on: boolean, pTot: number, t: number): EventLogEntry[] {
    const logs: EventLogEntry[] = [];
    this.enabled = on;
    const type = this.spec.type;
    if (!on) {
      this.struck = false;
      this.strikeAt = Infinity;
      this.filamentOn = false;
      return logs;
    }
    this.strikeFailedLogged = false;
    if (type === 'coldcathode') {
      this.beginStrike(pTot, t, logs);
    }
    if (type === 'hotcathode') {
      if (pTot > GAUGE_SPECS.hotcathode.max) {
        this.filamentOn = false;
        this.enabled = false;
        logs.push({ t, severity: 'error', message: `${this.label}: filament trip on enable (p > 1e-4 Torr)` });
      } else {
        this.filamentOn = true;
      }
    }
    return logs;
  }

  private beginStrike(pTot: number, t: number, logs: EventLogEntry[]): void {
    if (pTot > 1e-6) {
      this.struck = true;
      this.strikeAt = Infinity;
    } else {
      // below 1e-6 the discharge may take up to ~10 s to strike; sometimes fails
      if (this.rng() < 0.15) {
        this.strikeAt = Infinity;
        logs.push({ t, severity: 'warning', message: `${this.label}: cold cathode failed to strike — cycle power` });
        this.strikeFailedLogged = true;
      } else {
        this.strikeAt = t + this.rng() * 10;
      }
    }
  }

  /** advance internal state one accepted solver step */
  advance(dt: number, t: number, partials: Float64Array): EventLogEntry[] {
    const logs: EventLogEntry[] = [];
    const type = this.spec.type;
    const specE = GAUGE_SPECS[type];
    let pTot = 0;
    for (let gi = 0; gi < partials.length; gi++) pTot += partials[gi];

    if (type === 'coldcathode' && this.enabled) {
      if (!this.struck && t >= this.strikeAt) this.struck = true;
      if (!this.struck && this.strikeAt === Infinity && !this.strikeFailedLogged && pTot > 1e-6) {
        // discharge self-starts once pressure is high enough
        this.struck = true;
      }
    }
    if (type === 'hotcathode' && this.enabled && this.filamentOn && pTot > specE.max) {
      this.filamentOn = false;
      this.enabled = false;
      logs.push({ t, severity: 'error', message: `${this.label}: filament tripped (p ${pTot.toExponential(1)} > 1e-4 Torr)` });
    }

    const ideal = this.idealValue(partials, pTot);
    if (Number.isFinite(ideal)) {
      if (!Number.isFinite(this.filtered)) this.filtered = ideal;
      const a = 1 - Math.exp(-dt / specE.tau);
      this.filtered += (ideal - this.filtered) * a;
    } else {
      this.filtered = NaN;
    }
    return logs;
  }

  /** noiseless instrument response before lag/noise */
  private idealValue(partials: Float64Array, pTot: number): number {
    switch (this.spec.type) {
      case 'bourdon':
        return pTot;
      case 'capacitance': {
        const fs = this.spec.fullScale ?? 1000;
        return Math.min(pTot, 1.05 * fs) + this.zeroOffset;
      }
      case 'thermocouple': {
        const v = this.thermalValue(partials);
        return Math.min(Math.max(v, 1e-3), 2.2);
      }
      case 'pirani': {
        const v = this.thermalValue(partials);
        return Math.max(v, 1e-4);
      }
      case 'coldcathode': {
        if (!this.struck) return NaN;
        return Math.max(this.ionValue(partials) * this.calib, 1e-9);
      }
      case 'hotcathode': {
        if (!this.filamentOn) return NaN;
        return this.ionValue(partials) + XRAY_LIMIT;
      }
      case 'fullrange': {
        const pir = this.thermalValue(partials);
        if (pir > FULLRANGE_HANDOFF) return pir;
        return Math.max(this.ionValue(partials) * this.calib, 1e-9);
      }
    }
  }

  reading(partials: Float64Array): GaugeReading {
    const type = this.spec.type;
    const specE = GAUGE_SPECS[type];
    let truth = 0;
    for (let gi = 0; gi < partials.length; gi++) truth += partials[gi];

    if (!this.enabled) {
      return { id: this.spec.id, value: NaN, truth, status: 'off' };
    }
    let v = this.filtered;
    let status = '';
    if (!Number.isFinite(v)) {
      if (type === 'coldcathode' && !this.struck) status = 'no strike';
      if (type === 'hotcathode' && !this.filamentOn) status = 'filament trip';
      return { id: this.spec.id, value: NaN, truth, status };
    }

    // noise
    const gaussish = (this.rng() + this.rng() + this.rng() - 1.5) / 0.68; // ~N(0,1)
    v = v * (1 + specE.noiseRel * gaussish) + specE.noiseAbs * gaussish;

    // range behavior / status decoration
    switch (type) {
      case 'bourdon':
        v = Math.max(v, 0);
        if (truth < specE.min) status = 'under-range';
        break;
      case 'capacitance': {
        const fs = this.spec.fullScale ?? 1000;
        v += 3e-5 * fs * gaussish; // resolution floor
        if (v > fs) { v = fs; status = 'over-range'; }
        if (truth < 1e-4 * fs) status = 'under-range';
        v = Math.max(v, 0);
        break;
      }
      case 'thermocouple':
        if (v >= 2) { v = 2; status = 'over-range'; }
        v = Math.max(v, 1e-3);
        break;
      case 'pirani':
        if (v >= 100) { v = 760; status = 'ATM'; }
        v = Math.max(v, 1e-4 * (1 + 0.05 * gaussish));
        break;
      case 'coldcathode':
        if (truth > specE.max) { v = specE.max; status = 'over-range'; }
        v = Math.max(v, 1e-9);
        break;
      case 'hotcathode':
        v = Math.max(v, XRAY_LIMIT);
        break;
      case 'fullrange':
        if (v >= 400) { v = 760; status = 'ATM'; }
        v = Math.max(v, 1e-9);
        break;
    }
    return { id: this.spec.id, value: v, truth, status };
  }
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
