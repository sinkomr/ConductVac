import type { Connection, SystemDefinition } from '../../types';
import { PART_BY_ID, portFlange } from '../../data/fittings';
import { CELL, partBBox, portDir, portPos, type Dir, type Pt } from './geometry';

/**
 * Port auto-assignment ("tidy"): re-assign connection endpoints among
 * physically-equivalent ports of each part so wires stop crossing each
 * other, part bodies, and their own part. Physics-safe by construction:
 *
 *  - chamber ports all compile to one node; cross arms are identical stubs;
 *    tube/flex/bellows/elbow/valve/butterfly/metering/coldtrap-inline are
 *    symmetric two-port parts — permutation yields an isomorphic network;
 *  - a tee's two RUN ports (0, 1) are symmetric, but the branch (2) carries
 *    a 90° bend in the engine model, so it is pinned;
 *  - pumps (inlet vs backing) and adapters (flange A vs B) are never touched.
 *
 * Deterministic: parts in array order, strict-improvement sweeps to a fixed
 * point (idempotent — running tidy on its own output changes nothing).
 */

export interface TidyResult {
  connections: Connection[];
  changed: boolean;
}

const SYMMETRIC_KINDS = new Set([
  'chamber', 'tube', 'flex', 'bellows', 'elbow', 'tee', 'cross',
  'valve', 'valve-butterfly', 'valve-metering', 'coldtrap-inline',
]);

const K_FACE = 60;
const K_CROSS = 150;
const K_BODY = 200;
const MAX_SWEEPS = 10;
const MAX_BRUTE = 50000;

interface Endpoint {
  conn: number;
  side: 'a' | 'b';
}

type Seg = [Pt, Pt];

const shares = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;

/** proper crossing of open segments; shared endpoints don't count; collinear overlap > 1 px does */
export function segmentsCross(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  if (shares(p1, p3) || shares(p1, p4) || shares(p2, p3) || shares(p2, p4)) return false;
  const d = (a: Pt, b: Pt, c: Pt) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  if (Math.abs(d1) < 1e-9 && Math.abs(d2) < 1e-9 && Math.abs(d3) < 1e-9 && Math.abs(d4) < 1e-9) {
    // collinear: project on the dominant axis and measure interval overlap
    const horiz = Math.abs(p2.x - p1.x) + Math.abs(p4.x - p3.x) >= Math.abs(p2.y - p1.y) + Math.abs(p4.y - p3.y);
    const [a0, a1] = horiz ? [p1.x, p2.x] : [p1.y, p2.y];
    const [b0, b1] = horiz ? [p3.x, p4.x] : [p3.y, p4.y];
    const lo = Math.max(Math.min(a0, a1), Math.min(b0, b1));
    const hi = Math.min(Math.max(a0, a1), Math.max(b0, b1));
    return hi - lo > 1;
  }
  return false;
}

/** length of the part of segment ab inside rect r shrunk by 3 px (Liang–Barsky) */
function clipLen(a: Pt, b: Pt, r: { x: number; y: number; w: number; h: number }): number {
  const x0 = r.x + 3;
  const y0 = r.y + 3;
  const x1 = r.x + r.w - 3;
  const y1 = r.y + r.h - 3;
  if (x1 <= x0 || y1 <= y0) return 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - x0, x1 - a.x, a.y - y0, y1 - a.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-12) {
      if (q[i] < 0) return 0;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return 0;
    }
  }
  return (t1 - t0) * Math.hypot(dx, dy);
}

/** per-wire cost, independent of other wires (length + facing + body clips) */
function baseCost(A: Pt, dA: Dir, B: Pt, dB: Dir, boxes: { x: number; y: number; w: number; h: number }[]): number {
  let c = Math.hypot(B.x - A.x, B.y - A.y);
  if (dA.dx * (B.x - A.x) + dA.dy * (B.y - A.y) < 0) c += K_FACE;
  if (dB.dx * (A.x - B.x) + dB.dy * (A.y - B.y) < 0) c += K_FACE;
  for (const bb of boxes) if (clipLen(A, B, bb) > 0.3 * CELL) c += K_BODY;
  return c;
}

