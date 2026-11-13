import type { SystemDefinition } from '../../types';
import { PART_BY_ID } from '../../data/fittings';
import { CELL, partBBox, portDir, portPos, type Dir, type Pt } from './geometry';
import { finishRoute, routeWire, type RoutedWire } from './route';

/**
 * Whole-diagram wire routing. routeWire() shapes one wire from its two ports
 * alone; this module routes ALL wires together, so a wire knows where the
 * parts and the other wires are:
 *
 *  1. Shortest wires first. Each wire's simple shape (routeWire) is kept if
 *     it is clean: clear of every part body and neither crossing nor lying
 *     on a wire already placed.
 *  2. Otherwise the wire is routed by A* over a sparse orthogonal grid —
 *     lines at every port, stub, part edge (plus a clearance margin) and a
 *     half-cell lattice for spare tracks. Cost = length + a charge per bend,
 *     per crossing, for running along an existing wire, and (steeply) for
 *     cutting through a part.
 *
 * Passing through a part is expensive rather than forbidden, so a route
 * always exists: a port boxed in by its neighbours still gets a wire, drawn
 * behind the symbols as before.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WireRequest {
  id: string;
  A: Pt;
  dirA: Dir;
  B: Pt;
  dirB: Dir;
}

const STUB = CELL * 0.5;
/** clearance kept between a routed wire and a part body (must stay below STUB) */
const MARGIN = CELL * 0.35;
const LATTICE = CELL * 0.5;
/** parallel wires closer than this count as lying on top of each other */
const SEPARATION = CELL * 0.2;

const BEND = 18;
const CROSSING = 45;
const OVERLAP_FIXED = 40;
const OVERLAP_PER_PX = 6;
// Cutting through a part is dear but not prohibitive: a long loop around a
// whole pump reads worse than a short wire tucked behind a fitting. Skimming
// a part inside its clearance margin costs only a little — every wire has to
// do that to reach its own ports.
const BODY_FIXED = 40;
const BODY_PER_PX = 3;
const NEAR_PER_PX = 0.6;
const WRONG_ENTRY = 400;

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
const dirIndex = (d: Dir): number => (d.dx > 0.5 ? 0 : d.dy > 0.5 ? 1 : d.dx < -0.5 ? 2 : 3);

function uniqueSorted(values: number[]): Float64Array {
  values.sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of values) {
    if (!out.length || v - out[out.length - 1] > 0.5) out.push(v);
  }
  return Float64Array.from(out);
}

/** index of the grid line at `v` (lines are deduplicated to 0.5 px), or -1 */
function lineAt(lines: Float64Array, v: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid] < v - 0.5) lo = mid + 1;
    else hi = mid;
  }
  return Math.abs(lines[lo] - v) <= 0.5 ? lo : -1;
}

/** min-heap of (priority, state) pairs */
class Heap {
  private readonly pri: number[] = [];
  private readonly val: number[] = [];
  get size(): number {
    return this.pri.length;
  }
  push(p: number, v: number): void {
    const { pri, val } = this;
    let i = pri.length;
    pri.push(p);
    val.push(v);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (pri[parent] <= p) break;
      pri[i] = pri[parent];
      val[i] = val[parent];
      i = parent;
    }
    pri[i] = p;
    val[i] = v;
  }
  pop(): number {
    const { pri, val } = this;
    const top = val[0];
    const p = pri.pop()!;
    const v = val.pop()!;
    const n = pri.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let child = 2 * i + 1;
        if (child >= n) break;
        if (child + 1 < n && pri[child + 1] < pri[child]) child++;
        if (pri[child] >= p) break;
        pri[i] = pri[child];
        val[i] = val[child];
        i = child;
      }
      pri[i] = p;
      val[i] = v;
    }
    return top;
  }
}

/** does the axis-aligned segment a–b pass through the interior of `box` (shrunk by `inset`)? */
function segmentHitsBox(a: Pt, b: Pt, box: Box, inset: number): boolean {
  const x0 = box.x + inset, x1 = box.x + box.w - inset;
  const y0 = box.y + inset, y1 = box.y + box.h - inset;
  if (x1 <= x0 || y1 <= y0) return false;
  // Liang–Barsky clip of the segment against the open rectangle
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q > 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  return clip(-dx, a.x - x0) && clip(dx, x1 - a.x) && clip(-dy, a.y - y0) && clip(dy, y1 - a.y) && t1 - t0 > 1e-9;
}

