// Encryption at rest for the WhatsApp login: envelope encryption with WebCrypto. Copied (trimmed) from the legacy secrets library
// so this program has no outside dependency for it.
//
//   KEK   a 32-byte key held outside storage (the KEY_ENCRYPTION_KEY Worker secret). The wrapping key is HKDF-SHA256(KEK), so the
//         raw secret is never used as a cipher key.
//   DEK   a fresh random AES-256-GCM key per stored value. The value is encrypted under the DEK; the DEK is wrapped under the KEK.
//         Rotating the KEK re-wraps 32 bytes per value and never re-encrypts the data.
//   AAD   "slimefolk-envelope-v1|<namespace>|<key>" on both layers, so a ciphertext copied to another slot does not open.
//   kid   first 8 bytes of SHA-256 over the KEK, so we know which KEK wrapped a value without trying them all.

// ----- base64url and bytes ------------------------------------------------------------------------------------------

export function toBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const std = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(std + "=".repeat((4 - (std.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const utf8 = (s: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(s) as Uint8Array<ArrayBuffer>;

export function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

// ----- envelopes ------------------------------------------------------------------------------------------------------

export interface Envelope {
  v: 1;
  kid: string;
  /** Wrapped DEK (iv is `wiv`). */
  wdek: string;
  wiv: string;
  /** Ciphertext of the value (iv is `iv`). */
  iv: string;
  ct: string;
}

export class KeyringError extends Error {
  override name = "KeyringError";
}
export class DecryptError extends Error {
  override name = "DecryptError";
  constructor(
    message: string,
    readonly reason: "unknown_kek" | "tampered_or_wrong_slot" | "bad_envelope",
  ) {
    super(message);
  }
}

interface KekEntry {
  kid: string;
  key: CryptoKey;
}

const aad = (namespace: string, key: string) => utf8(`slimefolk-envelope-v1|${namespace}|${key}`);

async function deriveWrappingKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: utf8("slimefolk/kek/v1") }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function kidOf(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", concat(utf8("slimefolk-kek-id"), raw)));
  return toHex(d.subarray(0, 8));
}

/** The current KEK plus any older ones still needed to open existing values (during and after a rotation). */
export class Keyring {
  private constructor(
    readonly current: KekEntry,
    private readonly previous: KekEntry[],
  ) {}

  /** `kek` is base64url of 32 random bytes (what `generateRootSecrets().keyEncryptionKey` produces). */
  static async from(kek: string, previous: string[] = []): Promise<Keyring> {
    const entry = async (s: string): Promise<KekEntry> => {
      const raw = fromBase64Url(s);
      if (raw.length !== 32) throw new KeyringError("The key-encryption key must be 32 bytes");
      return { kid: await kidOf(raw), key: await deriveWrappingKey(raw) };
    };
    return new Keyring(await entry(kek), await Promise.all(previous.map(entry)));
  }

  static generate(): string {
    return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  }

  get kid(): string {
    return this.current.kid;
  }

  /** The wrapping key for a kid, if this keyring holds it. */
  find(kid: string): CryptoKey | null {
    if (this.current.kid === kid) return this.current.key;
    return this.previous.find((p) => p.kid === kid)?.key ?? null;
  }

  has(kid: string): boolean {
    return this.find(kid) !== null;
  }
}

export async function seal(ring: Keyring, namespace: string, key: string, plaintext: Uint8Array<ArrayBuffer>): Promise<Envelope> {
  const ad = aad(namespace, key);
  const dek = (await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"])) as CryptoKey;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: ad }, dek, plaintext));
  const wiv = crypto.getRandomValues(new Uint8Array(12));
  const rawDek = new Uint8Array((await crypto.subtle.exportKey("raw", dek)) as ArrayBuffer);
  const wdek = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: wiv, additionalData: ad }, ring.current.key, rawDek));
  rawDek.fill(0);
  return { v: 1, kid: ring.kid, wdek: toBase64Url(wdek), wiv: toBase64Url(wiv), iv: toBase64Url(iv), ct: toBase64Url(ct) };
}

async function unwrapDek(ring: Keyring, env: Envelope, ad: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const kek = ring.find(env.kid);
  if (!kek) throw new DecryptError(`No key-encryption key ${env.kid} in the keyring`, "unknown_kek");
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(env.wiv), additionalData: ad }, kek, fromBase64Url(env.wdek)));
  } catch {
    throw new DecryptError("The stored value could not be unlocked (wrong key, tampered, or copied from another slot)", "tampered_or_wrong_slot");
  }
}

export async function open(ring: Keyring, namespace: string, key: string, env: Envelope): Promise<Uint8Array> {
  if (!env || env.v !== 1 || !env.ct || !env.wdek) throw new DecryptError("Not a v1 envelope", "bad_envelope");
  const ad = aad(namespace, key);
  const rawDek = await unwrapDek(ring, env, ad);
  try {
    const dek = await crypto.subtle.importKey("raw", rawDek, "AES-GCM", false, ["decrypt"]);
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64Url(env.iv), additionalData: ad }, dek, fromBase64Url(env.ct)));
  } catch {
    throw new DecryptError("The stored value could not be decrypted (tampered)", "tampered_or_wrong_slot");
  } finally {
    rawDek.fill(0);
  }
}

