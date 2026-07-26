import { describe, expect, it } from 'vitest';
import { buildPaste, copyParts } from './clipboard';
import type { SystemDefinition } from './types';

const sys: SystemDefinition = {
  version: 1, name: 't', humidityRH: 50, script: [],
  parts: [
    { id: 'chamber1', def: 'chamber-cyl', x: 0, y: 0, rot: 0, params: { D: 300 } },
    { id: 'ball2', def: 'ball-KF25', x: 6, y: 1, rot: 90, params: { open: true } },
    { id: 'pump3', def: 'pump-scroll-10', x: 9, y: 0, rot: 0, params: { on: true } },
  ],
  connections: [
    { id: 'c1', a: { part: 'chamber1', port: 1 }, b: { part: 'ball2', port: 0 } },
    { id: 'c2', a: { part: 'ball2', port: 1 }, b: { part: 'pump3', port: 0 }, mesh: true },
  ],
};

describe('clipboard', () => {
  it('copies parts + only fully-internal connections', () => {
    const clip = copyParts(sys, ['chamber1', 'ball2'])!;
    expect(clip.parts.map((p) => p.id)).toEqual(['chamber1', 'ball2']);
    expect(clip.connections.map((c) => c.id)).toEqual(['c1']); // c2 leaves the set
  });

  it('copy of nothing → null', () => {
    expect(copyParts(sys, [])).toBeNull();
    expect(copyParts(sys, ['nope'])).toBeNull();
  });

  it('paste remints every id, offsets parts, remaps connections, keeps mesh + params + rot', () => {
    const clip = copyParts(sys, ['ball2', 'pump3'])!;
    let n = 100;
    const mint = (prefix: string) => `${prefix}${n++}`;
    const { parts, connections, ids } = buildPaste(clip, mint);
    expect(parts.map((p) => p.id)).toEqual(['ball100', 'pump101']);
    expect(ids).toEqual(['ball100', 'pump101']);
    expect(parts[0]).toMatchObject({ x: 7, y: 2, rot: 90, params: { open: true } });
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({
      id: 'c102',
      a: { part: 'ball100', port: 1 },
      b: { part: 'pump101', port: 0 },
      mesh: true,
    });
  });

  it('copy is a deep snapshot — later edits to the system do not leak in', () => {
    const clip = copyParts(sys, ['chamber1'])!;
    sys.parts[0].params.D = 999;
    expect(clip.parts[0].params.D).toBe(300);
    sys.parts[0].params.D = 300;
  });
});
