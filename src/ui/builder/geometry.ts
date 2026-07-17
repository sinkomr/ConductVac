import type { PartInstance } from '../../types';
import { PART_BY_ID } from '../../data/fittings';

/**
 * Canvas geometry helpers shared by rendering (Canvas/PartSymbol), the wire
 * router (route.ts) and the port-assignment tidy pass (tidy.ts). This module
 * must stay importable in a node test environment: it may depend only on
 * types and the parts catalog (no store, no components, no ?worker chains).
 */

export const CELL = 26; // px per grid unit

export interface Pt {
  x: number;
  y: number;
}

/** unit axis vector: which way a port faces, out of the part */
export interface Dir {
  dx: number;
  dy: number;
}

const rotate = (dx: number, dy: number, rot: number): [number, number] => {
  if (rot === 90) return [-dy, dx];
  if (rot === 180) return [-dx, -dy];
  if (rot === 270) return [dy, -dx];
  return [dx, dy];
};

/** transformed port position (px, canvas space) */
export function portPos(inst: PartInstance, portIdx: number): Pt {
  const def = PART_BY_ID[inst.def];
  const p = def.ports[portIdx];
  const cx = def.w / 2;
  const cy = def.h / 2;
  const [dx, dy] = rotate(p.x - cx, p.y - cy, inst.rot);
  return { x: (inst.x + cx + dx) * CELL, y: (inst.y + cy + dy) * CELL };
}

/**
 * Outward normal of a port: which bounding-box edge it sits on, rotated with
 * the part. Corner ports (5/6-way crosses) tie-break by the dominant axis
 * from the part center; exact center ties resolve horizontal.
 */
export function portDir(inst: PartInstance, portIdx: number): Dir {
  const def = PART_BY_ID[inst.def];
  const p = def.ports[portIdx];
  const EPS = 1e-6;
  const onL = p.x < EPS;
  const onR = p.x > def.w - EPS;
  const onT = p.y < EPS;
  const onB = p.y > def.h - EPS;
  const horiz = (onL || onR) && (!(onT || onB) || Math.abs(p.x - def.w / 2) >= Math.abs(p.y - def.h / 2));
  let dx = 0;
  let dy = 0;
  if (horiz) dx = onL ? -1 : 1;
  else if (onT || onB) dy = onT ? -1 : 1;
  else if (Math.abs(p.x - def.w / 2) >= Math.abs(p.y - def.h / 2)) dx = Math.sign(p.x - def.w / 2) || 1;
  else dy = Math.sign(p.y - def.h / 2) || 1;
  const [rx, ry] = rotate(dx, dy, inst.rot);
  return { dx: rx + 0, dy: ry + 0 }; // + 0 normalizes -0
}

/** rotation-aware occupied rectangle in px (portPos rotates about the center) */
export function partBBox(inst: PartInstance): { x: number; y: number; w: number; h: number } {
  const def = PART_BY_ID[inst.def];
  const cx = (inst.x + def.w / 2) * CELL;
  const cy = (inst.y + def.h / 2) * CELL;
  const [bw, bh] = inst.rot % 180 === 0 ? [def.w * CELL, def.h * CELL] : [def.h * CELL, def.w * CELL];
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}
