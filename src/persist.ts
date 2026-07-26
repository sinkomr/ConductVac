import type { SystemDefinition } from './types';

/**
 * localStorage autosave (pure half — the store subscription lives in
 * main.tsx so this module stays node-testable). All storage access is
 * fail-soft: private-mode quota errors and corrupt payloads never break
 * the app.
 */

export const AUTOSAVE_KEY = 'conductvac.autosave.v1';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function saveAutosave(sys: SystemDefinition, storage: StorageLike): void {
  try {
    storage.setItem(AUTOSAVE_KEY, JSON.stringify(sys));
  } catch {
    /* quota / private mode — drop it */
  }
}

export function loadAutosave(storage: StorageLike): SystemDefinition | null {
  try {
    const raw = storage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const sys = JSON.parse(raw) as SystemDefinition;
    if (sys.version !== 1 || !Array.isArray(sys.parts)) throw new Error('bad autosave');
    return sys;
  } catch {
    try {
      storage.removeItem(AUTOSAVE_KEY);
    } catch { /* ignore */ }
    return null;
  }
}
