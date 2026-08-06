import { describe, expect, it } from 'vitest';
import { PUMP_CATALOG } from '../../data/pumps';
import { sAt, speedCurve } from './curves';

const modelOf = (id: string) => {
  const e = PUMP_CATALOG.find((x) => x.id === id);
  if (!e) throw new Error(`catalog entry ${id} missing`);
  return e.model;
};

describe('speedCurve (sampled from the real PumpRuntime)', () => {
  it('rotary vane: flat at sPeak, collapsing at the ultimate pressure', () => {
    const c = speedCurve(modelOf('rv-2stage-5'));
    expect(sAt(c, 100)).toBeCloseTo(1.4, 1);
    expect(sAt(c, 1)).toBeGreaterThan(1.2);
    expect(sAt(c, 1e-3)).toBeLessThan(0.3); // at pUlt the net speed vanishes
    expect(c.pUlt).toBe(1e-3);
  });

  it('turbo: full speed in the molecular regime, rolled off above ~1e-2 Torr', () => {
    const c = speedCurve(modelOf('turbo-80'));
    expect(sAt(c, 1e-6)).toBeGreaterThan(65);
    expect(sAt(c, 1e-6)).toBeLessThanOrEqual(82);
    expect(sAt(c, 2)).toBeLessThan(2); // above rolloffEnd only the 0.2% trickle remains
    expect(c.rolloff?.[0]).toBeCloseTo(1e-2, 6);
    expect(c.pCritBack).toBe(1.5);
  });

  it('ion pump: bell-shaped around 1e-6 Torr', () => {
    const entry = PUMP_CATALOG.find((e) => e.model.kind === 'ion');
    expect(entry).toBeDefined();
    const c = speedCurve(entry!.model);
    const peak = sAt(c, 1e-6);
    expect(peak).toBeGreaterThan(0);
    expect(sAt(c, 1e-9)).toBeLessThan(0.6 * peak);
    expect(sAt(c, 1e-3)).toBeLessThan(0.6 * peak);
  });

  it('capture pumps sample at fresh capacity: flat molecular speed', () => {
    const entry = PUMP_CATALOG.find((e) => e.model.kind === 'cryo' || e.model.kind === 'neg');
    expect(entry).toBeDefined();
    const c = speedCurve(entry!.model);
    const a = sAt(c, 1e-8);
    const b = sAt(c, 1e-6);
    expect(a).toBeGreaterThan(0);
    expect(Math.abs(a - b) / a).toBeLessThan(0.05);
  });

  it('Agilent VHS-10: the 3650 L/s plateau is what the engine will deliver', () => {
    const c = speedCurve(modelOf('agilent-vhs10'));
    const plateau = sAt(c, 1e-5); // air: sPeak · √(28/28.96) ≈ 0.983
    expect(plateau).toBeGreaterThan(3400);
    expect(plateau).toBeLessThanOrEqual(3650);
  });

  it('every catalog entry produces a finite, non-negative curve', () => {
    for (const e of PUMP_CATALOG) {
      const c = speedCurve(e.model, 31);
      expect(c.p).toHaveLength(31);
      for (const s of c.s) {
        expect(Number.isFinite(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
