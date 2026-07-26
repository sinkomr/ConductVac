import { describe, expect, it } from 'vitest';
import { PART_BY_ID } from '../../data/fittings';
import type { SystemDefinition } from '../../types';
import { CELL } from './geometry';
import { partsInRect } from './selectbox';
import { hitTestWires, hitTooCloseToEnds, splicePlacement } from './splice';

/** two nipples joined left-to-right with a long straight horizontal wire */
const horizontal: SystemDefinition = {
  version: 1, name: 't', humidityRH: 50, script: [],
  parts: [
    { id: 'a', def: 'nipple-KF25', x: 0, y: 0, rot: 0, params: {} },
    { id: 'b', def: 'nipple-KF25', x: 12, y: 0, rot: 0, params: {} },
  ],
  connections: [{ id: 'c1', a: { part: 'a', port: 1 }, b: { part: 'b', port: 0 } }],
};

/** vertical run: both nipples rotated 90 */
const vertical: SystemDefinition = {
  version: 1, name: 't', humidityRH: 50, script: [],
  parts: [
    { id: 'a', def: 'nipple-KF25', x: 0, y: 0, rot: 90, params: {} },
    { id: 'b', def: 'nipple-KF25', x: 0, y: 10, rot: 90, params: {} },
  ],
  connections: [{ id: 'c1', a: { part: 'a', port: 1 }, b: { part: 'b', port: 0 } }],
};

describe('splice hit testing', () => {
  it('hits the middle of a straight horizontal wire', () => {
    // wire runs y = 0.5·CELL from x = 3·CELL to 12·CELL
    const hit = hitTestWires(horizontal, { x: 7.5 * CELL, y: 0.5 * CELL + 4 }, 10)!;
    expect(hit).not.toBeNull();
    expect(hit.connId).toBe('c1');
    expect(Math.abs(hit.point.y - 0.5 * CELL)).toBeLessThan(1e-6);
    expect(Math.abs(hit.dir.dx)).toBe(1);
  });

  it('misses when out of tolerance', () => {
    expect(hitTestWires(horizontal, { x: 7.5 * CELL, y: 0.5 * CELL + 30 }, 10)).toBeNull();
  });

  it('placement aligns rotation to the wire axis and centers on the hit', () => {
    const valve = PART_BY_ID['ball-KF25'];
    const hitH = hitTestWires(horizontal, { x: 7.5 * CELL, y: 0.5 * CELL }, 10)!;
    const ph = splicePlacement(valve, hitH);
    expect(ph.rot).toBe(0);
    expect(ph.y + valve.h / 2).toBeCloseTo(0.5, 5); // valve axis on the wire
    const hitV = hitTestWires(vertical, { x: 1.5 * CELL, y: 5.5 * CELL }, 10)!;
    expect(Math.abs(hitV.dir.dy)).toBe(1);
    const pv = splicePlacement(valve, hitV);
    expect(pv.rot).toBe(90);
    expect(pv.x + valve.w / 2).toBeCloseTo(1.5, 5); // rotated axis on the wire
  });

  it('rejects hits hugging a wire end', () => {
    const valve = PART_BY_ID['ball-KF25'];
    const nearEnd = hitTestWires(horizontal, { x: 3.2 * CELL, y: 0.5 * CELL }, 10)!;
    expect(nearEnd).not.toBeNull();
    expect(hitTooCloseToEnds(horizontal, nearEnd, valve)).toBe(true);
    const middle = hitTestWires(horizontal, { x: 7.5 * CELL, y: 0.5 * CELL }, 10)!;
    expect(hitTooCloseToEnds(horizontal, middle, valve)).toBe(false);
  });
});

describe('marquee selection', () => {
  it('selects parts whose rotation-aware bbox overlaps the rect', () => {
    const rect = { x: -10, y: -10, w: 2 * CELL, h: 2 * CELL };
    expect(partsInRect(horizontal.parts, rect)).toEqual(['a']);
    const all = { x: -10, y: -10, w: 20 * CELL, h: 4 * CELL };
    expect(partsInRect(horizontal.parts, all)).toEqual(['a', 'b']);
    // vertical nipple at rot 90 occupies x∈[1,2] cells: a thin rect at x=1.2 must catch it
    const thin = { x: 1.2 * CELL, y: 0, w: 2, h: CELL };
    expect(partsInRect(vertical.parts, thin)).toContain('a');
  });
});
