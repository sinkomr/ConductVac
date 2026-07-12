/**
 * Shared types for ConductVac.
 *
 * Internal unit system (used EVERYWHERE except the display layer):
 *   pressure          Torr
 *   volume            liters
 *   conductance/speed L/s
 *   throughput Q      Torr·L/s
 *   time              seconds
 *   length (geometry) cm      (conductance formulas take d, L in cm)
 *   area              cm²
 */

// ---------------------------------------------------------------- gases ----

export type GasId = 'air' | 'N2' | 'O2' | 'H2O' | 'H2' | 'He' | 'Ar' | 'CO2';

export interface GasSpec {
  id: GasId;
  name: string;
  /** molar mass, g/mol */
  M: number;
  /** dynamic viscosity at 20 °C, µPa·s */
  mu: number;
  /** display color for species panels/charts */
  color: string;
}

/** Reduced species set run by default in v1 (data model is species-general). */
export const DEFAULT_SPECIES: GasId[] = ['air', 'H2O', 'H2', 'He'];

export const M_AIR = 28.97;
export const MU_AIR = 18.2; // µPa·s at 20 °C

// ------------------------------------------------------------- materials ----

export type MaterialId =
  | 'ss304'
  | 'ss-ep'
  | 'al6061'
  | 'mild-steel'
  | 'copper-ofhc'
  | 'borosilicate'
  | 'alumina'
  | 'viton'
  | 'buna-n'
  | 'ptfe'
  | 'peek'
  | 'kapton'
  | 'test-constant'; // n = 0 test material (constant outgassing), used by validation tests

export interface MaterialSpec {
  id: MaterialId;
  name: string;
  /** q1: outgassing rate at t1 = 1 h after exposure, Torr·L/s/cm², unbaked */
  q1Unbaked: number;
  /** decay exponent n in (t1/(t+t0))^n */
  n: number;
  /** species fractions of the unbaked outgassing flux (sums to 1) */
  speciesUnbaked: Partial<Record<GasId, number>>;
  /** q1 after a full 150 °C × 24 h bake, Torr·L/s/cm² (null = not bakeable / n.a.) */
  q1Baked: number | null;
  /** species fractions after bake */
  speciesBaked: Partial<Record<GasId, number>> | null;
  /** He permeation constant, Torr·L/s per cm² wetted seal area (elastomers only) */
  permeationHe?: number;
  /** H2O permeation constant, Torr·L/s per cm² wetted seal area (elastomers only) */
  permeationH2O?: number;
  bakeable: boolean;
}

// --------------------------------------------------------------- flanges ----

export type FlangeStandard = 'KF' | 'CF' | 'ISO' | 'SWG';

export interface FlangeSize {
  /** e.g. "KF25", "CF40", "ISO100", "SWG-1/4" */
  id: string;
  standard: FlangeStandard;
  name: string;
  /** nominal bore, mm */
  boreMm: number;
  /** seal material (null for metal-sealed CF) */
  sealMaterial: MaterialId | null;
  /** wetted elastomer seal area per joint, cm² (0 for CF) */
  sealAreaCm2: number;
}

// ------------------------------------------------------- engine networks ----

/**
 * The engine-level system description. The UI "compiles" a part-based
 * SystemDefinition down to this; tests construct it directly.
 */

export interface SurfaceSpec {
  /** internal wetted area, cm² */
  area: number;
  material: MaterialId;
  /** already baked when the sim starts */
  baked?: boolean;
}

export interface EngineNodeSpec {
  id: string;
  /** liters (ignored for boundary nodes) */
  volume: number;
  /**
   * Boundary node: pressure is held fixed at these partials (Torr).
   * The implicit atmosphere node `_atm` is added automatically.
   */
  fixed?: Partial<Record<GasId, number>>;
  surfaces?: SurfaceSpec[];
  /** initial partial pressures; defaults to atmosphere composition */
  initial?: Partial<Record<GasId, number>>;
  /** display label */
  label?: string;
}

export type ConductanceSpec =
  /** circular tube; d, L in cm; bends90 adds 1.33·d equivalent length each */
  | { kind: 'tube'; d: number; L: number; bends90?: number; lengthFactor?: number }
  /** thin aperture of given area (cm²) */
  | { kind: 'aperture'; area: number }
  /** aperture in series with a body tube (butterfly/throttle valves) */
  | { kind: 'tubeAperture'; d: number; L: number; apertureArea: number }
  /**
   * fixed conductance in L/s for air; per-species scaling:
   * 'molecular' multiplies by sqrt(M_air/M_g), 'none' uses the value for all species
   */
  | { kind: 'fixed'; value: number; speciesScaling?: 'molecular' | 'none' };

export interface EngineEdgeSpec {
  id: string;
  a: string;
  b: string;
  conductance: ConductanceSpec;
  /** mesh-screen transmission etc.; multiplies C */
  meshFactor?: number;
  /** valve opening fraction 0..1 (0 removes the edge from the Jacobian); default 1 */
  open?: number;
  label?: string;
}

