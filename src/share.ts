import type { SystemDefinition } from './types';

/**
 * Shareable-link codec: the whole SystemDefinition rides in the URL hash as
 * `#s=<base64url(deflate-raw(JSON))>`, so any build can be shared as a plain
 * link with no server. `#sj=<base64url(JSON)>` is the uncompressed fallback
 * for encoders without CompressionStream; the decoder always accepts both.
 */

const b64url = (bytes: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const fromB64url = (s: string): Uint8Array<ArrayBuffer> => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

interface ByteStream {
  writable: WritableStream<BufferSource>;
  readable: ReadableStream<Uint8Array>;
}

async function pipeThrough(bytes: Uint8Array<ArrayBuffer>, stream: ByteStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // the read side surfaces stream errors; these floating promises reject
  // too (e.g. truncated deflate) and must not become unhandled rejections
  writer.write(bytes).catch(() => undefined);
  writer.close().catch(() => undefined);
  const chunks: Uint8Array[] = [];
  const reader = stream.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** hash payload (no leading '#') for the given system */
export async function encodeSystem(sys: SystemDefinition): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(sys));
  if (typeof CompressionStream === 'undefined') return `sj=${b64url(json)}`;
  const packed = await pipeThrough(json, new CompressionStream('deflate-raw'));
  return `s=${b64url(packed)}`;
}

const looksLikeSystem = (sys: unknown): sys is SystemDefinition =>
  !!sys && typeof sys === 'object' &&
  (sys as SystemDefinition).version === 1 && Array.isArray((sys as SystemDefinition).parts);

/** decode a location.hash (with or without '#'); null on anything invalid */
export async function decodeHash(hash: string): Promise<SystemDefinition | null> {
  try {
    const h = hash.startsWith('#') ? hash.slice(1) : hash;
    let bytes: Uint8Array;
    if (h.startsWith('s=')) {
      bytes = await pipeThrough(fromB64url(h.slice(2)), new DecompressionStream('deflate-raw'));
    } else if (h.startsWith('sj=')) {
      bytes = fromB64url(h.slice(3));
    } else {
      return null;
    }
    const sys = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return looksLikeSystem(sys) ? sys : null;
  } catch {
    return null;
  }
}
