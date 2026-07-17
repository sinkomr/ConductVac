import { CELL, type Dir, type Pt } from './geometry';

/**
 * Orthogonal wire router. A wire leaves each port along the port's outward
 * normal (a short stub) and runs in axis-aligned segments with rounded
 * corners, like a P&ID. Candidate shapes are scored — length plus penalties
 * for bends, doubling back through a stub, violating a port's exit
 * direction, and any diagonal — and the cheapest wins. There is no obstacle
 * avoidance: when every orthogonal shape is bad (e.g. a port facing directly
 * away from its partner) the route degrades to the plain straight chord,
 * which draws behind the part symbols exactly like the old <line> wires.
 */

export interface RoutedWire {
  /** SVG path (rounded corners) */
  d: string;
  /** point at half the polyline arc length — hosts the joint handle circle */
  mid: Pt;
  /** normalized polyline, pre-rounding (tests, future cost functions) */
  points: Pt[];
}

const STUB = CELL * 0.5;
const CORNER_R = 6;
const BEND = 15;
const REVERSAL = 400;
const EXIT_VIOL = 250;
const ENTRY_VIOL = 250;
const DIAGONAL = 600;

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const segDir = (a: Pt, b: Pt): Dir => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  return L < 1e-9 ? { dx: 0, dy: 0 } : { dx: dx / L, dy: dy / L };
};
const sameDir = (a: Dir, b: Dir) => near(a.dx, b.dx) && near(a.dy, b.dy);

/** drop zero-length segments, merge consecutive collinear same-direction runs */
function normalize(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (out.length && near(out[out.length - 1].x, p.x) && near(out[out.length - 1].y, p.y)) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const u = segDir(out[i - 1], out[i]);
    const v = segDir(out[i], out[i + 1]);
    if (sameDir(u, v)) out.splice(i, 1);
  }
  return out;
}

function score(pts: Pt[], dirA: Dir, dirB: Dir): number {
  let s = 0;
  let bends = 0;
  let reversals = 0;
  let diagonal = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    s += Math.hypot(b.x - a.x, b.y - a.y);
    if (!near(a.x, b.x) && !near(a.y, b.y)) diagonal = true;
    if (i > 0) {
      const u = segDir(pts[i - 1], a);
      const v = segDir(a, b);
      if (sameDir({ dx: -u.dx, dy: -u.dy }, v)) reversals++;
      else if (!sameDir(u, v)) bends++;
    }
  }
  const first = segDir(pts[0], pts[1]);
  const last = segDir(pts[pts.length - 2], pts[pts.length - 1]);
  s += BEND * bends + REVERSAL * reversals;
  if (first.dx * dirA.dx + first.dy * dirA.dy < 1 - 1e-6) s += EXIT_VIOL;
  if (last.dx * -dirB.dx + last.dy * -dirB.dy < 1 - 1e-6) s += ENTRY_VIOL;
  if (diagonal) s += DIAGONAL;
  return s;
}

/** point at half the total arc length of a polyline */
function midpoint(pts: Pt[]): Pt {
  if (pts.length === 1) return pts[0];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  let walk = total / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const L = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    if (walk <= L || i === pts.length - 2) {
      const t = L < 1e-9 ? 0 : walk / L;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t };
    }
    walk -= L;
  }
  return pts[pts.length - 1];
}

/** SVG path with quadratic-rounded interior corners */
function toPath(pts: Pt[]): string {
  if (pts.length === 1) return `M${pts[0].x} ${pts[0].y}`;
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const v = pts[i];
    const uIn = segDir(pts[i - 1], v);
    const uOut = segDir(v, pts[i + 1]);
    const lenIn = Math.hypot(v.x - pts[i - 1].x, v.y - pts[i - 1].y);
    const lenOut = Math.hypot(pts[i + 1].x - v.x, pts[i + 1].y - v.y);
    const straight = sameDir(uIn, uOut) || sameDir({ dx: -uIn.dx, dy: -uIn.dy }, uOut);
    const r = straight ? 0 : Math.min(CORNER_R, lenIn / 2, lenOut / 2);
    if (r < 0.5) {
      d += ` L${v.x} ${v.y}`;
    } else {
      d += ` L${v.x - r * uIn.dx} ${v.y - r * uIn.dy} Q${v.x} ${v.y} ${v.x + r * uOut.dx} ${v.y + r * uOut.dy}`;
    }
  }
  d += ` L${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
  return d;
}

export function routeWire(A: Pt, dirA: Dir, B: Pt, dirB: Dir): RoutedWire {
  const L = Math.hypot(B.x - A.x, B.y - A.y);
  if (L < 1e-6) return { d: `M${A.x} ${A.y}`, mid: A, points: [A] };
  if (L <= 0.75 * CELL) {
    const pts = [A, B];
    return { d: toPath(pts), mid: midpoint(pts), points: pts };
  }

  const s = Math.min(STUB, L / 2);
  const PA: Pt = { x: A.x + s * dirA.dx, y: A.y + s * dirA.dy };
  const PB: Pt = { x: B.x + s * dirB.dx, y: B.y + s * dirB.dy };
  const mx = (PA.x + PB.x) / 2;
  const my = (PA.y + PB.y) / 2;

  const candidates: Pt[][] = [];
  // perfect inline: B straight ahead of A, B's port facing back at A
  const ab = segDir(A, B);
  if (sameDir(ab, dirA) && sameDir({ dx: -ab.dx, dy: -ab.dy }, dirB) && (near(A.x, B.x) || near(A.y, B.y))) {
    candidates.push([A, B]);
  }
  candidates.push(
    [A, PA, { x: PB.x, y: PA.y }, PB, B], // H then V between stubs
    [A, PA, { x: PA.x, y: PB.y }, PB, B], // V then H
    [A, PA, { x: mx, y: PA.y }, { x: mx, y: PB.y }, PB, B], // HVH
    [A, PA, { x: PA.x, y: my }, { x: PB.x, y: my }, PB, B], // VHV
    [A, { x: B.x, y: A.y }, B], // no-stub L (degrades to straight when aligned)
    [A, { x: A.x, y: B.y }, B],
    [A, B], // last-resort diagonal
  );

  let best: Pt[] | null = null;
  let bestScore = Infinity;
  for (const cand of candidates) {
    const pts = normalize(cand);
    if (pts.length < 2) continue;
    const sc = score(pts, dirA, dirB);
    if (sc < bestScore - 1e-9) {
      bestScore = sc;
      best = pts;
    }
  }
  const pts = best!;
  return { d: toPath(pts), mid: midpoint(pts), points: pts };
}
