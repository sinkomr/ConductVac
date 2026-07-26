import type { PartInstance } from '../../types';
import { partBBox } from './geometry';

/** ids of every part whose (rotation-aware) bbox overlaps the marquee rect (px space) */
export function partsInRect(
  parts: PartInstance[],
  rect: { x: number; y: number; w: number; h: number },
): string[] {
  const out: string[] = [];
  for (const p of parts) {
    let bb: ReturnType<typeof partBBox>;
    try {
      bb = partBBox(p);
    } catch {
      continue; // unknown def
    }
    if (bb.x < rect.x + rect.w && bb.x + bb.w > rect.x && bb.y < rect.y + rect.h && bb.y + bb.h > rect.y) {
      out.push(p.id);
    }
  }
  return out;
}
