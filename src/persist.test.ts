import { describe, expect, it } from 'vitest';
import { AUTOSAVE_KEY, loadAutosave, saveAutosave, type StorageLike } from './persist';
import type { SystemDefinition } from './types';

const fakeStorage = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
};

const sys: SystemDefinition = {
  version: 1, name: 'autosaved', parts: [], connections: [], script: [], humidityRH: 40,
};

describe('autosave persistence', () => {
  it('roundtrips', () => {
    const s = fakeStorage();
    saveAutosave(sys, s);
    expect(loadAutosave(s)).toEqual(sys);
  });

  it('returns null when empty', () => {
    expect(loadAutosave(fakeStorage())).toBeNull();
  });

  it('rejects and clears corrupt payloads', () => {
    const s = fakeStorage();
    s.map.set(AUTOSAVE_KEY, '{not json');
    expect(loadAutosave(s)).toBeNull();
    expect(s.map.has(AUTOSAVE_KEY)).toBe(false);
  });

  it('rejects wrong-version payloads', () => {
    const s = fakeStorage();
    s.map.set(AUTOSAVE_KEY, JSON.stringify({ version: 99, parts: [] }));
    expect(loadAutosave(s)).toBeNull();
    s.map.set(AUTOSAVE_KEY, JSON.stringify({ version: 1, parts: 'nope' }));
    expect(loadAutosave(s)).toBeNull();
  });

  it('swallows setItem failures (private mode)', () => {
    const s: StorageLike = {
      getItem: () => null,
      setItem: () => { throw new Error('quota'); },
      removeItem: () => undefined,
    };
    expect(() => saveAutosave(sys, s)).not.toThrow();
  });
});
