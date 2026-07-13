import type { GasId, GaugeType } from '../types';

/**
 * Gauge behavior table (§1.5). Readings are what the instrument DISPLAYS;
 * true pressure is what the node HAS. Correction/sensitivity factors are
 * representative values.
 *
 * Ionization gauge sensitivity s_g (relative to N2): reading = Σ s_g · p_g.
 * Given by spec: He 0.18, Ar 1.3, H2 0.46.
 *
 * Pirani/thermocouple factors f_g: thermal-conductivity gauges read
 * f_g · p_g in the linear regime (representative values; H2/He read high,
 * Ar reads low).
 */
export const ION_SENSITIVITY: Record<GasId, number> = {
  N2: 1.0, air: 1.0, O2: 0.9, H2O: 1.0, H2: 0.46, He: 0.18, Ar: 1.3, CO2: 1.4,
};

export const THERMAL_FACTOR: Record<GasId, number> = {
  N2: 1.0, air: 1.0, O2: 0.9, H2O: 1.5, H2: 2.0, He: 1.15, Ar: 0.6, CO2: 0.9,
};

export interface GaugeSpecEntry {
  type: GaugeType;
  name: string;
  /** usable range, Torr (display clamps/saturates outside) */
  max: number;
  min: number;
  /** first-order response time constant, s */
  tau: number;
  /** multiplicative 1σ noise on the reading */
  noiseRel: number;
  /** additive noise, Torr */
  noiseAbs: number;
  notes: string;
}

export const GAUGE_SPECS: Record<GaugeType, GaugeSpecEntry> = {
  bourdon: {
    type: 'bourdon', name: 'Bourdon / piezo', max: 900, min: 1, tau: 0.1,
    noiseRel: 0, noiseAbs: 1,
    notes: 'Gas independent. ±1 Torr noise; useless below ~1 Torr.',
  },
  capacitance: {
    type: 'capacitance', name: 'Capacitance manometer', max: 1000, min: 1e-5, tau: 0.05,
    noiseRel: 0.0025, noiseAbs: 0,
    notes: 'Gas independent, 0.25% of reading; usable to 1e-4 of full scale; zero-drift knob.',
  },
  thermocouple: {
    type: 'thermocouple', name: 'Thermocouple', max: 2, min: 1e-3, tau: 2,
    noiseRel: 0.05, noiseAbs: 5e-5,
    notes: 'Gas-dependent correction factors; sluggish (τ = 2 s).',
  },
  pirani: {
    type: 'pirani', name: 'Pirani', max: 100, min: 1e-4, tau: 0.2,
    noiseRel: 0.03, noiseAbs: 2e-6,
    notes: 'Gas correction factors; saturates flat below 1e-4 Torr; pegs at "ATM" above ~100 Torr.',
  },
  coldcathode: {
    type: 'coldcathode', name: 'Cold cathode (inv. magnetron)', max: 1e-2, min: 1e-9, tau: 0.3,
    noiseRel: 0.10, noiseAbs: 0,
    notes: 'May fail to strike below 1e-6 Torr (random delay ≤10 s); ×2 accuracy; gas sensitivity factors.',
  },
  hotcathode: {
    type: 'hotcathode', name: 'Hot cathode (Bayard-Alpert)', max: 1e-4, min: 1e-11, tau: 0.2,
    noiseRel: 0.03, noiseAbs: 0,
    notes: 'Filament trips above 1e-4 Torr; X-ray limit floor ~5e-12 Torr; gas sensitivity factors.',
  },
  fullrange: {
    type: 'fullrange', name: 'Full-range (Pirani + CC)', max: 900, min: 1e-9, tau: 0.3,
    noiseRel: 0.05, noiseAbs: 0,
    notes: 'Stitched Pirani + cold cathode with a visible handoff artifact near 1e-2 Torr.',
  },
};

/** Capacitance manometer full-scale options, Torr. */
export const CAPACITANCE_FS_OPTIONS = [1000, 100, 1, 0.1];

/** Hot-cathode X-ray limit, Torr. */
export const XRAY_LIMIT = 5e-12;
/** Full-range gauge handoff pressure, Torr. */
export const FULLRANGE_HANDOFF = 1.3e-2;
