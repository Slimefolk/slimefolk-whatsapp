// SQLite and the sealed login for the WhatsApp object. Small and local on purpose: this program is standalone and shares no
// code with its caller beyond the published contract (contract/).
import { EnvelopeStore, Keyring, getText, type EncryptedStore, type KeyValueBackend } from "./seal.ts";
import type { AuthKv } from "./adapter.ts";

export type SqlValue = string | number | null | ArrayBuffer;

export interface SqlDb {
  run(sql: string, ...bindings: SqlValue[]): void;
  all<T = Record<string, SqlValue>>(sql: string, ...bindings: SqlValue[]): T[];
  columns(sql: string): string[];
  tx<T>(fn: () => T): T;
}

export class Db implements SqlDb {
  constructor(private readonly storage: DurableObjectStorage) {}
  run(sql: string, ...bindings: SqlValue[]): void {
    this.storage.sql.exec(sql, ...bindings);
  }
  all<T = Record<string, SqlValue>>(sql: string, ...bindings: SqlValue[]): T[] {
    return this.storage.sql.exec(sql, ...bindings).toArray() as T[];
  }
  one<T = Record<string, SqlValue>>(sql: string, ...bindings: SqlValue[]): T | undefined {
    return this.all<T>(sql, ...bindings)[0];
  }
  columns(sql: string): string[] {
    return this.storage.sql.exec(sql).columnNames;
  }
  tx<T>(fn: () => T): T {
    return this.storage.transactionSync(fn);
  }
}

export interface Migration {
  version: number;
  name: string;
  up(db: SqlDb): void;
}

/** Runs the migrations not yet applied, all in one transaction (a failure leaves the previous schema as it was). */
export function runMigrations(db: SqlDb, migrations: readonly Migration[]): number[] {
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  return db.tx(() => {
    db.run(`CREATE TABLE IF NOT EXISTS wa_schema (version INTEGER PRIMARY KEY, name TEXT NOT NULL, at INTEGER NOT NULL)`);
    const done = new Set(db.all<{ version: number }>("SELECT version FROM wa_schema").map((r) => r.version));
    const applied: number[] = [];
    for (const m of ordered) {
      if (done.has(m.version)) continue;
      try {
        m.up(db);
      } catch (error) {
        throw new Error(`whatsapp migration ${m.version} failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }
      db.run("INSERT INTO wa_schema (version, name, at) VALUES (?, ?, ?)", m.version, m.name, Date.now());
      applied.push(m.version);
    }
    return applied;
  });
}

/** Throws if a table is missing, unreadable or lacks an expected column. */
export function verifySchema(db: SqlDb, expected: Record<string, string[]>): void {
  for (const [table, wanted] of Object.entries(expected)) {
    const have = db.columns(`SELECT * FROM ${table} LIMIT 0`);
    const missing = wanted.filter((c) => !have.includes(c));
    if (missing.length > 0) throw new Error(`table ${table} is missing columns: ${missing.join(", ")}`);
    db.all(`SELECT count(*) AS n FROM ${table}`);
  }
}

export class NotConfigured extends Error {
  override name = "NotConfigured";
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** The raw string slots under the envelope store: one table, `wa_kv`. */
export function sqlBackend(db: Db): KeyValueBackend {
  db.run("CREATE TABLE IF NOT EXISTS wa_kv (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID");
  return {
    get: async (k) => db.one<{ v: string }>("SELECT v FROM wa_kv WHERE k = ?", k)?.v,
    put: async (k, v) => db.run("INSERT INTO wa_kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v),
    delete: async (k) => {
      const had = db.one("SELECT 1 AS x FROM wa_kv WHERE k = ?", k) !== undefined;
      if (had) db.run("DELETE FROM wa_kv WHERE k = ?", k);
      return had;
    },
    list: async (prefix) => db.all<{ k: string }>("SELECT k FROM wa_kv WHERE substr(k, 1, length(?)) = ? ORDER BY k", prefix, prefix).map((r) => r.k),
  };
}

/** The envelope store under the key-encryption key (a Worker secret). Read when first needed, so a deployment without the key starts and fails clearly. */
export function lazyEncryptedStore(db: Db, env: unknown, backend: KeyValueBackend = sqlBackend(db)): { store: EncryptedStore; configured: boolean; envelope(): Promise<EnvelopeStore> } {
  const e = env as Record<string, unknown>;
  const kek = str(e.KEY_ENCRYPTION_KEY);
  const previous = (str(e.KEY_ENCRYPTION_KEY_PREVIOUS) ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let inner: Promise<EnvelopeStore> | undefined;
  const envelope = (): Promise<EnvelopeStore> => {
    if (!kek) return Promise.reject(new NotConfigured("This deployment has no KEY_ENCRYPTION_KEY, so it cannot keep the WhatsApp login. Add it to the WhatsApp worker's secrets and redeploy."));
    return (inner ??= Keyring.from(kek, previous).then((ring) => new EnvelopeStore(backend, ring)));
  };
  const store: EncryptedStore = {
    get: async (ns, key) => (await envelope()).get(ns, key),
    put: async (ns, key, value) => (await envelope()).put(ns, key, value),
    delete: async (ns, key) => (await envelope()).delete(ns, key),
    list: async (ns, opts) => (await envelope()).list(ns, opts),
  };
  return { store, configured: kek !== undefined, envelope };
}

const NS = "whatsapp";

/** The login in the sealed store: every key an envelope under the key-encryption key. */
export function sealedAuth(store: EncryptedStore): AuthKv {
  return {
    get: (key) => getText(store, NS, key),
    put: (key, value) => store.put(NS, key, value),
    delete: async (key) => void (await store.delete(NS, key)),
    list: (prefix) => store.list(NS, prefix ? { prefix } : undefined),
  };
}
