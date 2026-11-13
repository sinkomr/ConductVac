import { describe, expect, it } from 'vitest';
import { routeSystem, routeWires, type Box, type WireRequest } from './autoroute';
import { routeWire } from './route';
import { tidyConnections } from './tidy';
import { CELL, partBBox, type Pt } from './geometry';
import { EXAMPLES } from '../../examples';
import { PART_BY_ID } from '../../data/fittings';

const RIGHT = { dx: 1, dy: 0 };
const LEFT = { dx: -1, dy: 0 };
const UP = { dx: 0, dy: -1 };

/** length of an axis-aligned polyline segment lying strictly inside a box (shrunk 1 px) */
function insideLength(a: Pt, b: Pt, box: Box): number {
  const x0 = box.x + 1, x1 = box.x + box.w - 1, y0 = box.y + 1, y1 = box.y + box.h - 1;
  if (Math.abs(a.y - b.y) < 0.5) {
    if (a.y <= y0 || a.y >= y1) return 0;
    return Math.max(0, Math.min(Math.max(a.x, b.x), x1) - Math.max(Math.min(a.x, b.x), x0));
  }
  if (Math.abs(a.x - b.x) < 0.5) {
    if (a.x <= x0 || a.x >= x1) return 0;
    return Math.max(0, Math.min(Math.max(a.y, b.y), y1) - Math.max(Math.min(a.y, b.y), y0));
  }
  return 0;
}
const bodyLength = (points: Pt[], boxes: Box[]): number => {
  let sum = 0;
  for (let i = 0; i < points.length - 1; i++) for (const b of boxes) sum += insideLength(points[i], points[i + 1], b);
  return sum;
};
/** total length two polylines run on top of each other (collinear, same line) */
function sharedLength(p: Pt[], q: Pt[]): number {
  let sum = 0;
  for (let i = 0; i < p.length - 1; i++) {
    for (let j = 0; j < q.length - 1; j++) {
      const [a, b, c, d] = [p[i], p[i + 1], q[j], q[j + 1]];
      if (Math.abs(a.y - b.y) < 0.5 && Math.abs(c.y - d.y) < 0.5 && Math.abs(a.y - c.y) < 0.5) {
        sum += Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)));
      } else if (Math.abs(a.x - b.x) < 0.5 && Math.abs(c.x - d.x) < 0.5 && Math.abs(a.x - c.x) < 0.5) {
        sum += Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)));
      }
    }
  }
  return sum;
}
const orthogonal = (points: Pt[]) =>
  points.every((p, i) => i === 0 || Math.abs(p.x - points[i - 1].x) < 0.5 || Math.abs(p.y - points[i - 1].y) < 0.5);

