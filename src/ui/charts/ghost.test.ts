import { describe, expect, it } from 'vitest';
import { mergeAligned } from './ghost';

describe('mergeAligned', () => {
  it('interleaves two grids into one ascending axis with null fill', () => {
    const m = mergeAligned([0, 2, 4], [[10, 12, 14]], [1, 2, 3], [[20, 22, 23]]);
    expect(m.t).toEqual([0, 1, 2, 3, 4]);
    expect(m.live).toEqual([[10, null, 12, null, 14]]);
    expect(m.ghost).toEqual([[null, 20, 22, 23, null]]);
  });

  it('shares exactly-equal timestamps instead of duplicating them', () => {
    const m = mergeAligned([0, 1], [[1, 2]], [0, 1], [[3, 4]]);
    expect(m.t).toEqual([0, 1]);
    expect(m.live).toEqual([[1, 2]]);
    expect(m.ghost).toEqual([[3, 4]]);
  });

  it('handles an empty live run (fresh Reset with a pinned ghost)', () => {
    const m = mergeAligned([], [[]], [5, 6], [[7, 8]]);
    expect(m.t).toEqual([5, 6]);
    expect(m.live).toEqual([[null, null]]);
    expect(m.ghost).toEqual([[7, 8]]);
  });

  it('keeps multiple series per side aligned and the axis strictly ascending', () => {
    const m = mergeAligned([0, 3], [[1, 2], [5, 6]], [1, 2], [[9, 8]]);
    expect(m.t).toEqual([0, 1, 2, 3]);
    expect(m.live[1]).toEqual([5, null, null, 6]);
    expect(m.ghost[0]).toEqual([null, 9, 8, null]);
    for (let k = 1; k < m.t.length; k++) expect(m.t[k]).toBeGreaterThan(m.t[k - 1]);
  });
});