/** injective assignments of k endpoints onto the given ports, lexicographic */
function* assignments(ports: number[], k: number): Generator<number[]> {
  const pick: number[] = [];
  const used = new Array<boolean>(ports.length).fill(false);
  function* rec(depth: number): Generator<number[]> {
    if (depth === k) {
      yield [...pick];
      return;
    }
    for (let i = 0; i < ports.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      pick.push(ports[i]);
      yield* rec(depth + 1);
      pick.pop();
      used[i] = false;
    }
  }
  yield* rec(0);
}

const permCount = (m: number, k: number): number => {
  let n = 1;
  for (let i = 0; i < k; i++) n *= m - i;
  return n;
};

/**
 * Total wiring objective for a full system — the quantity tidy minimizes
 * (sweeps are strict local improvements, so tidy never increases it).
 */
export function wiringCost(sys: SystemDefinition, connections: Connection[]): number {
  const partById = new Map(sys.parts.map((p) => [p.id, p]));
  const boxes = sys.parts.filter((p) => PART_BY_ID[p.def]).map((p) => partBBox(p));
  const wires: { A: Pt; dA: Dir; B: Pt; dB: Dir }[] = [];
  for (const c of connections) {
    const pa = partById.get(c.a.part);
    const pb = partById.get(c.b.part);
    if (!pa || !pb || !PART_BY_ID[pa.def]?.ports[c.a.port] || !PART_BY_ID[pb.def]?.ports[c.b.port]) continue;
    wires.push({
      A: portPos(pa, c.a.port), dA: portDir(pa, c.a.port),
      B: portPos(pb, c.b.port), dB: portDir(pb, c.b.port),
    });
  }
  let cost = 0;
  for (let i = 0; i < wires.length; i++) {
    cost += baseCost(wires[i].A, wires[i].dA, wires[i].B, wires[i].dB, boxes);
    for (let j = i + 1; j < wires.length; j++) {
      if (segmentsCross(wires[i].A, wires[i].B, wires[j].A, wires[j].B)) cost += K_CROSS;
    }
  }
  return cost;
}