class Router {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly nx: number;
  private readonly ny: number;
  /**
   * per horizontal edge (yi, xi → xi+1) / vertical edge (yi → yi+1, xi):
   * 2 = through a part's body, 1 = inside its clearance margin
   */
  private readonly hBody: Uint8Array;
  private readonly vBody: Uint8Array;
  /** wires already running along each edge */
  private readonly hUse: Uint8Array;
  private readonly vUse: Uint8Array;
  /** per node: a wire already passes through it horizontally / vertically */
  private readonly nodeH: Uint8Array;
  private readonly nodeV: Uint8Array;
  private readonly placed: [Pt, Pt][] = [];
  private readonly g: Float64Array;
  private readonly from: Int32Array;

  constructor(wires: WireRequest[], private readonly boxes: Box[]) {
    const xv: number[] = [];
    const yv: number[] = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const see = (x: number, y: number) => {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    for (const b of boxes) {
      xv.push(b.x - MARGIN, b.x + b.w + MARGIN);
      yv.push(b.y - MARGIN, b.y + b.h + MARGIN);
      see(b.x, b.y);
      see(b.x + b.w, b.y + b.h);
    }
    for (const w of wires) {
      const pa = stubPoint(w.A, w.dirA, w.B);
      const pb = stubPoint(w.B, w.dirB, w.A);
      xv.push(w.A.x, w.B.x, pa.x, pb.x, (pa.x + pb.x) / 2);
      yv.push(w.A.y, w.B.y, pa.y, pb.y, (pa.y + pb.y) / 2);
      see(w.A.x, w.A.y);
      see(w.B.x, w.B.y);
    }
    const pad = 3 * CELL;
    for (let x = Math.floor((minX - pad) / LATTICE) * LATTICE; x <= maxX + pad; x += LATTICE) xv.push(x);
    for (let y = Math.floor((minY - pad) / LATTICE) * LATTICE; y <= maxY + pad; y += LATTICE) yv.push(y);
    this.xs = uniqueSorted(xv);
    this.ys = uniqueSorted(yv);
    const nx = (this.nx = this.xs.length);
    const ny = (this.ny = this.ys.length);

    this.hBody = new Uint8Array(nx * ny);
    this.vBody = new Uint8Array(nx * ny);
    this.hUse = new Uint8Array(nx * ny);
    this.vUse = new Uint8Array(nx * ny);
    this.nodeH = new Uint8Array(nx * ny);
    this.nodeV = new Uint8Array(nx * ny);
    this.g = new Float64Array(nx * ny * 4);
    this.from = new Int32Array(nx * ny * 4);

    const { xs, ys } = this;
    const mark = (b: Box, grow: number, level: number) => {
      const x0 = b.x - grow + 0.75, x1 = b.x + b.w + grow - 0.75;
      const y0 = b.y - grow + 0.75, y1 = b.y + b.h + grow - 0.75;
      for (let yi = 0; yi < ny; yi++) {
        const rowInside = ys[yi] > y0 && ys[yi] < y1;
        for (let xi = 0; xi < nx; xi++) {
          const colInside = xs[xi] > x0 && xs[xi] < x1;
          const k = yi * nx + xi;
          if (rowInside && xi + 1 < nx && xs[xi + 1] > x0 && xs[xi] < x1 && this.hBody[k] < level) this.hBody[k] = level;
          if (colInside && yi + 1 < ny && ys[yi + 1] > y0 && ys[yi] < y1 && this.vBody[k] < level) this.vBody[k] = level;
        }
      }
    };
    for (const b of boxes) {
      mark(b, MARGIN, 1);
      mark(b, 0, 2);
    }
  }

  /** record a placed wire so later wires keep off it */
  place(points: Pt[]): void {
    const { xs, ys, nx, ny } = this;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      this.placed.push([a, b]);
      if (Math.abs(a.y - b.y) < 0.5) {
        const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
        for (let yi = 0; yi < ny; yi++) {
          const off = Math.abs(ys[yi] - a.y);
          if (off > SEPARATION) continue;
          for (let xi = 0; xi < nx; xi++) {
            if (xi + 1 < nx && xs[xi + 1] > lo + 0.5 && xs[xi] < hi - 0.5) this.hUse[yi * nx + xi] = 1;
            if (off <= 0.5 && xs[xi] > lo + 0.5 && xs[xi] < hi - 0.5) this.nodeH[yi * nx + xi] = 1;
          }
        }
      } else if (Math.abs(a.x - b.x) < 0.5) {
        const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
        for (let xi = 0; xi < nx; xi++) {
          const off = Math.abs(xs[xi] - a.x);
          if (off > SEPARATION) continue;
          for (let yi = 0; yi < ny; yi++) {
            if (yi + 1 < ny && ys[yi + 1] > lo + 0.5 && ys[yi] < hi - 0.5) this.vUse[yi * nx + xi] = 1;
            if (off <= 0.5 && ys[yi] > lo + 0.5 && ys[yi] < hi - 0.5) this.nodeV[yi * nx + xi] = 1;
          }
        }
      }
    }
  }

