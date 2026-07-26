import type { Connection, PartInstance, SystemDefinition } from './types';

/**
 * Copy/paste model (pure — the store owns the actual clipboard slot).
 * A copy captures the selected parts plus every connection whose BOTH
 * endpoints are inside the selection; a paste re-mints every id and
 * offsets the parts one cell down-right.
 */

export interface ClipboardData {
  parts: PartInstance[];
  connections: Connection[];
}

export function copyParts(system: SystemDefinition, ids: string[]): ClipboardData | null {
  const keep = new Set(ids);
  const parts = system.parts.filter((p) => keep.has(p.id));
  if (parts.length === 0) return null;
  const connections = system.connections.filter((c) => keep.has(c.a.part) && keep.has(c.b.part));
  return JSON.parse(JSON.stringify({ parts, connections })) as ClipboardData;
}

export function buildPaste(
  clip: ClipboardData,
  mintId: (prefix: string) => string,
): { parts: PartInstance[]; connections: Connection[]; ids: string[] } {
  const idMap = new Map<string, string>();
  const parts = clip.parts.map((p) => {
    const id = mintId(p.def.split('-')[0]);
    idMap.set(p.id, id);
    return { ...p, id, x: p.x + 1, y: p.y + 1, params: { ...p.params } };
  });
  const connections = clip.connections.map((c) => ({
    id: mintId('c'),
    a: { part: idMap.get(c.a.part)!, port: c.a.port },
    b: { part: idMap.get(c.b.part)!, port: c.b.port },
    ...(c.mesh ? { mesh: true } : {}),
  }));
  return { parts, connections, ids: parts.map((p) => p.id) };
}
