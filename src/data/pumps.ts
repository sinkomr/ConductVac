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

];

// ---- real hardware (nominal datasheet values; verify before design work) ----
// Compact per-family builders keep ~80 branded entries readable: the HEADLINE
// spec (speed, ultimate, flanges) is the published nominal; secondary
// parameters (per-species K0, capacities, time constants) are class-typical
// unless given explicitly. Every entry is flagged as nominal in the UI.

const rv = (id: string, brand: string, name: string, sLs: number, m3h: number, pUlt = 1e-3, flange = 'KF25', ballast = true): PumpCatalogEntry => ({
  id, brand, name, class: 'Rotary vane', inletFlange: flange,
  model: { kind: 'displacement', sPeak: sLs, pUlt, hasBallast: ballast, oilBackstreamBelow: 1e-2 },
  notes: `Two-stage oil-sealed rotary vane, nominal ${m3h} m³/h.`,
});

const scroll = (id: string, brand: string, name: string, sLs: number, m3h: number, pUlt = 5e-3, flange = 'KF25'): PumpCatalogEntry => ({
  id, brand, name, class: 'Scroll', inletFlange: flange,
  model: { kind: 'displacement', sPeak: sLs, pUlt, hasBallast: true },
  notes: `Oil-free dry scroll, nominal ${m3h} m³/h.`,
});

const diaphragm = (id: string, brand: string, name: string, sLs: number, m3h: number, pUlt: number, flange = 'KF16'): PumpCatalogEntry => ({
  id, brand, name, class: 'Diaphragm', inletFlange: flange,
  model: { kind: 'displacement', sPeak: sLs, pUlt },
  notes: `Oil-free diaphragm, nominal ${m3h} m³/h.`,
});

const roots = (id: string, brand: string, name: string, sLs: number, m3h: number, flange = 'ISO63', backing = 'KF40'): PumpCatalogEntry => ({
  id, brand, name, class: 'Roots', inletFlange: flange, backingFlange: backing,
  model: { kind: 'roots', sPeak: sLs, k0: 30, maxDeltaP: 45, cOff: Math.max(10, sLs / 3) },
  notes: `Roots blower, nominal ${m3h} m³/h. Needs a backing pump; overpressure bypass.`,
});

const turbo = (
  id: string, brand: string, name: string, sPeak: number,
  o: { inlet: string; backing?: string; pCritBack: number; tauSpin: number; k0H2?: number; k0He?: number; k0N2?: number; cOff?: number; note?: string },
): PumpCatalogEntry => ({
  id, brand, name, class: 'Turbomolecular', inletFlange: o.inlet, backingFlange: o.backing ?? 'KF16',
  model: {
    kind: 'turbo', sPeak,
    k0: { N2: o.k0N2 ?? 1e11, air: o.k0N2 ?? 1e11, He: o.k0He ?? 1e8, H2: o.k0H2 ?? 2e5 },
    pCritBack: o.pCritBack, tauSpin: o.tauSpin, cOff: o.cOff ?? Math.max(0.5, sPeak / 50),
  },
  notes: o.note ?? `Nominal ${sPeak} L/s N2; max backing ~${o.pCritBack} Torr.`,
});

const diffusion = (
  id: string, brand: string, name: string, sPeak: number,
  o: { inlet: string; backing?: string; tauSpin?: number; cOff?: number; backstreamAbove?: number; note?: string },
): PumpCatalogEntry => ({
  id, brand, name, class: 'Diffusion', inletFlange: o.inlet, backingFlange: o.backing ?? 'KF25',
  model: {
    kind: 'diffusion', sPeak, k0: { N2: 1e8, air: 1e8, He: 1e6, H2: 1e5 },
    pCritBack: 0.5, tauSpin: o.tauSpin ?? 300, cOff: o.cOff ?? Math.max(10, sPeak / 12),
    backstreamAbove: o.backstreamAbove ?? 1e-3,
  },
  notes: o.note ?? `Nominal ${sPeak} L/s air. Boiler warm-up minutes to tens of minutes; baffle against backstreaming.`,
});

