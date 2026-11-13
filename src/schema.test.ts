import { describe, expect, it } from 'vitest';
import { normalizeSystem } from './schema';
import { EXAMPLES } from './examples';

const base = () => ({
  version: 1,
  name: 't',
  humidityRH: 50,
  parts: [
    { id: 'ch', def: 'chamber-cell', x: 1, y: 2, rot: 0, params: { D: 150 } },
    { id: 'hose', def: 'flex-KF25', x: 5, y: 2, rot: 90, params: { length: 500 } },
  ],
  connections: [{ id: 'c1', a: { part: 'ch', port: 1 }, b: { part: 'hose', port: 0 } }],
  script: [{ id: 'ev1', t: 10, action: { type: 'powerFail' } }],
});

describe('normalizeSystem', () => {
  it('passes every bundled example through unchanged', () => {
    for (const ex of EXAMPLES) {
      const n = normalizeSystem(JSON.parse(JSON.stringify(ex.system)));
      expect(n?.notes).toEqual([]);
      expect(n?.system).toEqual(JSON.parse(JSON.stringify(ex.system)));
    }
  });

  it('rejects things that are not systems', () => {
    for (const bad of [null, 42, 'x', [], {}, { version: 2, parts: [] }, { version: 1, parts: 'no' }]) {
      expect(normalizeSystem(bad)).toBeNull();
    }
  });

  it('fills in arrays a truncated file left out', () => {
    const n = normalizeSystem({ version: 1, parts: [] });
    expect(n?.system).toEqual({
      version: 1, name: 'Untitled system', parts: [], connections: [], script: [], humidityRH: 50,
    });
  });

  it('drops a part whose catalog id no longer exists, and its joints', () => {
    const raw = base();
    raw.parts[1].def = 'flex-KF25-renamed';
    const n = normalizeSystem(raw)!;
    expect(n.system.parts.map((p) => p.id)).toEqual(['ch']);
    expect(n.system.connections).toEqual([]);
    expect(n.notes.join(' ')).toContain('unknown type "flex-KF25-renamed"');
    expect(n.notes.join(' ')).toContain('1 joint');
  });

  it('drops a joint to a port the part does not have', () => {
    const raw = base();
    raw.connections[0].b.port = 7;
    expect(normalizeSystem(raw)!.system.connections).toEqual([]);
  });

  it('drops a second joint on an occupied port and a duplicate part id', () => {
    const raw = base();
    raw.connections.push({ id: 'c2', a: { part: 'ch', port: 1 }, b: { part: 'hose', port: 1 } });
    raw.parts.push({ ...raw.parts[0] });
    const n = normalizeSystem(raw)!;
    expect(n.system.connections.map((c) => c.id)).toEqual(['c1']);
    expect(n.system.parts).toHaveLength(2);
  });

  it('repairs bad scalars instead of passing NaN into the app', () => {
    const raw = base() as Record<string, unknown>;
    raw.humidityRH = 'wet';
    (raw.parts as Record<string, unknown>[])[0].x = null;
    (raw.parts as Record<string, unknown>[])[0].rot = 45;
    (raw.parts as Record<string, unknown>[])[0].params = { D: NaN, L: 300, nested: { a: 1 } };
    (raw.script as unknown[]).push({ id: 'ev2', t: 5, action: { type: 'selfDestruct' } }, 'junk');
    const n = normalizeSystem(JSON.parse(JSON.stringify(raw)))!;
    expect(n.system.humidityRH).toBe(50);
    expect(n.system.parts[0]).toMatchObject({ x: 0, rot: 0, params: { L: 300 } });
    expect(n.system.script.map((r) => r.id)).toEqual(['ev1']);
    expect(n.notes.join(' ')).toContain('2 unreadable script row');
  });
});