describe('routeWires', () => {
  const A: Pt = { x: 0, y: 0 };
  const B: Pt = { x: 10 * CELL, y: 0 };
  const wire: WireRequest = { id: 'w', A, dirA: RIGHT, B, dirB: LEFT };

  it('keeps the simple shape when nothing is in the way', () => {
    const r = routeWires([wire], []).get('w')!;
    expect(r.points).toEqual(routeWire(A, RIGHT, B, LEFT).points);
    expect(r.points).toEqual([A, B]);
  });

  it('goes around a part sitting on the direct line, with clearance', () => {
    const blocker: Box = { x: 4 * CELL, y: -CELL, w: 2 * CELL, h: 2 * CELL };
    const r = routeWires([wire], [blocker]).get('w')!;
    expect(orthogonal(r.points)).toBe(true);
    expect(bodyLength(r.points, [blocker])).toBe(0);
    // it clears the part by the margin, not by a hair
    const grown = { x: blocker.x - 0.3 * CELL, y: blocker.y - 0.3 * CELL, w: blocker.w + 0.6 * CELL, h: blocker.h + 0.6 * CELL };
    expect(bodyLength(r.points, [grown])).toBe(0);
    // and still starts and ends along the port normals
    expect(r.points[1].y).toBe(0);
    expect(r.points[r.points.length - 2].y).toBe(0);
  });

  it('does not lay a second wire on top of the first', () => {
    // two wires that both want the same horizontal track between two columns of ports
    const w1: WireRequest = { id: 'w1', A: { x: 0, y: 0 }, dirA: RIGHT, B: { x: 8 * CELL, y: 4 * CELL }, dirB: LEFT };
    const w2: WireRequest = { id: 'w2', A: { x: 0, y: 4 * CELL }, dirA: RIGHT, B: { x: 8 * CELL, y: 0 }, dirB: LEFT };
    const routes = routeWires([w1, w2], []);
    const r1 = routes.get('w1')!, r2 = routes.get('w2')!;
    // alone, both take the same middle column
    expect(sharedLength(routeWire(w1.A, RIGHT, w1.B, LEFT).points, routeWire(w2.A, RIGHT, w2.B, LEFT).points)).toBeGreaterThan(CELL);
    expect(sharedLength(r1.points, r2.points)).toBe(0);
  });

  it('falls back to the short wire when the only clean route is a lap of the diagram', () => {
    // B's port is walled in: a long barrier with the port behind it
    const wall: Box = { x: 3 * CELL, y: -40 * CELL, w: CELL, h: 80 * CELL };
    const r = routeWires([wire], [wall]).get('w')!;
    expect(r.points).toEqual(routeWire(A, RIGHT, B, LEFT).points);
  });

  it('routes into a port from the side it faces', () => {
    // target port faces up; the source is below and to the left of it
    const w: WireRequest = { id: 'w', A: { x: 0, y: 5 * CELL }, dirA: RIGHT, B: { x: 6 * CELL, y: 0 }, dirB: UP };
    const body: Box = { x: 5 * CELL, y: 0, w: 2 * CELL, h: 2 * CELL };
    const r = routeWires([w], [body]).get('w')!;
    const last = r.points[r.points.length - 2];
    expect(last.x).toBeCloseTo(6 * CELL, 6);
    expect(last.y).toBeLessThan(0); // arrives from above
    expect(bodyLength(r.points, [body])).toBe(0);
  });
});

describe('facing ports slightly out of line', () => {
  it('a few pixels: one straight wire instead of a kink', () => {
    const r = routeWire({ x: 0, y: 0 }, RIGHT, { x: 3 * CELL, y: 0.2 * CELL }, LEFT);
    expect(r.points).toHaveLength(2);
  });
  it('up to a cell: one smooth S-bend leaving both ports along their normals', () => {
    const r = routeWire({ x: 0, y: 0 }, RIGHT, { x: 3 * CELL, y: 0.5 * CELL }, LEFT);
    expect(r.d).toMatch(/^M0 0 C/);
    expect(r.d).toContain(`C${1.5 * CELL} 0 ${1.5 * CELL} ${0.5 * CELL} ${3 * CELL} ${0.5 * CELL}`);
  });
  it('more than a cell: the ordinary orthogonal jog', () => {
    const r = routeWire({ x: 0, y: 0 }, RIGHT, { x: 4 * CELL, y: 2 * CELL }, LEFT);
    expect(orthogonal(r.points)).toBe(true);
    expect(r.points.length).toBeGreaterThan(2);
  });
});

describe('bundled examples', () => {
  it('no wire passes through a part, and no two wires share a track', () => {
    for (const ex of EXAMPLES) {
      const sys = { ...ex.system, connections: tidyConnections(ex.system).connections };
      const routes = routeSystem(sys);
      expect(routes.size).toBe(sys.connections.length);
      const boxes = sys.parts.filter((p) => PART_BY_ID[p.def]).map((p) => partBBox(p));
      const all = [...routes.entries()];
      for (const [id, r] of all) {
        expect(bodyLength(r.points, boxes), `${ex.id} ${id} through a part`).toBe(0);
      }
      for (let i = 0; i < all.length; i++) {
        for (let j = i + 1; j < all.length; j++) {
          expect(sharedLength(all[i][1].points, all[j][1].points), `${ex.id} ${all[i][0]} on ${all[j][0]}`).toBe(0);
        }
      }
    }
  });

  it('routing a whole example stays fast enough to redo on every drag frame', () => {
    const big = EXAMPLES.reduce((a, b) => (b.system.connections.length > a.system.connections.length ? b : a));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) routeSystem({ parts: [...big.system.parts], connections: big.system.connections });
    expect((performance.now() - t0) / 20).toBeLessThan(25);
  });
});