export function tidyConnections(sys: SystemDefinition): TidyResult {
  const conns: Connection[] = sys.connections.map((c) => ({ ...c, a: { ...c.a }, b: { ...c.b } }));
  const partById = new Map(sys.parts.map((p) => [p.id, p]));
  const boxes = sys.parts.filter((p) => PART_BY_ID[p.def]).map((p) => partBBox(p));

  // a connection is geometrizable when both parts + defs + ports exist
  const live = (c: Connection) => {
    const pa = partById.get(c.a.part);
    const pb = partById.get(c.b.part);
    return !!(pa && pb && PART_BY_ID[pa.def]?.ports[c.a.port] && PART_BY_ID[pb.def]?.ports[c.b.port]);
  };

  const endGeom = (c: Connection, side: 'a' | 'b'): { pos: Pt; dir: Dir } => {
    const ref = c[side];
    const inst = partById.get(ref.part)!;
    return { pos: portPos(inst, ref.port), dir: portDir(inst, ref.port) };
  };

  /** equivalence groups of port indices for one part (arrays of >= 2 ports) */
  const groupsOf = (partId: string): number[][] => {
    const inst = partById.get(partId)!;
    const def = PART_BY_ID[inst.def];
    if (!def || !SYMMETRIC_KINDS.has(def.kind)) return [];
    const params = { ...def.defaults, ...inst.params };
    const byFlange = new Map<string, number[]>();
    const indices = def.kind === 'tee' ? [0, 1] : def.ports.map((_, i) => i);
    for (const i of indices) {
      const f = portFlange(def, i, params);
      const g = byFlange.get(f);
      if (g) g.push(i);
      else byFlange.set(f, [i]);
    }
    return [...byFlange.values()].filter((g) => g.length >= 2);
  };

  let changed = false;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    let sweepChanged = false;

    for (const part of sys.parts) {
      for (const group of groupsOf(part.id)) {
        // endpoints of live connections currently on this group's ports
        const M: Endpoint[] = [];
        const pinned = new Set<number>(); // group ports held by non-movable endpoints
        for (let i = 0; i < conns.length; i++) {
          for (const side of ['a', 'b'] as const) {
            const ref = conns[i][side];
            if (ref.part !== part.id || !group.includes(ref.port)) continue;
            if (live(conns[i])) M.push({ conn: i, side });
            else pinned.add(ref.port);
          }
        }
        if (M.length < 1) continue;
        const ports = group.filter((p) => !pinned.has(p));
        if (ports.length < 2 || M.length > ports.length) continue;

        // static context: every live wire not touched by this group
        const affected = [...new Set(M.map((e) => e.conn))];
        const affectedSet = new Set(affected);
        const staticSegs: Seg[] = [];
        for (let i = 0; i < conns.length; i++) {
          if (affectedSet.has(i) || !live(conns[i])) continue;
          staticSegs.push([endGeom(conns[i], 'a').pos, endGeom(conns[i], 'b').pos]);
        }
        const portGeom = new Map(ports.map((p) => {
          const inst = partById.get(part.id)!;
          return [p, { pos: portPos(inst, p), dir: portDir(inst, p) }];
        }));

        // score one assignment (ports for each endpoint of M, in order)
        const evaluate = (assign: number[]): number => {
          const endPort = new Map<string, number>();
          M.forEach((e, i) => endPort.set(`${e.conn}:${e.side}`, assign[i]));
          const segs: { A: Pt; dA: Dir; B: Pt; dB: Dir }[] = [];
          for (const ci of affected) {
            const c = conns[ci];
            const g = (side: 'a' | 'b') => {
              const moved = endPort.get(`${ci}:${side}`);
              return moved !== undefined ? portGeom.get(moved)! : endGeom(c, side);
            };
            const ga = g('a');
            const gb = g('b');
            segs.push({ A: ga.pos, dA: ga.dir, B: gb.pos, dB: gb.dir });
          }
          let cost = 0;
          for (let i = 0; i < segs.length; i++) {
            const s = segs[i];
            cost += baseCost(s.A, s.dA, s.B, s.dB, boxes);
            for (const [p3, p4] of staticSegs) if (segmentsCross(s.A, s.B, p3, p4)) cost += K_CROSS;
            for (let j = i + 1; j < segs.length; j++) {
              if (segmentsCross(s.A, s.B, segs[j].A, segs[j].B)) cost += K_CROSS;
            }
          }
          return cost;
        };

        const current = M.map((e) => conns[e.conn][e.side].port);
        const currentCost = evaluate(current);
        let best = current;
        let bestCost = currentCost;

        if (permCount(ports.length, M.length) <= MAX_BRUTE) {
          for (const assign of assignments(ports, M.length)) {
            const c = evaluate(assign);
            if (c < bestCost - 1e-6) {
              bestCost = c;
              best = assign;
            }
          }
        } else {
          // greedy fallback for hypothetical huge parts: pairwise swaps + moves
          best = [...current];
          let improved = true;
          while (improved) {
            improved = false;
            for (let i = 0; i < best.length; i++) {
              for (const p of ports) {
                if (best[i] === p) continue;
                const j = best.indexOf(p);
                const cand = [...best];
                cand[i] = p;
                if (j >= 0) cand[j] = best[i]; // p was taken: swap
                const c = evaluate(cand);
                if (c < bestCost - 1e-6) {
                  bestCost = c;
                  best = cand;
                  improved = true;
                }
              }
            }
          }
        }

        if (best !== current && best.some((p, i) => p !== current[i])) {
          M.forEach((e, i) => {
            conns[e.conn][e.side].port = best[i];
          });
          changed = true;
          sweepChanged = true;
        }
      }
    }

    if (!sweepChanged) break;
  }

  return { connections: conns, changed };
}
