import type { PartDef } from '../../data/fittings';
import { PART_BY_ID } from '../../data/fittings';
import type { PartInstance, SystemDefinition } from '../../types';
import { CELL, portDir, portPos, type Dir, type Pt } from './geometry';
import { routeWire } from './route';

/**
 * Splice-into-wire hit testing: while placing a 2-port part, hovering near
 * an existing wire offers to cut the part into it. Hit tests run against the
 * same routed polylines the canvas draws (RoutedWire.points).
 */

export interface WireHit {
  connId: string;
  /** closest point on the wire, px */
  point: Pt;
  /** direction of the hit segment (unit) */
  dir: Dir;
}

const distToSegment = (p: Pt, a: Pt, b: Pt): { d: number; q: Pt } => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy;
  const t = L2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return { d: Math.hypot(p.x - q.x, p.y - q.y), q };
};

export function hitTestWires(system: SystemDefinition, ptPx: Pt, tolPx: number): WireHit | null {
  const byId = new Map(system.parts.map((p) => [p.id, p]));
  let best: (WireHit & { d: number }) | null = null;
  for (const c of system.connections) {
    const pa = byId.get(c.a.part);
    const pb = byId.get(c.b.part);
    if (!pa || !pb || !PART_BY_ID[pa.def]?.ports[c.a.port] || !PART_BY_ID[pb.def]?.ports[c.b.port]) continue;
    const A = portPos(pa, c.a.port);
    const B = portPos(pb, c.b.port);
    const r = routeWire(A, portDir(pa, c.a.port), B, portDir(pb, c.b.port));
    for (let i = 0; i < r.points.length - 1; i++) {
      const a = r.points[i];
      const b = r.points[i + 1];
      const { d, q } = distToSegment(ptPx, a, b);
      if (d > tolPx || (best && d >= best.d)) continue;
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      if (L < 1e-9) continue;
      best = { connId: c.id, point: q, dir: { dx: (b.x - a.x) / L, dy: (b.y - a.y) / L }, d };
    }
  }
  return best && { connId: best.connId, point: best.point, dir: best.dir };
}

/** grid placement (half-cell snap) + rotation aligning a 2-port def to the hit segment */
export function splicePlacement(
  def: PartDef,
  hit: WireHit,
): { x: number; y: number; rot: PartInstance['rot'] } {
  const rot: PartInstance['rot'] = Math.abs(hit.dir.dx) >= Math.abs(hit.dir.dy) ? 0 : 90;
  const snap = (v: number) => Math.round(v * 2) / 2;
  return {
    x: snap(hit.point.x / CELL - def.w / 2),
    y: snap(hit.point.y / CELL - def.h / 2),
    rot,
  };
}

/** true when the hit sits too close to either wire end to fit the part */
export function hitTooCloseToEnds(system: SystemDefinition, hit: WireHit, def: PartDef): boolean {
  const c = system.connections.find((x) => x.id === hit.connId);
  if (!c) return true;
  const byId = new Map(system.parts.map((p) => [p.id, p]));
  const pa = byId.get(c.a.part);
  const pb = byId.get(c.b.part);
  if (!pa || !pb) return true;
  const half = (Math.max(def.w, def.h) / 2) * CELL;
  const A = portPos(pa, c.a.port);
  const B = portPos(pb, c.b.port);
  return Math.hypot(hit.point.x - A.x, hit.point.y - A.y) < half ||
    Math.hypot(hit.point.x - B.x, hit.point.y - B.y) < half;
}