const ion = (id: string, brand: string, name: string, sPeak: number, inlet: string, noble = 0.05, note?: string): PumpCatalogEntry => ({
  id, brand, name, class: 'Ion', inletFlange: inlet,
  model: { kind: 'ion', sPeak, nobleFraction: noble, maxStart: 1e-4 },
  notes: note ?? `Nominal ${sPeak} L/s N2. ${noble >= 0.2 ? 'Noble-capable element (modeled as 25% noble speed).' : 'Diode element (5% noble speed).'}`,
});

/** class-typical cryo maps derived from the nominal N2 speed */
const cryo = (id: string, brand: string, name: string, sN2: number, inlet: string, note?: string): PumpCatalogEntry => ({
  id, brand, name, class: 'Cryopump', inletFlange: inlet,
  model: {
    kind: 'cryo',
    sPeak: { N2: sN2, air: sN2, H2O: Math.round(sN2 * 2.7), H2: Math.round(sN2 * 1.7), Ar: Math.round(sN2 * 0.8), He: Math.round(sN2 * 0.2) },
    capacity: { N2: 500 * sN2, air: 500 * sN2, Ar: 500 * sN2, H2: 6 * sN2, He: 0.01 * sN2, H2O: 7000 * sN2 },
    crossoverWarn: 0.05,
  },
  notes: note ?? `Nominal ${sN2} L/s N2 / ~${Math.round(sN2 * 2.7)} L/s water; capacities scale with size.`,
});

const neg = (id: string, brand: string, name: string, sH2: number, cap: number, inlet: string, note?: string): PumpCatalogEntry => ({
  id, brand, name, class: 'NEG', inletFlange: inlet,
  model: {
    kind: 'neg',
    sPeak: { H2: sH2, H2O: Math.round(sH2 * 0.6), N2: Math.round(sH2 * 0.3), O2: Math.round(sH2 * 0.4), CO2: Math.round(sH2 * 0.3), air: Math.round(sH2 * 0.3) },
    capacity: cap,
  },
  notes: note ?? `Nominal ${sH2} L/s H2; reactivation = our regenerate action. No speed for nobles/CH4.`,
});

