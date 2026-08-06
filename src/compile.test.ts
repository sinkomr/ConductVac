import { describe, expect, it } from 'vitest';
import { compileSystem } from './compile';
import { PART_BY_ID, portFlange } from './data/fittings';
import { PUMP_CATALOG } from './data/pumps';
import type { PartInstance, SystemDefinition } from './types';

/**
 * Per-instance pump spec overrides: the catalog holds the defaults, the
 * placed part's params can re-spec it (the VHS-10 use case: dial a 300 L/s
 * generic diffusion pump up to 3650 L/s — or just place the real entry).
 */

const sysOf = (parts: PartInstance[]): SystemDefinition => ({
  version: 1, name: 'test', parts, connections: [], script: [], humidityRH: 50,
});

const part = (def: string, params: PartInstance['params'] = {}): PartInstance => ({
  id: 'p1', def, x: 0, y: 0, rot: 0, params,
});

const modelOf = (sys: SystemDefinition) => {
  const c = compileSystem(sys);
  const pm = (c.engine.pumps ?? []).find((p) => p.id === 'p1');
  if (!pm) throw new Error('pump p1 not compiled');
  return pm.model;
};

describe('pump spec overrides', () => {
  it('without params the catalog model passes through untouched', () => {
    const m = modelOf(sysOf([part('pump-diff-300')]));
    expect(m.kind).toBe('diffusion');
    expect(m.kind === 'diffusion' && m.sPeak).toBe(300);
  });

  it('sPeak re-specs a generic diffusion pump to VHS-10 size', () => {
    const m = modelOf(sysOf([part('pump-diff-300', { sPeak: 3650 })]));
    expect(m.kind === 'diffusion' && m.sPeak).toBe(3650);
    expect(m.kind === 'diffusion' && m.pCritBack).toBe(0.4); // rest untouched
  });

  it('displacement pumps take sPeak and pUlt overrides', () => {
    const m = modelOf(sysOf([part('pump-rv-2stage-5', { sPeak: 10, pUlt: 1e-2 })]));
    expect(m.kind === 'displacement' && m.sPeak).toBe(10);
    expect(m.kind === 'displacement' && m.pUlt).toBe(1e-2);
  });

  it('cryo size scale multiplies every per-species speed AND capacity', () => {
    const m = modelOf(sysOf([part('pump-cryo-8', { scale: 2 })]));
    if (m.kind !== 'cryo') throw new Error('expected cryo');
    expect(m.sPeak.N2).toBe(3000);
    expect(m.sPeak.H2O).toBe(8000);
    expect(m.capacity.H2).toBe(6e3);
  });

  it('NEG scale multiplies the speed map and the scalar capacity', () => {
    const m = modelOf(sysOf([part('pump-neg-100', { scale: 4 })]));
    if (m.kind !== 'neg') throw new Error('expected neg');
    expect(m.sPeak.H2).toBe(400);
    expect(m.capacity).toBeCloseTo(0.4, 10);
  });
});

describe('real-hardware catalog entries', () => {
  it('the Agilent VHS-10 part exists at its nominal 3650 L/s on ISO250', () => {
    const def = PART_BY_ID['pump-agilent-vhs10'];
    expect(def).toBeDefined();
    expect(portFlange(def, 0, { ...def.defaults })).toBe('ISO250');
    const m = modelOf(sysOf([part('pump-agilent-vhs10')]));
    expect(m.kind === 'diffusion' && m.sPeak).toBe(3650);
  });

  it('branded gauges compile to their instrument class', () => {
    const defs = [
      ['gauge-pkr251', 'fullrange'],
      ['gauge-gp275', 'pirani'],
      ['gauge-uhv24', 'hotcathode'],
      ['gauge-baratron626', 'capacitance'],
    ] as const;
    for (const [id, type] of defs) {
      expect(PART_BY_ID[id]).toBeDefined();
      const c = compileSystem(sysOf([{ id: 'g1', def: id, x: 0, y: 0, rot: 0, params: {} }]));
      expect(c.engine.gauges?.[0]?.type).toBe(type);
    }
  });

  it('the branded sweep is broad, unique, and fully placeable', () => {
    const branded = PUMP_CATALOG.filter((e) => e.brand);
    expect(branded.length).toBeGreaterThanOrEqual(75);
    const ids = PUMP_CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length); // no id collisions
    for (const e of PUMP_CATALOG) expect(PART_BY_ID[`pump-${e.id}`]).toBeDefined();
    // at least six manufacturers represented
    expect(new Set(branded.map((e) => e.brand)).size).toBeGreaterThanOrEqual(6);
  });

  it('branded gauges are broad too', () => {
    const brandedGauges = Object.values(PART_BY_ID).filter(
      (d) => d.kind === 'gauge' && d.sub && d.sub !== 'Generic',
    );
    expect(brandedGauges.length).toBeGreaterThanOrEqual(15);
  });
});

describe('editable pump flanges', () => {
  it('inlet and backing flanges default to the catalog and follow the params', () => {
    const def = PART_BY_ID['pump-pfeiffer-hipace80'];
    expect(def.ports[0].dynamic).toBe(true);
    expect(portFlange(def, 0, { ...def.defaults })).toBe('CF63');
    expect(portFlange(def, 0, { ...def.defaults, inletFlange: 'ISO100' })).toBe('ISO100');
    expect(portFlange(def, 1, { ...def.defaults })).toBe('KF16');
    expect(portFlange(def, 1, { ...def.defaults, backingFlange: 'KF25' })).toBe('KF25');
  });

  it('unbacked pumps expose only the inlet flange', () => {
    const def = PART_BY_ID['pump-cti-cryotorr8'];
    expect(def.ports).toHaveLength(1);
    expect(portFlange(def, 0, { ...def.defaults })).toBe('CF200');
    expect(def.params.some((p) => p.key === 'backingFlange')).toBe(false);
  });
});
