// The WhatsApp object's own SQLite (class migration tag `v1-whatsapp`), migrated by version. All tables are
// `wa_*`. The login itself is not here in the clear: it is sealed envelopes in the `wa_kv` table (namespace "whatsapp").
import type { Migration } from "./sql.ts";

export const WA_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "whatsapp core",
    up(db) {
      db.run(`CREATE TABLE wa_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
      db.run(`CREATE TABLE wa_chats (
        jid TEXT PRIMARY KEY,
        name TEXT,
        is_group INTEGER NOT NULL DEFAULT 0,
        unread INTEGER NOT NULL DEFAULT 0,
        last_at INTEGER NOT NULL DEFAULT 0
      )`);
      db.run(`CREATE TABLE wa_contacts (jid TEXT PRIMARY KEY, name TEXT, notify TEXT)`);
      // One row per message: the sender's push name is kept with it, flagged as not trustworthy by its column name.
      db.run(`CREATE TABLE wa_messages (
        chat TEXT NOT NULL,
        id TEXT NOT NULL,
        sender TEXT NOT NULL,
        push_name TEXT,
        from_me INTEGER NOT NULL,
        at INTEGER NOT NULL,
        text TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT NOT NULL,
        PRIMARY KEY (chat, id)
      ) WITHOUT ROWID`);
      db.run(`CREATE INDEX wa_messages_chat_at ON wa_messages (chat, at)`);
      db.run(`CREATE INDEX wa_messages_at ON wa_messages (at)`);
      // A send is made once per approval: the key is the approval's, so a replayed approval finds its result.
      db.run(`CREATE TABLE wa_sent (key TEXT PRIMARY KEY, jid TEXT NOT NULL, id TEXT NOT NULL, at INTEGER NOT NULL)`);
    },
  },
  {
    // One person can be known under two ids: the phone-number jid and the hidden-number `@lid` jid. This table is what every source
    // told us about which `@lid` belongs to which number; the store keeps one chat per person under the phone form. Archived is
    // WhatsApp's own flag. Nothing here is destructive, and re-running it (the guards) changes nothing.
    version: 2,
    name: "lid mapping and archived chats",
    up(db) {
      db.run(`CREATE TABLE IF NOT EXISTS wa_lid_map (lid TEXT PRIMARY KEY, pn TEXT NOT NULL, at INTEGER NOT NULL, source TEXT NOT NULL) WITHOUT ROWID`);
      db.run(`CREATE INDEX IF NOT EXISTS wa_lid_map_pn ON wa_lid_map (pn)`);
      if (!db.columns("SELECT * FROM wa_chats LIMIT 0").includes("archived")) db.run(`ALTER TABLE wa_chats ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
      db.run(`CREATE INDEX IF NOT EXISTS wa_chats_last_at ON wa_chats (last_at)`);
    },
  },
  {
    // the id of the message a reply quotes, so a group reply can be tied to something the owner wrote. Nullable; old rows have none.
    version: 3,
    name: "quoted message id",
    up(db) {
      if (!db.columns("SELECT * FROM wa_messages LIMIT 0").includes("quoted_id")) db.run(`ALTER TABLE wa_messages ADD COLUMN quoted_id TEXT`);
    },
  },
  {
    // a hidden-number id can move to a new phone number (the person changed number). The mapping row holds the current
    // number; this table keeps each number it replaced, so messages stored under the old number still resolve to the person.
    version: 4,
    name: "lid mapping history",
    up(db) {
      db.run(`CREATE TABLE IF NOT EXISTS wa_lid_history (lid TEXT NOT NULL, pn TEXT NOT NULL, source TEXT NOT NULL, from_at INTEGER NOT NULL, until_at INTEGER NOT NULL, PRIMARY KEY (lid, pn)) WITHOUT ROWID`);
      db.run(`CREATE INDEX IF NOT EXISTS wa_lid_history_pn ON wa_lid_history (pn)`);
    },
  },
  {
    // a store sequence, the order the program stored a message in. A message WhatsApp delivers late keeps its send time, so
    // `(at, chat, id)` cannot say "everything new since I last looked"; the sequence can. Rows already stored get theirs in the
    // old `(at, chat, id)` order, and the counter (`wa_meta` key `seq`) never goes down when rows are pruned.
    version: 5,
    name: "message store sequence",
    up(db) {
      if (!db.columns("SELECT * FROM wa_messages LIMIT 0").includes("seq")) db.run(`ALTER TABLE wa_messages ADD COLUMN seq INTEGER`);
      const rows = db.all<{ chat: string; id: string }>(`SELECT chat, id FROM wa_messages WHERE seq IS NULL ORDER BY at, chat, id`);
      let n = Number(db.all<{ value: string }>(`SELECT value FROM wa_meta WHERE key = 'seq'`)[0]?.value ?? 0) || 0;
      n = Math.max(n, Number(db.all<{ m: number | null }>(`SELECT MAX(seq) AS m FROM wa_messages`)[0]?.m ?? 0) || 0);
      for (const r of rows) db.run(`UPDATE wa_messages SET seq = ? WHERE chat = ? AND id = ?`, ++n, r.chat, r.id);
      db.run(`INSERT INTO wa_meta (key, value) VALUES ('seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, String(n));
      db.run(`CREATE INDEX IF NOT EXISTS wa_messages_seq ON wa_messages (seq)`);
    },
  },
  {
    // who is in a group, and who a message tags. `wa_group_info` says the member list of a group was fetched (a group with no row
    // has never been described, which is different from a group with no members listed); `wa_group_members` is the list, one row
    // per member under the phone form of the id when it is known. `mentions` is a JSON list of the jids a message tags.
    version: 6,
    name: "group members and mentions",
    up(db) {
      db.run(`CREATE TABLE IF NOT EXISTS wa_group_info (jid TEXT PRIMARY KEY, fetched_at INTEGER NOT NULL) WITHOUT ROWID`);
      db.run(`CREATE TABLE IF NOT EXISTS wa_group_members (grp TEXT NOT NULL, member TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL, PRIMARY KEY (grp, member)) WITHOUT ROWID`);
      db.run(`CREATE INDEX IF NOT EXISTS wa_group_members_member ON wa_group_members (member)`);
      if (!db.columns("SELECT * FROM wa_messages LIMIT 0").includes("mentions")) db.run(`ALTER TABLE wa_messages ADD COLUMN mentions TEXT`);
    },
  },
  {
    version: 7,
    name: "voice note media metadata (no audio)",
    up(db) {
      db.run(`ALTER TABLE wa_messages ADD COLUMN voice TEXT`);
    },
  },
];

export const WA_EXPECTED_COLUMNS: Record<string, string[]> = {
  wa_meta: ["key", "value"],
  wa_chats: ["jid", "name", "is_group", "unread", "last_at", "archived"],
  wa_lid_map: ["lid", "pn", "at", "source"],
  wa_lid_history: ["lid", "pn", "source", "from_at", "until_at"],
  wa_contacts: ["jid", "name", "notify"],
  wa_messages: ["chat", "id", "sender", "push_name", "from_me", "at", "text", "kind", "source", "quoted_id", "seq", "mentions", "voice"],
  wa_group_info: ["jid", "fetched_at"],
  wa_group_members: ["grp", "member", "admin", "at"],
  wa_sent: ["key", "jid", "id", "at"],
};