PUMP_CATALOG.push(
  // rotary vane
  rv('edwards-rv3', 'Edwards', 'Edwards RV3', 1.0, 3.7),
  rv('edwards-rv5', 'Edwards', 'Edwards RV5', 1.6, 5.8),
  rv('edwards-rv8', 'Edwards', 'Edwards RV8', 2.4, 8.5, 1.5e-3),
  rv('edwards-rv12', 'Edwards', 'Edwards RV12', 3.4, 12.2),
  rv('edwards-e2m28', 'Edwards', 'Edwards E2M28', 7.8, 28, 1e-3, 'KF40'),
  rv('edwards-e2m80', 'Edwards', 'Edwards E2M80', 22, 80, 1e-3, 'KF40'),
  rv('leybold-d4b', 'Leybold', 'Leybold TRIVAC D4B', 1.3, 4.8),
  rv('leybold-d8b', 'Leybold', 'Leybold TRIVAC D8B', 2.4, 8.5),
  rv('leybold-d16b', 'Leybold', 'Leybold TRIVAC D16B', 4.6, 16.5),
  rv('leybold-d25b', 'Leybold', 'Leybold TRIVAC D25B', 7.0, 25),
  rv('leybold-d65b', 'Leybold', 'Leybold TRIVAC D65B', 18, 65, 1e-3, 'KF40'),
  rv('pfeiffer-duo6', 'Pfeiffer', 'Pfeiffer Duo 6', 1.7, 6),
  rv('pfeiffer-duo11', 'Pfeiffer', 'Pfeiffer Duo 11', 3.1, 11),
  rv('welch-1400', 'Welch', 'Welch DuoSeal 1400', 0.35, 1.3, 1e-3, 'KF25', false),
  rv('welch-1402', 'Welch', 'Welch DuoSeal 1402', 2.7, 9.6, 1e-3, 'KF25', false),

  // scroll
  scroll('edwards-nxds6i', 'Edwards', 'Edwards nXDS6i', 1.7, 6.2),
  scroll('edwards-nxds10i', 'Edwards', 'Edwards nXDS10i', 2.9, 10.4),
  scroll('edwards-nxds15i', 'Edwards', 'Edwards nXDS15i', 4.2, 15),
  scroll('edwards-nxds20i', 'Edwards', 'Edwards nXDS20i', 6.4, 23, 5e-3, 'KF40'),
  scroll('agilent-idp3', 'Agilent', 'Agilent IDP-3', 1.0, 3.6, 2.5e-1, 'KF16'),
  scroll('agilent-idp7', 'Agilent', 'Agilent IDP-7', 2.0, 7.2, 1e-2),
  scroll('agilent-idp10', 'Agilent', 'Agilent IDP-10', 2.8, 10, 1e-2),
  scroll('agilent-idp15', 'Agilent', 'Agilent IDP-15', 4.2, 15, 1e-2, 'KF40'),
  scroll('pfeiffer-hiscroll6', 'Pfeiffer', 'Pfeiffer HiScroll 6', 1.6, 6, 2e-2),
  scroll('pfeiffer-hiscroll12', 'Pfeiffer', 'Pfeiffer HiScroll 12', 3.3, 12, 2e-2),
  scroll('pfeiffer-hiscroll18', 'Pfeiffer', 'Pfeiffer HiScroll 18', 5.0, 18, 2e-2, 'KF40'),
  scroll('leybold-scrollvac10', 'Leybold', 'Leybold SCROLLVAC 10 plus', 2.8, 10, 1.5e-2),
  scroll('leybold-scrollvac15', 'Leybold', 'Leybold SCROLLVAC 15 plus', 4.2, 15, 1.5e-2, 'KF40'),

  // diaphragm
  diaphragm('pfeiffer-mvp015', 'Pfeiffer', 'Pfeiffer MVP 015-4', 0.25, 0.9, 2.6),
  diaphragm('pfeiffer-mvp070', 'Pfeiffer', 'Pfeiffer MVP 070-3', 1.0, 3.8, 1.5),
  diaphragm('vacuubrand-md4', 'Vacuubrand', 'Vacuubrand MD 4 NT', 0.94, 3.4, 1.1),
  diaphragm('vacuubrand-mz2', 'Vacuubrand', 'Vacuubrand MZ 2 NT', 0.56, 2.0, 5.3),

  // roots
  roots('leybold-wau251', 'Leybold', 'Leybold RUVAC WAU 251', 70, 253),
  roots('leybold-wau501', 'Leybold', 'Leybold RUVAC WAU 501', 140, 505, 'ISO100'),
  roots('edwards-eh250', 'Edwards', 'Edwards EH250', 69, 250),
  roots('edwards-eh500', 'Edwards', 'Edwards EH500A', 140, 505, 'ISO100'),
  roots('pfeiffer-okta250', 'Pfeiffer', 'Pfeiffer Okta 250', 75, 270),

  // turbomolecular (drag hybrids carry the high backing tolerance)
  turbo('pfeiffer-hipace10', 'Pfeiffer', 'Pfeiffer HiPace 10', 10, { inlet: 'KF25', pCritBack: 15, tauSpin: 30, note: 'Tiny drag-hybrid turbo — load-locks and portable rigs; diaphragm-backable.' }),
  turbo('pfeiffer-hipace30', 'Pfeiffer', 'Pfeiffer HiPace 30', 32, { inlet: 'KF40', pCritBack: 15, tauSpin: 45 }),
  turbo('pfeiffer-hipace80', 'Pfeiffer', 'Pfeiffer HiPace 80', 67, { inlet: 'CF63', pCritBack: 15, tauSpin: 90, cOff: 1.5, note: 'Hybrid drag stage: tolerates ~mbar-range backing — pairs with a diaphragm pump. Nominal 67 L/s N2.' }),
  turbo('pfeiffer-hipace300', 'Pfeiffer', 'Pfeiffer HiPace 300', 260, { inlet: 'CF100', pCritBack: 8, tauSpin: 110, k0He: 3e7, cOff: 5, note: 'Nominal 260 L/s N2; drag stage gives generous backing tolerance.' }),
  turbo('pfeiffer-hipace400', 'Pfeiffer', 'Pfeiffer HiPace 400', 355, { inlet: 'CF100', pCritBack: 8, tauSpin: 120 }),
  turbo('pfeiffer-hipace700', 'Pfeiffer', 'Pfeiffer HiPace 700', 685, { inlet: 'CF160', backing: 'KF25', pCritBack: 8, tauSpin: 150 }),
  turbo('pfeiffer-hipace1200', 'Pfeiffer', 'Pfeiffer HiPace 1200', 1200, { inlet: 'ISO200', backing: 'KF25', pCritBack: 5, tauSpin: 180 }),
  turbo('pfeiffer-hipace2300', 'Pfeiffer', 'Pfeiffer HiPace 2300', 1900, { inlet: 'ISO250', backing: 'KF40', pCritBack: 4, tauSpin: 240 }),
  turbo('edwards-ext75dx', 'Edwards', 'Edwards EXT75DX', 61, { inlet: 'CF63', pCritBack: 3.5, tauSpin: 60, k0N2: 1e9, k0H2: 1e5 }),
  turbo('edwards-next85', 'Edwards', 'Edwards nEXT85D', 84, { inlet: 'CF63', pCritBack: 6, tauSpin: 60, k0N2: 1e10 }),
  turbo('edwards-next240', 'Edwards', 'Edwards nEXT240D', 240, { inlet: 'CF100', backing: 'KF25', pCritBack: 6, tauSpin: 90, k0N2: 1e10 }),
  turbo('edwards-next300d', 'Edwards', 'Edwards nEXT300D', 300, { inlet: 'CF100', backing: 'KF25', pCritBack: 6, tauSpin: 100, k0N2: 1e10, k0He: 1e7, k0H2: 1e5, cOff: 5, note: 'Nominal 300 L/s N2.' }),
  turbo('edwards-next400d', 'Edwards', 'Edwards nEXT400D', 400, { inlet: 'CF100', backing: 'KF25', pCritBack: 6, tauSpin: 110, k0N2: 1e10 }),
  turbo('edwards-next730d', 'Edwards', 'Edwards nEXT730D', 730, { inlet: 'CF160', backing: 'KF25', pCritBack: 5, tauSpin: 140, k0N2: 1e10 }),
  turbo('agilent-twistorr74', 'Agilent', 'Agilent TwisTorr 74 FS', 69, { inlet: 'CF63', pCritBack: 10, tauSpin: 60 }),
  turbo('agilent-twistorr304', 'Agilent', 'Agilent TwisTorr 304 FS', 250, { inlet: 'CF100', backing: 'KF25', pCritBack: 8, tauSpin: 100 }),
  turbo('agilent-v551', 'Agilent', 'Agilent Turbo-V 551', 550, { inlet: 'CF160', backing: 'KF25', pCritBack: 1.5, tauSpin: 150, k0N2: 1e9, k0He: 1e7, k0H2: 5e4, note: 'Classic full-turbo stage: nominal 550 L/s N2, conventional ~Torr backing requirement.' }),
  turbo('leybold-turbovac350i', 'Leybold', 'Leybold TURBOVAC 350i', 290, { inlet: 'CF100', backing: 'KF25', pCritBack: 10, tauSpin: 120 }),

  // diffusion
  diffusion('agilent-hs2', 'Agilent', 'Agilent HS-2', 285, { inlet: 'ISO63', tauSpin: 240, cOff: 30, note: 'Compact 2-inch diffusion pump, nominal 285 L/s.' }),
  diffusion('agilent-vhs4', 'Agilent', 'Agilent VHS-4', 1200, { inlet: 'ISO160', backing: 'KF40', tauSpin: 360 }),
  diffusion('agilent-vhs6', 'Agilent', 'Agilent VHS-6', 2400, { inlet: 'ISO200', backing: 'KF40', tauSpin: 400 }),
  diffusion('agilent-vhs10', 'Agilent', 'Agilent VHS-10', 3650, { inlet: 'ISO250', backing: 'KF50', tauSpin: 420, cOff: 300, note: 'Big 10-inch diffusion pump, nominal 3650 L/s air. Boiler warm-up tens of minutes; use a cold cap/baffle against backstreaming.' }),
  diffusion('edwards-diffstak63', 'Edwards', 'Edwards Diffstak 63/150', 135, { inlet: 'ISO63', tauSpin: 240, cOff: 15 }),
  diffusion('edwards-diffstak100', 'Edwards', 'Edwards Diffstak 100/300', 280, { inlet: 'ISO100', tauSpin: 300, cOff: 40, backstreamAbove: 3e-3, note: 'Nominal 280 L/s with the integrated cooled baffle (speed quoted through it).' }),
  diffusion('edwards-diffstak160', 'Edwards', 'Edwards Diffstak 160/700', 700, { inlet: 'ISO160', backing: 'KF40', tauSpin: 330 }),

  // ion
  ion('agilent-vacion20', 'Agilent', 'Agilent VacIon Plus 20 StarCell', 20, 'CF63', 0.25, 'StarCell element: real noble-gas capability (modeled as 25% speed).'),
  ion('agilent-vacion40', 'Agilent', 'Agilent VacIon Plus 40 (diode)', 40, 'CF100'),
  ion('agilent-vacion55', 'Agilent', 'Agilent VacIon Plus 55 StarCell', 55, 'CF100', 0.25, 'Nominal 55 L/s N2.'),
  ion('agilent-vacion75', 'Agilent', 'Agilent VacIon Plus 75 StarCell', 75, 'CF100', 0.25),
  ion('agilent-vacion150', 'Agilent', 'Agilent VacIon Plus 150 (diode)', 150, 'CF160'),
  ion('agilent-vacion300', 'Agilent', 'Agilent VacIon Plus 300 StarCell', 240, 'CF200', 0.25, 'Nominal 300-class element (~240 L/s N2).'),
  ion('gamma-45s', 'Gamma Vacuum', 'Gamma Vacuum 45S TiTan', 45, 'CF100'),
  ion('gamma-100l', 'Gamma Vacuum', 'Gamma Vacuum 100L TiTan', 100, 'CF160', 0.05, 'Diode element, nominal 100 L/s.'),
  ion('gamma-200l', 'Gamma Vacuum', 'Gamma Vacuum 200L TiTan', 200, 'CF200'),

  // cryopumps
  cryo('cti-cryotorr8', 'CTI', 'CTI Cryo-Torr 8', 1500, 'CF200', 'Nominal 1500 L/s air / 4000 L/s water. Capacities ~1000 std-L Ar, ~12 std-L H2.'),
  cryo('cti-cryotorr10', 'CTI', 'CTI Cryo-Torr 10', 3000, 'CF250'),
  cryo('sumitomo-cp8', 'Sumitomo', 'Sumitomo Marathon CP-8', 1500, 'CF200'),
  cryo('leybold-coolvac1500', 'Leybold', 'Leybold COOLVAC 1500 iCL', 1500, 'ISO200'),

  // NEG
  neg('saes-d100', 'SAES', 'SAES CapaciTorr D 100', 100, 0.1, 'CF40'),
  neg('saes-d400', 'SAES', 'SAES CapaciTorr D 400-2', 400, 0.4, 'CF40', 'Nominal ~400 L/s H2. Reactivation = our regenerate action.'),
  neg('saes-d2000', 'SAES', 'SAES CapaciTorr D 2000', 2000, 2.0, 'CF160'),
  neg('saes-nextorr100', 'SAES', 'SAES NEXTorr D 100-5', 100, 0.12, 'CF40', 'NEG side of the combo, nominal 100 L/s H2. The integrated 5 L/s ion element is not modeled — add a small ion pump part alongside for the noble gases.'),
  neg('saes-nextorr500', 'SAES', 'SAES NEXTorr D 500-5', 500, 0.5, 'CF63'),
);

export const PUMP_BY_ID: Record<string, PumpCatalogEntry> = Object.fromEntries(
  PUMP_CATALOG.map((p) => [p.id, p]),
);
