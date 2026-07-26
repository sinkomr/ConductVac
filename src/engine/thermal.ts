import type { GasId } from '../types';

/**
 * Per-node temperature model. Every free node carries a live temperature
 * that ramps first-order toward its setpoint (heater tape up, wrapped-
 * chamber cool-down slower). The thermal term enters the gas balance
 * EXACTLY per step as Δln p = ln(T_end/T_start) (isochoric ideal gas at
 * constant amount), molecular conductance scales as √T, and outgassing
 * follows the continuous Arrhenius stand-in 10^((T−20°C)/60) — so "bake"
 * is no longer a mode, just a setpoint.
 */

export const T0K = 293.15;
export const TAU_HEAT = 600; // s, heater-tape time constant
export const TAU_COOL = 1800; // s, wrapped chamber cools slower than it heats

/** exact first-order ramp over dt */
export const rampTo = (T: number, target: number, dt: number, tau: number): number =>
  target + (T - target) * Math.exp(-dt / Math.max(tau, 1e-6));

/**
 * Cryo release gates: sorbed species leave a warming cold head once it
 * crosses roughly the temperature where their vapor pressure becomes
 * significant (K). Smoothstepped over ~30 K.
 */
export const T_RELEASE: Record<GasId, number> = {
  He: 5, H2: 25, air: 35, N2: 35, O2: 35, Ar: 45, CO2: 95, H2O: 165,
};

/** cold-head temperature proxy from the pump's cool-down fraction */
export const coldHeadTempK = (spinFrac: number): number => 15 + (T0K - 15) * (1 - spinFrac);

export const smoothstep01 = (x: number): number =>
  x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x);

/** release time constant once a species' gate is open, s */
export const TAU_RELEASE = 120;

/** integrated-dose bake: 10^((T−150°C)/60) · dt accumulated while T ≥ 80 °C */
export const BAKE_DOSE_REF_C = 150;
export const BAKE_DOSE_MIN_C = 80;
/** dose threshold ≈ 16.7 h at 150 °C — below 24 h so ramp losses don't break the canonical script */
export const BAKE_DOSE_TARGET = 6.0e4;
