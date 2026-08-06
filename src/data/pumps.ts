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
  /**
   * Manufacturer for real-hardware entries. Specs on branded entries are
   * NOMINAL values transcribed from public datasheets (no affiliation) —
   * always verify against current manufacturer data before real design work.
   */
  brand?: string;
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

  // ---- real hardware (nominal datasheet values; verify before design work) ----

  {
    id: 'edwards-rv8', name: 'Edwards RV8', class: 'Rotary vane', brand: 'Edwards', inletFlange: 'KF25',
    model: { kind: 'displacement', sPeak: 2.4, pUlt: 1.5e-3, hasBallast: true, oilBackstreamBelow: 1e-2 },
    notes: 'Two-stage oil-sealed RV, nominal 8.5 m³/h, ultimate ~2e-3 mbar.',
  },
  {
    id: 'leybold-d16b', name: 'Leybold TRIVAC D16B', class: 'Rotary vane', brand: 'Leybold', inletFlange: 'KF25',
    model: { kind: 'displacement', sPeak: 4.6, pUlt: 1e-3, hasBallast: true, oilBackstreamBelow: 1e-2 },
    notes: 'Two-stage oil-sealed RV, nominal 16.5 m³/h.',
  },
  {
    id: 'welch-1402', name: 'Welch DuoSeal 1402', class: 'Rotary vane', brand: 'Welch', inletFlange: 'KF25',
    model: { kind: 'displacement', sPeak: 2.7, pUlt: 1e-3, hasBallast: false, oilBackstreamBelow: 1e-2 },
    notes: 'The classic belt-drive lab workhorse, nominal 160 L/min.',
  },
  {
    id: 'edwards-nxds10i', name: 'Edwards nXDS10i', class: 'Scroll', brand: 'Edwards', inletFlange: 'KF25',
    model: { kind: 'displacement', sPeak: 2.9, pUlt: 5e-3, hasBallast: true },
    notes: 'Dry scroll, nominal 10.4 m³/h, ultimate 7e-3 mbar.',
  },
  {
    id: 'edwards-nxds20i', name: 'Edwards nXDS20i', class: 'Scroll', brand: 'Edwards', inletFlange: 'KF40',
    model: { kind: 'displacement', sPeak: 6.4, pUlt: 5e-3, hasBallast: true },
    notes: 'Dry scroll, nominal 23 m³/h.',
  },
  {
    id: 'agilent-idp7', name: 'Agilent IDP-7', class: 'Scroll', brand: 'Agilent', inletFlange: 'KF25',
    model: { kind: 'displacement', sPeak: 2.0, pUlt: 1e-2, hasBallast: false },
    notes: 'Oil-free dry scroll, nominal ~7 m³/h.',
  },
  {
    id: 'pfeiffer-mvp015', name: 'Pfeiffer MVP 015-4', class: 'Diaphragm', brand: 'Pfeiffer', inletFlange: 'KF16',
    model: { kind: 'displacement', sPeak: 0.25, pUlt: 2.6 },
    notes: 'Four-stage diaphragm, nominal 0.9 m³/h, ultimate 3.5 mbar — the classic drag-turbo backer.',
  },
  {
    id: 'leybold-wau251', name: 'Leybold RUVAC WAU 251', class: 'Roots', brand: 'Leybold', inletFlange: 'ISO63', backingFlange: 'KF40',
    model: { kind: 'roots', sPeak: 70, k0: 30, maxDeltaP: 45, cOff: 25 },
    notes: 'Roots blower, nominal 253 m³/h. Needs a backing pump; overpressure bypass.',
  },
  {
    id: 'pfeiffer-hipace80', name: 'Pfeiffer HiPace 80', class: 'Turbomolecular', brand: 'Pfeiffer', inletFlange: 'CF63', backingFlange: 'KF16',
    model: {
      kind: 'turbo', sPeak: 67, k0: { N2: 1e11, air: 1e11, He: 1e8, H2: 2e5 },
      pCritBack: 15, tauSpin: 90, cOff: 1.5,
    },
    notes: 'Hybrid drag stage: tolerates ~mbar-range backing — pairs with a diaphragm pump. Nominal 67 L/s N2.',
  },
  {
    id: 'pfeiffer-hipace300', name: 'Pfeiffer HiPace 300', class: 'Turbomolecular', brand: 'Pfeiffer', inletFlange: 'CF100', backingFlange: 'KF16',
    model: {
      kind: 'turbo', sPeak: 260, k0: { N2: 1e11, air: 1e11, He: 3e7, H2: 2e5 },
      pCritBack: 8, tauSpin: 110, cOff: 5,
    },
    notes: 'Nominal 260 L/s N2; drag stage gives generous backing tolerance.',
  },
  {
    id: 'edwards-next300d', name: 'Edwards nEXT300D', class: 'Turbomolecular', brand: 'Edwards', inletFlange: 'CF100', backingFlange: 'KF25',
    model: {
      kind: 'turbo', sPeak: 300, k0: { N2: 1e10, air: 1e10, He: 1e7, H2: 1e5 },
      pCritBack: 6, tauSpin: 100, cOff: 5,
    },
    notes: 'Nominal 300 L/s N2.',
  },
  {
    id: 'agilent-vhs10', name: 'Agilent VHS-10', class: 'Diffusion', brand: 'Agilent', inletFlange: 'ISO250', backingFlange: 'KF50',
    model: {
      kind: 'diffusion', sPeak: 3650, k0: { N2: 1e8, air: 1e8, He: 1e6, H2: 1e5 },
      pCritBack: 0.5, tauSpin: 420, cOff: 300, backstreamAbove: 1e-3,
    },
    notes: 'Big 10-inch diffusion pump, nominal 3650 L/s air. Boiler warm-up tens of minutes; use a cold cap/baffle against backstreaming.',
  },
  {
    id: 'agilent-hs2', name: 'Agilent HS-2', class: 'Diffusion', brand: 'Agilent', inletFlange: 'ISO63', backingFlange: 'KF25',
    model: {
      kind: 'diffusion', sPeak: 285, k0: { N2: 1e8, air: 1e8, He: 1e6, H2: 1e5 },
      pCritBack: 0.5, tauSpin: 240, cOff: 30, backstreamAbove: 1e-3,
    },
    notes: 'Compact 2-inch diffusion pump, nominal 285 L/s.',
  },
  {
    id: 'edwards-diffstak100', name: 'Edwards Diffstak 100/300', class: 'Diffusion', brand: 'Edwards', inletFlange: 'ISO100', backingFlange: 'KF25',
    model: {
      kind: 'diffusion', sPeak: 280, k0: { N2: 1e8, air: 1e8, He: 1e6, H2: 1e5 },
      pCritBack: 0.5, tauSpin: 300, cOff: 40, backstreamAbove: 3e-3,
    },
    notes: 'Nominal 280 L/s with the integrated cooled baffle (speed quoted through it).',
  },
  {
    id: 'cti-cryotorr8', name: 'CTI Cryo-Torr 8', class: 'Cryopump', brand: 'CTI', inletFlange: 'CF200',
    model: {
      kind: 'cryo',
      sPeak: { N2: 1500, air: 1500, H2O: 4000, H2: 2500, Ar: 1200, He: 300 },
      capacity: { N2: 7.6e5, air: 7.6e5, Ar: 7.6e5, H2: 9e3, He: 15, H2O: 1e7 },
      crossoverWarn: 0.05,
    },
    notes: 'Nominal 1500 L/s air / 4000 L/s water. Capacities ~1000 std-L Ar, ~12 std-L H2.',
  },
  {
    id: 'cti-cryotorr10', name: 'CTI Cryo-Torr 10', class: 'Cryopump', brand: 'CTI', inletFlange: 'CF250',
    model: {
      kind: 'cryo',
      sPeak: { N2: 3000, air: 3000, H2O: 9000, H2: 5000, Ar: 2400, He: 500 },
      capacity: { N2: 1.5e6, air: 1.5e6, Ar: 1.5e6, H2: 1.8e4, He: 25, H2O: 2e7 },
      crossoverWarn: 0.05,
    },
    notes: 'Nominal 3000 L/s air / 9000 L/s water.',
  },
  {
    id: 'agilent-vacion20', name: 'Agilent VacIon Plus 20 StarCell', class: 'Ion', brand: 'Agilent', inletFlange: 'CF63',
    model: { kind: 'ion', sPeak: 20, nobleFraction: 0.25, maxStart: 1e-4 },
    notes: 'StarCell element: real noble-gas capability (modeled as 25% speed).',
  },
  {
    id: 'agilent-vacion55', name: 'Agilent VacIon Plus 55 StarCell', class: 'Ion', brand: 'Agilent', inletFlange: 'CF100',
    model: { kind: 'ion', sPeak: 55, nobleFraction: 0.25, maxStart: 1e-4 },
    notes: 'Nominal 55 L/s N2.',
  },
  {
    id: 'gamma-100l', name: 'Gamma Vacuum 100L TiTan', class: 'Ion', brand: 'Gamma Vacuum', inletFlange: 'CF160',
    model: { kind: 'ion', sPeak: 100, nobleFraction: 0.05, maxStart: 1e-4 },
    notes: 'Diode element, nominal 100 L/s.',
  },
  {
    id: 'saes-d400', name: 'SAES CapaciTorr D 400-2', class: 'NEG', brand: 'SAES', inletFlange: 'CF40',
    model: {
      kind: 'neg',
      sPeak: { H2: 400, H2O: 250, N2: 120, O2: 150, CO2: 120, air: 120 },
      capacity: 0.4,
    },
    notes: 'Nominal ~400 L/s H2. Reactivation = our regenerate action.',
  },
  {
    id: 'saes-nextorr100', name: 'SAES NEXTorr D 100-5', class: 'NEG', brand: 'SAES', inletFlange: 'CF40',
    model: {
      kind: 'neg',
      sPeak: { H2: 100, H2O: 70, N2: 40, O2: 55, CO2: 40, air: 40 },
      capacity: 0.12,
    },
    notes: 'NEG side of the combo, nominal 100 L/s H2. The integrated 5 L/s ion element is not modeled — add a small ion pump part alongside for the noble gases.',
  },
];

export const PUMP_BY_ID: Record<string, PumpCatalogEntry> = Object.fromEntries(
  PUMP_CATALOG.map((p) => [p.id, p]),
);
