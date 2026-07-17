import { describe, expect, it } from 'vitest';
import type { PartInstance } from '../../types';
import { CELL, partBBox, portDir, portPos } from './geometry';

const inst = (def: string, x: number, y: number, rot: PartInstance['rot'] = 0): PartInstance =>
  ({ id: 't', def, x, y, rot, params: {} });

describe('geometry: portPos', () => {
  it('inline part at rot 0', () => {
    const n = inst('nipple-KF25', 0, 0);
    expect(portPos(n, 0)).toEqual({ x: 0, y: 0.5 * CELL });
    expect(portPos(n, 1)).toEqual({ x: 3 * CELL, y: 0.5 * CELL });
  });

  it('non-square part rotates about its center (footprint shifts)', () => {
    // 3×1 nipple at origin, rot 90: center (1.5, 0.5); port 0 lands at (1.5, −1)
    const n = inst('nipple-KF25', 0, 0, 90);
    expect(portPos(n, 0)).toEqual({ x: 1.5 * CELL, y: -1 * CELL });
    expect(portPos(n, 1)).toEqual({ x: 1.5 * CELL, y: 2 * CELL });
  });
});

describe('geometry: portDir', () => {
  it('inline part faces left/right', () => {
    const n = inst('nipple-KF25', 0, 0);
    expect(portDir(n, 0)).toEqual({ dx: -1, dy: 0 });
    expect(portDir(n, 1)).toEqual({ dx: 1, dy: 0 });
  });

  it('rotates with the part', () => {
    const n = inst('nipple-KF25', 0, 0, 90);
    expect(portDir(n, 0)).toEqual({ dx: 0, dy: -1 }); // left end now points up
    expect(portDir(n, 1)).toEqual({ dx: 0, dy: 1 });
  });

  it('tee: run ports sideways, branch down', () => {
    const t = inst('tee-KF25', 0, 0);
    expect(portDir(t, 0)).toEqual({ dx: -1, dy: 0 });
    expect(portDir(t, 1)).toEqual({ dx: 1, dy: 0 });
    expect(portDir(t, 2)).toEqual({ dx: 0, dy: 1 });
  });

  it('90° elbow: left + up', () => {
    const e = inst('elbow90-KF25', 0, 0);
    expect(portDir(e, 0)).toEqual({ dx: -1, dy: 0 });
    expect(portDir(e, 1)).toEqual({ dx: 0, dy: -1 });
  });

  it('pump: inlet up, backing right', () => {
    const p = inst('pump-turbo-80', 0, 0);
    expect(portDir(p, 0)).toEqual({ dx: 0, dy: -1 });
    expect(portDir(p, 1)).toEqual({ dx: 1, dy: 0 });
  });

  it('cross-5 corner port: dominant axis tie-break, follows rotation', () => {
    // port 4 at (3, 0) on a 3×2 footprint: |dx|=1.5 beats |dy|=1 → +x
    expect(portDir(inst('cross5-KF25', 0, 0), 4)).toEqual({ dx: 1, dy: 0 });
    expect(portDir(inst('cross5-KF25', 0, 0, 90), 4)).toEqual({ dx: 0, dy: 1 });
  });

  it('gauge at rot 180 faces up (away from a chamber below)', () => {
    expect(portDir(inst('gauge-pirani', 0, 0), 0)).toEqual({ dx: 0, dy: 1 });
    expect(portDir(inst('gauge-pirani', 0, 0, 180), 0)).toEqual({ dx: 0, dy: -1 });
  });
});

describe('geometry: partBBox', () => {
  it('swaps extents at odd rotations, centered on the part', () => {
    const n = inst('nipple-KF25', 2, 3, 90);
    // center (3.5, 3.5) cells; extents swap to 1×3
    expect(partBBox(n)).toEqual({ x: 3 * CELL, y: 2 * CELL, w: 1 * CELL, h: 3 * CELL });
    const n0 = inst('nipple-KF25', 2, 3, 0);
    expect(partBBox(n0)).toEqual({ x: 2 * CELL, y: 3 * CELL, w: 3 * CELL, h: 1 * CELL });
  });
});
