import { describe, expect, it } from 'vitest';
import { CELL, type Dir, type Pt } from './geometry';
import { routeWire } from './route';

const P = (x: number, y: number): Pt => ({ x, y });
const D = (dx: number, dy: number): Dir => ({ dx, dy });

const segs = (pts: Pt[]) => {
  const out: { dx: number; dy: number; len: number }[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy);
    out.push({ dx: dx / len, dy: dy / len, len });
  }
  return out;
};
const bends = (pts: Pt[]) => Math.max(0, pts.length - 2);

describe('routeWire', () => {
  it('facing inline ports → one straight segment, no curve commands', () => {
    const r = routeWire(P(0, 0), D(1, 0), P(100, 0), D(-1, 0));
    expect(r.points).toEqual([P(0, 0), P(100, 0)]);
    expect(r.d).not.toContain('Q');
    expect(r.mid).toEqual(P(50, 0));
  });

  it('Z offset: exits along dirA, enters along −dirB, ≤ 2 bends', () => {
    const r = routeWire(P(0, 0), D(1, 0), P(100, 40), D(-1, 0));
    const s = segs(r.points);
    expect(s[0]).toMatchObject({ dx: 1, dy: 0 });
    expect(s[s.length - 1]).toMatchObject({ dx: 1, dy: 0 }); // −dirB
    expect(bends(r.points)).toBeLessThanOrEqual(2);
    expect(r.points[0]).toEqual(P(0, 0));
    expect(r.points[r.points.length - 1]).toEqual(P(100, 40));
  });

  it('perpendicular ports → a single-L route with a rounded corner', () => {
    const r = routeWire(P(0, 0), D(1, 0), P(60, 60), D(0, -1));
    expect(bends(r.points)).toBe(1);
    expect(r.points).toEqual([P(0, 0), P(60, 0), P(60, 60)]);
    expect(r.d).toContain('Q');
  });

  it('facing-away aligned (rot-180 gauge): degrades to the plain straight, no nub', () => {
    const r = routeWire(P(0, 0), D(0, -1), P(0, 52), D(0, -1));
    expect(r.points).toEqual([P(0, 0), P(0, 52)]);
    expect(r.mid).toEqual(P(0, 26));
    // no excursion above the start
    for (const p of r.points) expect(p.y).toBeGreaterThanOrEqual(0);
  });

  it('coincident ports → degenerate path, finite midpoint', () => {
    const r = routeWire(P(5, 5), D(1, 0), P(5, 5), D(-1, 0));
    expect(r.mid).toEqual(P(5, 5));
    expect(r.d).toBe('M5 5');
  });

  it('butted parts (≤ 0.75 cell apart) → plain straight', () => {
    const r = routeWire(P(0, 0), D(1, 0), P(0.6 * CELL, 0), D(-1, 0));
    expect(r.points.length).toBe(2);
  });

  it('fuzz: always starts at A, ends at B, finite coordinates', () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const dirs: Dir[] = [D(1, 0), D(-1, 0), D(0, 1), D(0, -1)];
    for (let i = 0; i < 200; i++) {
      const A = P(Math.round(rnd() * 400), Math.round(rnd() * 400));
      const B = P(Math.round(rnd() * 400), Math.round(rnd() * 400));
      const dA = dirs[Math.floor(rnd() * 4)];
      const dB = dirs[Math.floor(rnd() * 4)];
      const r = routeWire(A, dA, B, dB);
      expect(r.points[0]).toEqual(A);
      if (Math.hypot(B.x - A.x, B.y - A.y) > 1e-6) {
        expect(r.points[r.points.length - 1]).toEqual(B);
      }
      for (const p of r.points) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
      expect(Number.isFinite(r.mid.x)).toBe(true);
      expect(r.d.startsWith('M')).toBe(true);
    }
  });
});
