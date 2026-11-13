import type {
  Connection, GasId, PartInstance, PortRef, ScriptRow, SimEventAction, SystemDefinition,
} from './types';
import { PART_BY_ID } from './data/fittings';
import { GASES } from './data/gases';

/**
 * The single gate for systems that come from OUTSIDE the running app: a JSON
 * file, a share link, the autosave. Anything the rest of the code would
 * dereference blindly is checked here, and what cannot be used is dropped
 * with a note rather than left to crash the canvas — a part whose catalog id
 * no longer exists, a joint to a port the part does not have, a script row
 * with no action.
 */

export interface NormalizedSystem {
  system: SystemDefinition;
  /** human-readable notes on what was dropped or repaired (empty for a clean file) */
  notes: string[];
}

const ACTION_TYPES: ReadonlySet<SimEventAction['type']> = new Set([
  'valve', 'pump', 'ballast', 'regenerate', 'gauge', 'bakeStart', 'bakeEnd',
  'heSpray', 'setLeak', 'setTemperature', 'powerFail', 'powerRestore',
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function normalizePart(raw: unknown, seen: ReadonlyMap<string, unknown>): PartInstance | string {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return 'a part without an id';
  if (seen.has(raw.id)) return `duplicate part id "${raw.id}"`;
  if (typeof raw.def !== 'string' || !PART_BY_ID[raw.def]) {
    return `part "${raw.id}" of unknown type "${String(raw.def)}"`;
  }
  const params: PartInstance['params'] = {};
  if (isRecord(raw.params)) {
    for (const [k, v] of Object.entries(raw.params)) {
      if (isFiniteNumber(v) || typeof v === 'string' || typeof v === 'boolean') params[k] = v;
    }
  }
  const rot = raw.rot === 90 || raw.rot === 180 || raw.rot === 270 ? raw.rot : 0;
  return {
    id: raw.id,
    def: raw.def,
    x: isFiniteNumber(raw.x) ? raw.x : 0,
    y: isFiniteNumber(raw.y) ? raw.y : 0,
    rot,
    params,
  };
}

function normalizePortRef(raw: unknown, parts: Map<string, PartInstance>): PortRef | null {
  if (!isRecord(raw) || typeof raw.part !== 'string') return null;
  const inst = parts.get(raw.part);
  if (!inst) return null;
  const nPorts = PART_BY_ID[inst.def].ports.length;
  if (!Number.isInteger(raw.port) || (raw.port as number) < 0 || (raw.port as number) >= nPorts) return null;
  return { part: raw.part, port: raw.port as number };
}

function normalizeScriptRow(raw: unknown, idx: number): ScriptRow | null {
  if (!isRecord(raw) || !isRecord(raw.action)) return null;
  const type = raw.action.type;
  if (typeof type !== 'string' || !ACTION_TYPES.has(type as SimEventAction['type'])) return null;
  const row: ScriptRow = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : `ev${idx + 1}`,
    t: isFiniteNumber(raw.t) && raw.t >= 0 ? raw.t : 0,
    action: raw.action as unknown as SimEventAction,
  };
  if (typeof raw.note === 'string') row.note = raw.note;
  return row;
}

/** Validate and repair an untrusted system; null when it is not a system at all. */
export function normalizeSystem(raw: unknown): NormalizedSystem | null {
  if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.parts)) return null;
  const notes: string[] = [];

  const parts = new Map<string, PartInstance>();
  for (const p of raw.parts) {
    const r = normalizePart(p, parts);
    if (typeof r === 'string') notes.push(`dropped ${r}`);
    else parts.set(r.id, r);
  }

  const connections: Connection[] = [];
  const usedPorts = new Set<string>();
  const connIds = new Set<string>();
  let droppedJoints = 0;
  for (const c of Array.isArray(raw.connections) ? raw.connections : []) {
    const a = isRecord(c) ? normalizePortRef(c.a, parts) : null;
    const b = isRecord(c) ? normalizePortRef(c.b, parts) : null;
    const id = isRecord(c) && typeof c.id === 'string' ? c.id : '';
    const ka = a ? `${a.part}:${a.port}` : '';
    const kb = b ? `${b.part}:${b.port}` : '';
    if (!a || !b || !id || connIds.has(id) || ka === kb || usedPorts.has(ka) || usedPorts.has(kb)) {
      droppedJoints++;
      continue;
    }
    connIds.add(id);
    usedPorts.add(ka);
    usedPorts.add(kb);
    const conn: Connection = { id, a, b };
    if ((c as Record<string, unknown>).mesh === true) conn.mesh = true;
    connections.push(conn);
  }
  if (droppedJoints) notes.push(`dropped ${droppedJoints} joint(s) to missing parts or ports`);

  const script: ScriptRow[] = [];
  const rawScript = Array.isArray(raw.script) ? raw.script : [];
  rawScript.forEach((r, i) => {
    const row = normalizeScriptRow(r, i);
    if (row) script.push(row);
  });
  if (script.length < rawScript.length) {
    notes.push(`dropped ${rawScript.length - script.length} unreadable script row(s)`);
  }

  const system: SystemDefinition = {
    version: 1,
    name: typeof raw.name === 'string' ? raw.name : 'Untitled system',
    parts: [...parts.values()],
    connections,
    script,
    humidityRH: isFiniteNumber(raw.humidityRH) ? Math.max(0, Math.min(100, raw.humidityRH)) : 50,
  };
  if (Array.isArray(raw.species)) {
    const species = raw.species.filter((g): g is GasId => typeof g === 'string' && g in GASES);
    if (species.length) system.species = [...new Set(species)];
  }
  return { system, notes };
}
