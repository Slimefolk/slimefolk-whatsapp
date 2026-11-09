// workerd's WebCrypto refuses PBKDF2 above 100,000 iterations, and Baileys derives the pairing-code key with PBKDF2-SHA-256 at
// 2 << 16 = 131,072 (Utils/crypto.js, derivePairingCodeKey), so pairing by code fails with "Pbkdf2 failed". This wraps the shared
// SubtleCrypto: raw PBKDF2 key material is remembered at import, and a PBKDF2-SHA-256 derivation above the limit is computed here
// in plain JavaScript. Everything else goes to workerd unchanged. Install once, before Baileys runs.
const WORKERD_MAX_ITERATIONS = 100_000;

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const IV = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

/** One SHA-256 compression of the 16-word block `w` (w[16..63] are scratch) into `h`. */
function compress(h: Uint32Array, w: Uint32Array): void {
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15]!, b = w[i - 2]!;
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) | 0;
  }
  let a = h[0]!, b = h[1]!, c = h[2]!, d = h[3]!, e = h[4]!, f = h[5]!, g = h[6]!, k = h[7]!;
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    k = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  h[0] = (h[0]! + a) | 0; h[1] = (h[1]! + b) | 0; h[2] = (h[2]! + c) | 0; h[3] = (h[3]! + d) | 0;
  h[4] = (h[4]! + e) | 0; h[5] = (h[5]! + f) | 0; h[6] = (h[6]! + g) | 0; h[7] = (h[7]! + k) | 0;
}

function sha256(data: Uint8Array): Uint8Array {
  const len = data.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(data);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(len / 2 ** 29));
  view.setUint32(padded.length - 4, (len << 3) >>> 0);
  const h = new Uint32Array(IV), w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    compress(h, w);
  }
  return words(h);
}

function words(h: Uint32Array): Uint8Array {
  const out = new Uint8Array(32), v = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) v.setUint32(i * 4, h[i]!);
  return out;
}

/** The SHA-256 state after one block of key XOR pad: the fixed first half of every HMAC with this key. */
function padState(key: Uint8Array, pad: number): Uint32Array {
  const block = new Uint8Array(64);
  block.set(key);
  const h = new Uint32Array(IV), w = new Uint32Array(64), v = new DataView(block.buffer);
  for (let i = 0; i < 64; i++) block[i]! ^= pad;
  for (let i = 0; i < 16; i++) w[i] = v.getUint32(i * 4);
  compress(h, w);
  return h;
}

/** PBKDF2-HMAC-SHA-256. */
export function pbkdf2Sha256(password: Uint8Array, salt: Uint8Array, iterations: number, length: number): Uint8Array {
  const key = password.length > 64 ? sha256(password) : password;
  const inner = padState(key, 0x36), outer = padState(key, 0x5c);
  // HMAC of 32 bytes after a precomputed pad block: one more block each for the inner and the outer hash.
  const w = new Uint32Array(64), h = new Uint32Array(8);
  const hmac32 = (u: Uint32Array): void => {
    h.set(inner);
    w.set(u); w[8] = 0x80000000; w.fill(0, 9, 15); w[15] = (64 + 32) * 8;
    compress(h, w);
    const ih = h.slice();
    h.set(outer);
    w.set(ih); w[8] = 0x80000000; w.fill(0, 9, 15); w[15] = (64 + 32) * 8;
    compress(h, w);
    u.set(h);
  };
  const out = new Uint8Array(length);
  for (let block = 1, off = 0; off < length; block++, off += 32) {
    // U1 = HMAC(P, S || INT(block)), the salt can be any length, so this one is computed in full.
    const msg = new Uint8Array(salt.length + 4);
    msg.set(salt);
    new DataView(msg.buffer).setUint32(salt.length, block);
    const outerKeyBlock = new Uint8Array(64 + 32);
    const innerMsg = new Uint8Array(64 + msg.length);
    for (let i = 0; i < 64; i++) innerMsg[i] = (key[i] ?? 0) ^ 0x36;
    innerMsg.set(msg, 64);
    for (let i = 0; i < 64; i++) outerKeyBlock[i] = (key[i] ?? 0) ^ 0x5c;
    outerKeyBlock.set(sha256(innerMsg), 64);
    const u1 = sha256(outerKeyBlock);
    const uv = new DataView(u1.buffer);
    const u = new Uint32Array(8), t = new Uint32Array(8);
    for (let i = 0; i < 8; i++) t[i] = u[i] = uv.getUint32(i * 4);
    for (let n = 1; n < iterations; n++) {
      hmac32(u);
      for (let i = 0; i < 8; i++) t[i]! ^= u[i]!;
    }
    out.set(words(t).subarray(0, Math.min(32, length - off)), off);
  }
  return out;
}

const bytes = (d: BufferSource): Uint8Array => (d instanceof ArrayBuffer ? new Uint8Array(d) : new Uint8Array(d.buffer, d.byteOffset, d.byteLength));
const algName = (a: unknown): string => String(typeof a === "string" ? a : (a as { name?: string } | null)?.name ?? "").toUpperCase();
const hashName = (h: unknown): string => algName(h).replace("SHA256", "SHA-256");

let installed = false;
export function installWorkerdPbkdf2Fix(subtle: SubtleCrypto = globalThis.crypto.subtle): void {
  if (installed) return;
  installed = true;
  const material = new WeakMap<CryptoKey, Uint8Array>();
  const importKey = subtle.importKey.bind(subtle) as (...a: unknown[]) => Promise<CryptoKey>;
  const deriveBits = subtle.deriveBits.bind(subtle);
  Object.defineProperty(subtle, "importKey", {
    configurable: true,
    writable: true,
    value: async (format: string, keyData: unknown, algorithm: unknown, ...rest: unknown[]): Promise<CryptoKey> => {
      const key = await importKey(format, keyData, algorithm, ...rest);
      if (format === "raw" && algName(algorithm) === "PBKDF2") material.set(key, bytes(keyData as BufferSource).slice());
      return key;
    },
  });
  Object.defineProperty(subtle, "deriveBits", {
    configurable: true,
    writable: true,
    value: async (algorithm: Pbkdf2Params | AlgorithmIdentifier, baseKey: CryptoKey, length?: number | null): Promise<ArrayBuffer> => {
      const a = algorithm as Pbkdf2Params;
      const password = material.get(baseKey);
      if (algName(a) === "PBKDF2" && a.iterations > WORKERD_MAX_ITERATIONS && password && hashName(a.hash) === "SHA-256" && length && length % 8 === 0) {
        return pbkdf2Sha256(password, bytes(a.salt), a.iterations, length / 8).buffer as ArrayBuffer;
      }
      return deriveBits(algorithm, baseKey, length);
    },
  });
}