/** Re-wrap the DEK under the current KEK. The data ciphertext is untouched. Returns the same envelope if already current. */
export async function rewrap(ring: Keyring, namespace: string, key: string, env: Envelope): Promise<Envelope> {
  if (env.kid === ring.kid) return env;
  const ad = aad(namespace, key);
  const rawDek = await unwrapDek(ring, env, ad);
  const wiv = crypto.getRandomValues(new Uint8Array(12));
  const wdek = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: wiv, additionalData: ad }, ring.current.key, rawDek));
  rawDek.fill(0);
  return { ...env, kid: ring.kid, wdek: toBase64Url(wdek), wiv: toBase64Url(wiv) };
}

// ----- the encrypted store --------------------------------------------------------------------------------------------

/**
 * Namespaces are short lowercase names owned by one component. Keys are arbitrary non-empty strings. `get` of a missing key is
 * `null`, `delete` of a missing key is `false`; neither throws. A value that fails to decrypt (wrong key, tampering, copied slot)
 * throws `DecryptError`: it is never returned as absent.
 */
export interface EncryptedStore {
  get(namespace: string, key: string): Promise<Uint8Array | null>;
  put(namespace: string, key: string, value: Uint8Array | string): Promise<void>;
  delete(namespace: string, key: string): Promise<boolean>;
  /** Keys in a namespace (not values), sorted, optionally by prefix. */
  list(namespace: string, opts?: { prefix?: string }): Promise<string[]>;
}

export async function getText(store: EncryptedStore, ns: string, key: string): Promise<string | null> {
  const b = await store.get(ns, key);
  return b ? new TextDecoder().decode(b) : null;
}

/** Raw string key-value storage underneath (the Durable Object's SQLite, see sql.ts). */
export interface KeyValueBackend {
  get(key: string): Promise<string | undefined>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<boolean>;
  /** All keys that start with `prefix`, sorted. */
  list(prefix: string): Promise<string[]>;
}

const NS = /^[a-z][a-z0-9_.-]{0,31}$/;
function checkNs(ns: string) {
  if (!NS.test(ns)) throw new Error(`Invalid namespace "${ns}": use 1-32 lowercase letters, digits, "_", "." or "-"`);
}
function checkKey(key: string) {
  if (!key || key.length > 512) throw new Error("Invalid key: 1-512 characters");
}
const slot = (ns: string, key: string) => `enc/${ns}/${encodeURIComponent(key)}`;

export class EnvelopeStore implements EncryptedStore {
  constructor(
    private readonly backend: KeyValueBackend,
    private readonly ring: Keyring,
  ) {}

  async get(namespace: string, key: string): Promise<Uint8Array | null> {
    checkNs(namespace);
    checkKey(key);
    const raw = await this.backend.get(slot(namespace, key));
    if (raw === undefined) return null;
    return open(this.ring, namespace, key, JSON.parse(raw) as Envelope);
  }

  async put(namespace: string, key: string, value: Uint8Array | string): Promise<void> {
    checkNs(namespace);
    checkKey(key);
    const env = await seal(this.ring, namespace, key, typeof value === "string" ? utf8(value) : (value as Uint8Array<ArrayBuffer>));
    await this.backend.put(slot(namespace, key), JSON.stringify(env));
  }

  delete(namespace: string, key: string): Promise<boolean> {
    checkNs(namespace);
    checkKey(key);
    return this.backend.delete(slot(namespace, key));
  }

  async list(namespace: string, opts: { prefix?: string } = {}): Promise<string[]> {
    checkNs(namespace);
    const base = `enc/${namespace}/`;
    const keys = (await this.backend.list(base)).map((k) => decodeURIComponent(k.slice(base.length)));
    return keys.filter((k) => !opts.prefix || k.startsWith(opts.prefix)).sort();
  }

  /**
   * Move every value to the current KEK by re-wrapping its data key. Safe to run repeatedly and to resume after a
   * crash (each value is rewritten independently). Returns how many were already current / re-wrapped / failed.
   */
  async rewrapAll(): Promise<{ current: number; rewrapped: number; failed: Array<{ namespace: string; key: string; reason: string }> }> {
    const out = { current: 0, rewrapped: 0, failed: [] as Array<{ namespace: string; key: string; reason: string }> };
    for (const full of await this.backend.list("enc/")) {
      const [, namespace, encKey] = full.split("/") as [string, string, string];
      const key = decodeURIComponent(encKey);
      try {
        const env = JSON.parse((await this.backend.get(full))!) as Envelope;
        const next = await rewrap(this.ring, namespace, key, env);
        if (next === env) out.current++;
        else {
          await this.backend.put(full, JSON.stringify(next));
          out.rewrapped++;
        }
      } catch (e) {
        out.failed.push({ namespace, key, reason: (e as Error).message });
      }
    }
    return out;
  }

  /** Whether any stored value is still wrapped by a KEK other than the current one (so the old key must be kept). */
  async staleCount(): Promise<number> {
    let n = 0;
    for (const full of await this.backend.list("enc/")) {
      const env = JSON.parse((await this.backend.get(full))!) as Envelope;
      if (env.kid !== this.ring.kid) n++;
    }
    return n;
  }
}

