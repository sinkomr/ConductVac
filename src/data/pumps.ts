import type { PumpModelSpec } from '../types';

/**
 * Pump catalog (§2.5) — representative generic models; values are
 * class-typical approximations (labeled "representative" in the UI).
 *
 * cOff: molecular conductance (air) through a stopped/off pump between inlet
 * and backing line — a stopped turbo or cold diffusion stack is an open duct.
 * Positive-displacement pumps are assumed to hold vacuum when off (check
 * valve); documented in the fidelity notes.
 */
export interface PumpCatalogEntry {
  id: string;
  name: string;
  class: string;
  model: PumpModelSpec;
  /** inlet flange suggestion for the builder */
  inletFlange: string;
  backingFlange?: string;
  notes: string;
}

export const PUMP_CATALOG: PumpCatalogEntry[] = [
  {
    id: 'diaphragm-1', name: 'Diaphragm 1.1 m³/h', class: 'Diaphragm', inletFlange: 'KF16',
    model: { kind: 'displacement', sPeak: 0.3, pUlt: 1.5 },
    notes: 'Oil-free. 0.3 L/s, ultimate 1.5 Torr.',
  },
  {
    id: 'diaphragm-4', name: 'Diaphragm 4 m³/h', class: 'Diaphragm', inletFlange: 'KF16',
    model: { kind: 'displacement', sPeak: 1.1, pUlt: 0.75 },
    notes: 'Oil-free. 1.1 L/s, ultimate 0.75 Torr.',
  },
  {
    id: 'rv-2stage-5', name: 'Rotary vane 5 m³/h (2-stage)', class: 'Rotary vane', inletFlange: 'KF25',
    model: { kind: 'displacement', sPeak: 1.4, pUlt: 1e-3, hasBallast: true, oilBackstreamBelow: 1e-2 },
    notes: 'Oil-sealed. Ballast raises ultimate (×10 for H2O, ×2 others). Backstreaming warning below 1e-2 Torr without a trap.',
  },
  {
    id: 'rv-2stage-16', name: 'Rotary vane 16 m³/h (2-stage)', class: 'Rotary vane', inletFlange: 'KF25',
    model: { kind: 'displacement', sPeak: 4.4, pUlt: 1e-3, hasBallast: true, oilBackstreamBelow: 1e-2 },
    notes: 'Oil-sealed, 4.4 L/s.',
  },
  {
    id: 'scroll-10', name: 'Scroll 11.5 m³/h', class: 'Scroll', inletFlange: 'KF25',
    model: { kind: 'displacement', sPeak: 3.2, pUlt: 5e-3, hasBallast: true },
    notes: 'Oil-free, 3.2 L/s, ultimate 5e-3 Torr.',
  },
  {
    id: 'scroll-35', name: 'Scroll 35 m³/h', class: 'Scroll', inletFlange: 'KF40',
    model: { kind: 'displacement', sPeak: 9.7, pUlt: 4e-3, hasBallast: true },
    notes: 'Oil-free, 9.7 L/s.',
  },
  {
    id: 'roots-250', name: 'Roots 250 m³/h', class: 'Roots', inletFlange: 'ISO63', backingFlange: 'KF40',
    model: { kind: 'roots', sPeak: 70, k0: 30, maxDeltaP: 40, cOff: 25 },
    notes: 'Requires backing. K≈30, max ΔP 40 Torr.',
  },
  {
    id: 'turbo-80', name: 'Turbo 80 L/s', class: 'Turbomolecular', inletFlange: 'CF63', backingFlange: 'KF16',
    model: {
      kind: 'turbo', sPeak: 80, k0: { N2: 1e8, air: 1e8, He: 1e6, H2: 2e3 },
      pCritBack: 1.5, tauSpin: 45, cOff: 2,
    },
    notes: 'K0(N2)=1e8, K0(H2)=2e3. Critical backing 1.5 Torr. Spin-up τ 45 s.',
  },
  {
    id: 'turbo-300', name: 'Turbo 300 (260 L/s)', class: 'Turbomolecular', inletFlange: 'CF100', backingFlange: 'KF25',
    model: {
      kind: 'turbo', sPeak: 260, k0: { N2: 1e9, air: 1e9, He: 3e7, H2: 1e4 },
      pCritBack: 2, tauSpin: 90, cOff: 5,
    },
    notes: 'K0(N2)=1e9, K0(H2)=1e4. Critical backing 2 Torr. Spin-up τ 90 s.',
  },
  {
    id: 'turbo-700', name: 'Turbo 700 (685 L/s)', class: 'Turbomolecular', inletFlange: 'CF160', backingFlange: 'KF25',
    model: {
      kind: 'turbo', sPeak: 685, k0: { N2: 1e9, air: 1e9, H2: 5e4 },
      pCritBack: 1, tauSpin: 120, cOff: 10,
    },
    notes: 'K0(N2)=1e9, K0(H2)=5e4. Critical backing 1 Torr. Spin-up τ 120 s.',
  },
  {
    id: 'turbodrag-70', name: 'Hybrid drag turbo 65 L/s', class: 'Turbomolecular', inletFlange: 'CF63', backingFlange: 'KF16',
    model: {
      kind: 'turbo', sPeak: 65, k0: { N2: 1e9, air: 1e9, He: 1e7, H2: 1e4 },
      pCritBack: 15, tauSpin: 60, cOff: 1,
    },
    notes: 'Drag stages tolerate 15 Torr backing — pairs with a diaphragm pump.',
  },
  {
    id: 'diff-300', name: 'Diffusion 300 L/s', class: 'Diffusion', inletFlange: 'ISO100', backingFlange: 'KF25',
    model: {
      kind: 'diffusion', sPeak: 300, k0: { N2: 1e8, air: 1e8, He: 1e6, H2: 1e5 },
      pCritBack: 0.4, tauSpin: 300, cOff: 40, backstreamAbove: 1e-3,
    },
    notes: 'Warm-up ~15 min. Critical backing 0.4 Torr. Backstreaming flag if inlet > 1e-3 Torr while hot.',
  },
  {
    id: 'ion-20', name: 'Ion pump 20 L/s (diode)', class: 'Ion', inletFlange: 'CF63',
    model: { kind: 'ion', sPeak: 20, nobleFraction: 0.05, maxStart: 1e-4 },
    notes: 'Noble gas speed 5%. Refuses to start above 1e-4 Torr.',
  },
  {
    id: 'ion-55-noble', name: 'Ion pump 55 L/s (noble diode)', class: 'Ion', inletFlange: 'CF100',
    model: { kind: 'ion', sPeak: 55, nobleFraction: 0.25, maxStart: 1e-4 },
    notes: 'Noble diode: noble gas speed 25%.',
  },
  {
    id: 'ion-150', name: 'Ion pump 150 L/s (diode)', class: 'Ion', inletFlange: 'CF160',
    model: { kind: 'ion', sPeak: 150, nobleFraction: 0.05, maxStart: 1e-4 },
    notes: '',
  },
  {
    id: 'cryo-8', name: 'Cryopump 8" (1500 L/s N2)', class: 'Cryopump', inletFlange: 'CF200',
    model: {
      kind: 'cryo',
      sPeak: { N2: 1500, air: 1500, H2O: 4000, H2: 2500, He: 300 },
      capacity: { N2: 1e6, air: 1e6, H2: 3e3, He: 10, H2O: 1e7 },
      crossoverWarn: 0.05,
    },
    notes: 'Capacities: 1e6 Torr·L N2, 3e3 Torr·L H2, small He (sorption only). Crossover warning above 50 mTorr.',
  },
  {
    id: 'neg-100', name: 'NEG 100 L/s (H2)', class: 'NEG', inletFlange: 'CF40',
    model: {
      kind: 'neg',
      sPeak: { H2: 100, H2O: 80, N2: 50, O2: 50, CO2: 50, air: 50 },
      capacity: 0.1,
    },
    notes: 'Pumps H2, H2O, N2, O2, CO. Zero speed for noble gases and CH4. Capacity 0.1 Torr·L H2-equivalent.',
  },
  {
    id: 'sorption-1', name: 'Sorption pump (LN2)', class: 'Sorption', inletFlange: 'KF25',
    model: { kind: 'sorption', sPeak: 5, pUlt: 1e-3, capacity: 1e4 },
    notes: 'Roughing demos; requires LN2; capacity 1e4 Torr·L.',
  },
];

export const PUMP_BY_ID: Record<string, PumpCatalogEntry> = Object.fromEntries(
  PUMP_CATALOG.map((p) => [p.id, p]),
);