  /**
   * Is this polyline clean — clear of part bodies, and neither crossing nor
   * running along a placed wire? The end stubs may touch their own part.
   */
  isClean(points: Pt[]): boolean {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      for (const box of this.boxes) {
        if (segmentHitsBox(a, b, box, 1)) return false;
      }
      const horizontal = Math.abs(a.y - b.y) < 0.5;
      const vertical = Math.abs(a.x - b.x) < 0.5;
      for (const [c, d] of this.placed) {
        const ch = Math.abs(c.y - d.y) < 0.5;
        const cv = Math.abs(c.x - d.x) < 0.5;
        if (horizontal && ch) {
          if (Math.abs(a.y - c.y) <= SEPARATION &&
            Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 0.5) return false;
        } else if (vertical && cv) {
          if (Math.abs(a.x - c.x) <= SEPARATION &&
            Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 0.5) return false;
        } else if (properCross(a, b, c, d)) {
          return false;
        }
      }
    }
    return true;
  }

  /** A* from stub point `pa` (leaving along dirA) to stub point `pb` (arriving against dirB) */
  search(pa: Pt, dirA: Dir, pb: Pt, dirB: Dir): Pt[] | null {
    const { xs, ys, nx, ny, g, from } = this;
    const sx = lineAt(xs, pa.x), sy = lineAt(ys, pa.y);
    const tx = lineAt(xs, pb.x), ty = lineAt(ys, pb.y);
    if (sx < 0 || sy < 0 || tx < 0 || ty < 0) return null;
    const wantIn = (dirIndex(dirB) + 2) % 4;
    const goalX = xs[tx], goalY = ys[ty];

    g.fill(Infinity);
    const heap = new Heap();
    const start = (sy * nx + sx) * 4 + dirIndex(dirA);
    g[start] = 0;
    from[start] = -1;
    heap.push(Math.abs(pa.x - goalX) + Math.abs(pa.y - goalY), start);

    let best = -1;
    let bestCost = Infinity;
    while (heap.size) {
      const state = heap.pop();
      const cost = g[state];
      const d = state & 3;
      const node = state >> 2;
      const xi = node % nx;
      const yi = (node - xi) / nx;
      if (cost + Math.abs(xs[xi] - goalX) + Math.abs(ys[yi] - goalY) >= bestCost) break;
      if (xi === tx && yi === ty) {
        // entering the port: a turn into the final stub costs a bend, arriving
        // head-on from the wrong side would mean doubling back through the part
        const total = cost + (d === wantIn ? 0 : d === (wantIn + 2) % 4 ? WRONG_ENTRY : BEND);
        if (total < bestCost) {
          bestCost = total;
          best = state;
        }
        continue;
      }
      for (let nd = 0; nd < 4; nd++) {
        if (nd === (d + 2) % 4) continue; // no U-turns
        const nxi = xi + DX[nd];
        const nyi = yi + DY[nd];
        if (nxi < 0 || nyi < 0 || nxi >= nx || nyi >= ny) continue;
        const horizontal = nd === 0 || nd === 2;
        const edge = horizontal ? yi * nx + Math.min(xi, nxi) : Math.min(yi, nyi) * nx + xi;
        const len = horizontal ? Math.abs(xs[nxi] - xs[xi]) : Math.abs(ys[nyi] - ys[yi]);
        let step = len;
        if (nd !== d) step += BEND;
        const body = horizontal ? this.hBody[edge] : this.vBody[edge];
        if (body === 2) step += BODY_FIXED + BODY_PER_PX * len;
        else if (body === 1) step += NEAR_PER_PX * len;
        if (horizontal ? this.hUse[edge] : this.vUse[edge]) step += OVERLAP_FIXED + OVERLAP_PER_PX * len;
        const nnode = nyi * nx + nxi;
        // crossing: passing through a node another wire occupies in the other axis
        if (!(nxi === tx && nyi === ty) && (horizontal ? this.nodeV[nnode] : this.nodeH[nnode])) step += CROSSING;
        const next = nnode * 4 + nd;
        const total = cost + step;
        if (total < g[next] - 1e-9) {
          g[next] = total;
          from[next] = state;
          heap.push(total + Math.abs(xs[nxi] - goalX) + Math.abs(ys[nyi] - goalY), next);
        }
      }
    }
    if (best < 0) return null;
    const path: Pt[] = [];
    for (let s = best; s >= 0; s = from[s]) {
      const node = s >> 2;
      const xi = node % nx;
      path.push({ x: xs[xi], y: ys[(node - xi) / nx] });
    }
    return path.reverse();
  }
}

function properCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0.5 && d2 < -0.5) || (d1 < -0.5 && d2 > 0.5)) && ((d3 > 0.5 && d4 < -0.5) || (d3 < -0.5 && d4 > 0.5));
}

function pathLength(points: Pt[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i++) len += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  return len;
}

/** where a wire's stub ends: half a cell out of the port, less for a very short wire */
function stubPoint(port: Pt, dir: Dir, other: Pt): Pt {
  const s = Math.min(STUB, Math.hypot(other.x - port.x, other.y - port.y) / 2);
  return { x: port.x + s * dir.dx, y: port.y + s * dir.dy };
}

/** Route a set of wires around the given part boxes and around each other. */
export function routeWires(wires: WireRequest[], boxes: Box[]): Map<string, RoutedWire> {
  const out = new Map<string, RoutedWire>();
  if (wires.length === 0) return out;
  const router = new Router(wires, boxes);
  const manhattan = (w: WireRequest) => Math.abs(w.A.x - w.B.x) + Math.abs(w.A.y - w.B.y);
  const order = [...wires].sort((p, q) => manhattan(p) - manhattan(q));
  for (const w of order) {
    const simple = routeWire(w.A, w.dirA, w.B, w.dirB);
    let route = simple;
    // a direct port-to-port wire (touching or nearly touching parts) stays as it is
    const direct = simple.points.length <= 2 && Math.hypot(w.A.x - w.B.x, w.A.y - w.B.y) <= 2 * STUB;
    if (!direct && !router.isClean(simple.points)) {
      const pa = stubPoint(w.A, w.dirA, w.B);
      const pb = stubPoint(w.B, w.dirB, w.A);
      const path = router.search(pa, w.dirA, pb, w.dirB);
      if (path) {
        // Take the detour only while it stays in proportion. Part outlines
        // are approximated by their bounding boxes, and the only clean way
        // round can be a lap of a whole pump: then the short wire, tucked
        // behind a symbol as it always was, is the better drawing.
        const detour = finishRoute([w.A, ...path, w.B]);
        const simpleLen = pathLength(simple.points);
        if (pathLength(detour.points) <= Math.max(1.6 * simpleLen, simpleLen + 4 * CELL)) route = detour;
      }
    }
    router.place(route.points);
    out.set(w.id, route);
  }
  return out;
}

// The canvas, the splice hit-test and the SVG export all ask for the same
// layout many times over (every render, every pointer move while placing).
// Store updates are immutable, so array identity is a sound cache key.
let cache: { parts: unknown; connections: unknown; routes: Map<string, RoutedWire> } | null = null;

/** Route every connection of a system (connections with a missing part or port are skipped). */
export function routeSystem(system: Pick<SystemDefinition, 'parts' | 'connections'>): Map<string, RoutedWire> {
  if (cache && cache.parts === system.parts && cache.connections === system.connections) return cache.routes;
  const routes = computeRoutes(system);
  cache = { parts: system.parts, connections: system.connections, routes };
  return routes;
}

function computeRoutes(system: Pick<SystemDefinition, 'parts' | 'connections'>): Map<string, RoutedWire> {
  const byId = new Map(system.parts.map((p) => [p.id, p]));
  const boxes: Box[] = [];
  for (const p of system.parts) {
    if (PART_BY_ID[p.def]) boxes.push(partBBox(p));
  }
  const wires: WireRequest[] = [];
  for (const c of system.connections) {
    const pa = byId.get(c.a.part);
    const pb = byId.get(c.b.part);
    if (!pa || !pb || !PART_BY_ID[pa.def]?.ports[c.a.port] || !PART_BY_ID[pb.def]?.ports[c.b.port]) continue;
    wires.push({
      id: c.id,
      A: portPos(pa, c.a.port), dirA: portDir(pa, c.a.port),
      B: portPos(pb, c.b.port), dirB: portDir(pb, c.b.port),
    });
  }
  return routeWires(wires, boxes);
}