export type PumpModelSpec =
  | {
      kind: 'displacement';
      sPeak: number; // L/s
      pUlt: number; // Torr
      /** gas ballast available; when on: pUlt ×2 all species, ×10 for H2O */
      hasBallast?: boolean;
      /** warn if inlet below this with oil-sealed pump (backstreaming) */
      oilBackstreamBelow?: number;
    }
  | {
      kind: 'roots';
      sPeak: number;
      k0: number; // staging/compression ratio
      maxDeltaP: number; // Torr
      /** conductance through the free-wheeling stages when off, L/s (air, molecular) */
      cOff: number;
    }
  | {
      kind: 'turbo' | 'diffusion';
      sPeak: number; // L/s for N2
      /** zero-flow compression ratio per species; missing species interpolated in sqrt(M) */
      k0: Partial<Record<GasId, number>>;
      pCritBack: number; // Torr
      tauSpin: number; // s (diffusion: warm-up time constant)
      /** inlet total pressure where throughput rolloff begins / ends (Torr) */
      rolloffStart?: number; // default 1e-2
      rolloffEnd?: number; // default 1
      /** conductance through the stopped rotor / cold stack, L/s (air, molecular) */
      cOff: number;
      /** diffusion pumps: log backstreaming warning if inlet > this while hot */
      backstreamAbove?: number;
    }
  | {
      kind: 'ion';
      sPeak: number; // L/s at 1e-6 Torr
      /** noble gas (He, Ar) speed fraction */
      nobleFraction: number;
      /** refuses to start above this total pressure */
      maxStart: number; // Torr
    }
  | {
      kind: 'cryo';
      /** per-species speed, L/s; species missing here get the N2 value scaled sqrt(28/M) */
      sPeak: Partial<Record<GasId, number>>;
      /** per-species capacity, Torr·L (Infinity if absent) */
      capacity: Partial<Record<GasId, number>>;
      crossoverWarn: number; // Torr
    }
  | {
      kind: 'neg';
      /** per-species speed, L/s; species not listed are NOT pumped */
      sPeak: Partial<Record<GasId, number>>;
      capacity: number; // total sorbed, Torr·L
    }
  | {
      kind: 'sorption';
      sPeak: number;
      pUlt: number;
      capacity: number; // Torr·L
    };

export interface EnginePumpSpec {
  id: string;
  node: string;
  /** required for turbo/diffusion/roots */
  backingNode?: string;
  model: PumpModelSpec;
  on?: boolean;
  ballast?: boolean;
  label?: string;
}

export interface EngineLeakSpec {
  id: string;
  node: string;
  /** throughput at standard conditions (760 Torr across), Torr·L/s, air */
  qStd: number;
  /** virtual leak: created as trapped volume + tiny conductance instead (see network.ts) */
  label?: string;
}

export type GaugeType =
  | 'bourdon'
  | 'capacitance'
  | 'thermocouple'
  | 'pirani'
  | 'coldcathode'
  | 'hotcathode'
  | 'fullrange';

export interface EngineGaugeSpec {
  id: string;
  node: string;
  type: GaugeType;
  /** capacitance manometer full scale, Torr */
  fullScale?: number;
  enabled?: boolean;
  /** RNG seed for repeatable noise */
  seed?: number;
  label?: string;
}

export interface EngineSystemSpec {
  nodes: EngineNodeSpec[];
  edges: EngineEdgeSpec[];
  pumps?: EnginePumpSpec[];
  leaks?: EngineLeakSpec[];
  gauges?: EngineGaugeSpec[];
  /** active species; default DEFAULT_SPECIES */
  species?: GasId[];
  /** relative humidity % for atmosphere + adsorbed-water scaling; default 50 */
  humidityRH?: number;
  /** start with every non-boundary node at atmosphere (default true) */
  startAtAtmosphere?: boolean;
}

// ---------------------------------------------------------------- events ----

export type SimEventAction =
  | { type: 'valve'; edgeId: string; open: number; actuateTime?: number }
  | { type: 'pump'; pumpId: string; on: boolean }
  | { type: 'ballast'; pumpId: string; on: boolean }
  | { type: 'regenerate'; pumpId: string }
  | { type: 'gauge'; gaugeId: string; enabled: boolean }
  | { type: 'bakeStart'; nodeIds: string[] | 'all'; temperatureC: number }
  | { type: 'bakeEnd'; nodeIds: string[] | 'all' }
  | { type: 'heSpray'; leakId: string; dwell: number }
  | { type: 'setLeak'; leakId: string; qStd: number };

export interface SimEvent {
  t: number; // sim time, s
  action: SimEventAction;
}

export interface EventLogEntry {
  t: number;
  severity: 'info' | 'warning' | 'error';
  message: string;
}

// ------------------------------------------------------------- snapshots ----

export interface GaugeReading {
  id: string;
  /** displayed reading, Torr (NaN = off / no output) */
  value: number;
  /** true total pressure at the gauge node */
  truth: number;
  status: string; // '', 'ATM', 'no strike', 'filament trip', 'off', 'over-range'
}

export interface NodeSnapshot {
  id: string;
  pTotal: number;
  partials: number[]; // indexed like species[]
}

export interface SimSnapshot {
  t: number;
  dt: number;
  species: GasId[];
  nodes: NodeSnapshot[];
  gauges: GaugeReading[];
  pumps: { id: string; on: boolean; sEffective: number; atSpeed: boolean; spinFraction: number }[];
  steadyState: boolean;
}
