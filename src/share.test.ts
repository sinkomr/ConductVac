import { describe, expect, it } from 'vitest';
import { decodeHash, encodeSystem } from './share';
import { EXAMPLES } from './examples';
import type { SystemDefinition } from './types';

const tiny: SystemDefinition = {
  version: 1, name: 'tiny', parts: [], connections: [], script: [], humidityRH: 50,
};

describe('share codec', () => {
  it('roundtrips a minimal system', async () => {
    const payload = await encodeSystem(tiny);
    expect(payload.startsWith('s=')).toBe(true);
    const back = await decodeHash(`#${payload}`);
    expect(back).toEqual(tiny);
  });

  it('roundtrips a real bundled example, hash-prefix optional', async () => {
    const ex = EXAMPLES.find((e) => e.id === 'ex5')!.system;
    const payload = await encodeSystem(ex);
    expect(await decodeHash(payload)).toEqual(ex);
    expect(await decodeHash(`#${payload}`)).toEqual(ex);
    // compression pulls its weight on real systems
    expect(payload.length).toBeLessThan(JSON.stringify(ex).length);
  });

  it('accepts the uncompressed sj= fallback', async () => {
    const b64 = btoa(JSON.stringify(tiny)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(await decodeHash(`#sj=${b64}`)).toEqual(tiny);
  });

  it('rejects garbage without throwing', async () => {
    expect(await decodeHash('')).toBeNull();
    expect(await decodeHash('#unrelated')).toBeNull();
    expect(await decodeHash('#s=!!!not-base64!!!')).toBeNull();
    const good = await encodeSystem(tiny);
    expect(await decodeHash(`#${good.slice(0, good.length - 8)}`)).toBeNull(); // truncated deflate
  });

  it('rejects wrong-version payloads', async () => {
    const bad = { ...tiny, version: 2 } as unknown as SystemDefinition;
    expect(await decodeHash(await encodeSystem(bad))).toBeNull();
    const noParts = { version: 1, name: 'x' } as unknown as SystemDefinition;
    expect(await decodeHash(await encodeSystem(noParts))).toBeNull();
  });
});
