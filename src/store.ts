// What the WhatsApp object remembers of the person's chats: chats, saved contacts, messages. Plain SQL over the object's own
// SQLite (the login is sealed separately). Names are resolved here, in one place, so a name the sender gave themselves is
// never mistaken for one the person saved.
import type { WaHistoryKey, WaHistoryMessage, WhatsAppChatPage, WhatsAppChatQuery, WhatsAppChatView, WhatsAppMember, WhatsAppMessageView } from "../contract/index.ts";
import type { WaChat, WaContact, WaGroup, WaGroupChange, WaLidPair, WaMessage } from "./adapter.ts";

/** The part of the SQLite object (or any SQLite) the store needs. */
export interface WaDb {
  run(sql: string, ...bindings: Array<string | number | null | ArrayBuffer>): void;
  all<T = Record<string, unknown>>(sql: string, ...bindings: Array<string | number | null | ArrayBuffer>): T[];
  one<T = Record<string, unknown>>(sql: string, ...bindings: Array<string | number | null | ArrayBuffer>): T | undefined;
  tx<T>(fn: () => T): T;
}

/** Messages older than this are dropped at the end of a check; so are the oldest beyond MAX_MESSAGES. */
export const RETAIN_MS = 90 * 86_400_000;
export const MAX_MESSAGES = 50_000;
const MAX_TEXT = 8_000;
/** At most this many members of a group are stored, and this many tags of one message. */
const MAX_MEMBERS = 1_100;
const MAX_MENTIONS = 50;
/** At most this many members of a group go out in one chat view. */
export const MEMBERS_SHOWN = 256;
/** The `source` of messages fetched from the phone on request: kept past RETAIN_MS. */
export const ONDEMAND_SOURCE = "ondemand";

export const isGroup = (jid: string): boolean => jid.endsWith("@g.us");
/** The digits of a person's jid (`15550100:3@s.whatsapp.net` → `15550100`); empty for a group, a broadcast or a hidden-number id. */
export function numberOf(jid: string): string {
  const m = /^(\d{5,16})(?::\d+)?@s\.whatsapp\.net$/.exec(jid);
  return m ? m[1]! : "";
}
/** The jid for a phone number. */
export const jidOf = (digits: string): string => `${digits}@s.whatsapp.net`;
/** A jid without its device part. */
export const bareJid = (jid: string): string => jid.replace(/:\d+@/, "@");
/** A hidden-number id (`@lid`): what WhatsApp uses for a person whose number it does not show. */
export const isLid = (jid: string): boolean => /^\d{5,40}@lid$/.test(jid);
/** A phone-number id of a person. The canonical form of a chat when both forms are known. */
export const isPnJid = (jid: string): boolean => /^\d{5,16}@s\.whatsapp\.net$/.test(jid);
/**
 * How far a mapping's source can be trusted. WhatsApp's own word outranks what was inferred from a contact, a chat row or a
 * message's alternate id. A live `lid-mapping.update` and the client's own lookup are the newest word; a history sync is a snapshot.
 */
export function lidSourceRank(source: string): number {
  if (source === "event" || source === "lookup") return 3;
  if (source === "history") return 2;
  return 1;
}
const marks = (n: number): string => Array.from({ length: n }, () => "?").join(",");

/** A page cursor: `<last_at>:<jid>` of the last chat of the page before. */
export function parseChatCursor(v: string): { at: number; jid: string } | undefined {
  const m = /^(\d{1,15}):([A-Za-z0-9.@-]{1,80})$/.exec(v.trim());
  return m ? { at: Number(m[1]), jid: m[2]! } : undefined;
}
const cursorOf = (c: { lastAt: number; jid: string }): string => `${c.lastAt}:${c.jid}`;

/** Both ids of one person, if the two jids are a phone id and a hidden-number id. */
function pairOf(a: string | undefined, b: string | undefined): WaLidPair | undefined {
  if (!a || !b) return undefined;
  const x = bareJid(a);
  const y = bareJid(b);
  if (isLid(x) && isPnJid(y)) return { lid: x, pn: y };
  if (isLid(y) && isPnJid(x)) return { lid: y, pn: x };
  return undefined;
}

interface ChatRow {
  jid: string;
  name: string | null;
  is_group: number;
  unread: number;
  last_at: number;
  archived: number;
}
interface MsgRow {
  chat: string;
  id: string;
  sender: string;
  push_name: string | null;
  from_me: number;
  at: number;
  text: string;
  kind: string;
  quoted_id?: string | null;
  seq?: number | null;
  mentions?: string | null;
}

const LIKE_ESCAPE = /[\\%_]/g;

export class WaStore {
  constructor(private readonly db: WaDb) {}

  // ----- names ------------------------------------------------------------------------------------------------------

  /** A name the person can recognise: their own saved name, else the chat's name, else the number. A push name is marked "~". */
  displayName(jid: string): string {
    const fs = this.forms(jid);
    const contacts = this.db.all<{ name: string | null; notify: string | null }>(`SELECT name, notify FROM wa_contacts WHERE jid IN (${marks(fs.length)})`, ...fs);
    const saved = contacts.find((c) => c.name)?.name;
    if (saved) return saved;
    const chatName = this.db.all<{ name: string | null }>(`SELECT name FROM wa_chats WHERE jid IN (${marks(fs.length)})`, ...fs).find((c) => c.name)?.name;
    if (chatName) return chatName;
    const notify = contacts.find((c) => c.notify)?.notify;
    if (notify) return `~${notify}`;
    const canon = fs[0]!;
    const n = numberOf(canon);
    return n ? `+${n}` : canon.split("@")[0] || canon;
  }

  /** The name the person saved for this jid, if any. The only name that counts for matching a VIP or a sender filter. */
  savedName(jid: string): string | undefined {
    const fs = this.forms(jid);
    return this.db.all<{ name: string | null }>(`SELECT name FROM wa_contacts WHERE jid IN (${marks(fs.length)})`, ...fs).find((c) => c.name)?.name ?? undefined;
  }

  // ----- one person, two ids ------------------------------------------------------------------------------------------

  /** The one id a chat is kept under: the phone form when a mapping is known, else the id as given (device part removed). */
  canon(jid: string): string {
    const b = bareJid(jid);
    if (!isLid(b)) return b;
    return this.db.one<{ pn: string }>("SELECT pn FROM wa_lid_map WHERE lid = ?", b)?.pn ?? b;
  }

  /** Every id a person's data may sit under: the canonical id first, then the hidden-number ids mapped to it. */
  forms(jid: string): string[] {
    const c = this.canon(jid);
    if (!isPnJid(c)) return [c];
    // A number the person used to have leads to their current one; the current one leads back to the old numbers.
    const bases = [c];
    for (const r of this.db.all<{ pn: string }>("SELECT m.pn AS pn FROM wa_lid_history h JOIN wa_lid_map m ON m.lid = h.lid WHERE h.pn = ? LIMIT 10", c)) if (!bases.includes(r.pn)) bases.push(r.pn);
    const out = [...bases];
    for (const base of bases) {
      for (const r of this.db.all<{ lid: string }>("SELECT lid FROM wa_lid_map WHERE pn = ? ORDER BY lid LIMIT 80", base)) {
        if (!out.includes(r.lid)) out.push(r.lid);
        for (const o of this.db.all<{ pn: string }>("SELECT pn FROM wa_lid_history WHERE lid = ? ORDER BY until_at LIMIT 20", r.lid)) if (!out.includes(o.pn)) out.push(o.pn);
      }
    }
    return out.slice(0, 120);
  }

  /**
   * Records which phone number a hidden-number id belongs to, and merges the two chats if both exist. Idempotent. Sources are
   * ranked (`lidSourceRank`): a different number replaces the known one only when it comes from a higher source, or from the same
   * WhatsApp-given source later (the person changed number). The number it replaced is kept in `wa_lid_history`, so messages
   * stored under it still resolve. A weaker or equal inferred source never overrides anything.
   */
  learnLids(pairs: WaLidPair[], source: string): { learned: number; merged: number; conflicts: number } {
    return this.db.tx(() => this.learnPairs(pairs, source));
  }

  private ownPn(): string | undefined {
    const n = this.db.one<{ value: string }>("SELECT value FROM wa_meta WHERE key = 'number'")?.value;
    return n ? `${n}@s.whatsapp.net` : undefined;
  }

  private learnPairs(pairs: WaLidPair[], source: string): { learned: number; merged: number; conflicts: number } {
    const out = { learned: 0, merged: 0, conflicts: 0 };
    const seen = new Set<string>();
    for (const p of pairs) {
      const lid = bareJid(p.lid);
      const pn = bareJid(p.pn);
      if (!isLid(lid) || !isPnJid(pn) || seen.has(lid)) continue;
      seen.add(lid);
      // The person's own ids only ever pair with each other. A pair with one of them and a stranger is a mix-up, not a mapping.
      const ownPn = this.ownPn();
      const ownLid = this.db.one<{ value: string }>("SELECT value FROM wa_meta WHERE key = 'lid'")?.value;
      const pnIsOwn = !!ownPn && pn === ownPn;
      const lidIsOwn = !!ownLid && lid === ownLid;
      if (pnIsOwn !== lidIsOwn) {
        out.conflicts++;
        continue;
      }
      const have = this.db.one<{ pn: string; at: number; source: string }>("SELECT pn, at, source FROM wa_lid_map WHERE lid = ?", lid);
      const rank = lidSourceRank(source);
      const haveRank = have ? lidSourceRank(have.source) : 0;
      if (have && have.pn !== pn) {
        if (rank < haveRank || (rank === haveRank && rank < 2)) {
          out.conflicts++;
          continue;
        }
        // Newer or stronger word from WhatsApp: the old number is remembered, the new one takes over.
        const now = Date.now();
        this.db.run("INSERT OR REPLACE INTO wa_lid_history (lid, pn, source, from_at, until_at) VALUES (?, ?, ?, ?, ?)", lid, have.pn, have.source, have.at, now);
        this.db.run("DELETE FROM wa_lid_history WHERE lid = ? AND pn = ?", lid, pn);
        this.db.run("UPDATE wa_lid_map SET pn = ?, at = ?, source = ? WHERE lid = ?", pn, now, source.slice(0, 40), lid);
        out.learned++;
      } else if (have && rank > haveRank) {
        this.db.run("UPDATE wa_lid_map SET source = ? WHERE lid = ?", source.slice(0, 40), lid);
      }
      if (!have) {
        this.db.run("INSERT INTO wa_lid_map (lid, pn, at, source) VALUES (?, ?, ?, ?)", lid, pn, Date.now(), source.slice(0, 40));
        out.learned++;
      }
      if (this.mergeLid(lid, pn)) out.merged++;
    }
    return out;
  }

  /**
   * Moves everything stored under a hidden-number id to the phone id. Never loses a message: a copy under the phone id is made
   * first (a message already there is the same message and is kept as is), and only rows with a verified copy are removed.
   * Returns whether anything was under the hidden-number id.
   */
  private mergeLid(lid: string, pn: string): boolean {
    let moved = false;
    const db = this.db;
    const under = db.all<{ id: string }>("SELECT id FROM wa_messages WHERE chat = ?", lid);
    if (under.length) {
      moved = true;
      db.run(
        "INSERT OR IGNORE INTO wa_messages (chat, id, sender, push_name, from_me, at, text, kind, source, quoted_id, seq, mentions, voice) SELECT ?, id, sender, push_name, from_me, at, text, kind, source, quoted_id, seq, mentions, voice FROM wa_messages WHERE chat = ?",
        pn,
        lid,
      );
      db.run("DELETE FROM wa_messages WHERE chat = ? AND EXISTS (SELECT 1 FROM wa_messages p WHERE p.chat = ? AND p.id = wa_messages.id)", lid, pn);
      // whoever walks the store by sequence has these messages under the hidden-number chat. Each gets a new sequence under the phone
      // chat, so the next pass reads them again with their new chat and the reader re-homes them (an item is its message id).
      for (const r of under) db.run("UPDATE wa_messages SET seq = ? WHERE chat = ? AND id = ?", this.nextSeq(), pn, r.id);
    }
    // The sender of a message (in a group, or in a chat) is the same person under either id.
    db.run("UPDATE wa_messages SET sender = ? WHERE sender = ?", pn, lid);
    // A group member listed under the hidden-number id is the same member under the phone id.
    db.run("UPDATE OR IGNORE wa_group_members SET member = ? WHERE member = ?", pn, lid);
    db.run("DELETE FROM wa_group_members WHERE member = ?", lid);
    const l = db.one<{ name: string | null; unread: number; last_at: number; archived: number }>("SELECT name, unread, last_at, archived FROM wa_chats WHERE jid = ?", lid);
    if (l) {
      moved = true;
      if (db.one("SELECT 1 AS x FROM wa_chats WHERE jid = ?", pn)) {
        // The larger unread count (the two may have counted the same messages); archived only if both are.
        db.run("UPDATE wa_chats SET name = COALESCE(name, ?), unread = MAX(unread, ?), last_at = MAX(last_at, ?), archived = MIN(archived, ?) WHERE jid = ?", l.name, l.unread, l.last_at, l.archived, pn);
        db.run("DELETE FROM wa_chats WHERE jid = ?", lid);
      } else {
        db.run("UPDATE wa_chats SET jid = ?, is_group = 0 WHERE jid = ?", pn, lid);
      }
    }
    const c = db.one<{ name: string | null; notify: string | null }>("SELECT name, notify FROM wa_contacts WHERE jid = ?", lid);
    if (c) {
      moved = true;
      db.run(
        "INSERT INTO wa_contacts (jid, name, notify) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = COALESCE(name, excluded.name), notify = COALESCE(notify, excluded.notify)",
        pn,
        c.name,
        c.notify,
      );
      db.run("DELETE FROM wa_contacts WHERE jid = ?", lid);
    }
    db.run("UPDATE wa_sent SET jid = ? WHERE jid = ?", pn, lid);
    return moved;
  }

  /** Applies every mapping already known to any rows still under a hidden-number id. Safe to run at any time, as often as wanted. */
  mergeKnown(): number {
    return this.db.tx(() => {
      const rows = this.db.all<{ lid: string; pn: string }>(
        `SELECT lid, pn FROM wa_lid_map WHERE lid IN (SELECT jid FROM wa_chats) OR lid IN (SELECT jid FROM wa_contacts) OR lid IN (SELECT chat FROM wa_messages)`,
      );
      let n = 0;
      for (const r of rows) if (this.mergeLid(r.lid, r.pn)) n++;
      return n;
    });
  }

  /** Hidden-number ids in the store that no mapping covers yet (for asking WhatsApp's own mapping). */
  unmappedLids(limit: number): string[] {
    return this.db
      .all<{ lid: string }>(
        `SELECT jid AS lid FROM wa_chats WHERE jid LIKE '%@lid' AND jid NOT IN (SELECT lid FROM wa_lid_map)
         UNION SELECT jid FROM wa_contacts WHERE jid LIKE '%@lid' AND jid NOT IN (SELECT lid FROM wa_lid_map)
         UNION SELECT DISTINCT chat FROM wa_messages WHERE chat LIKE '%@lid' AND chat NOT IN (SELECT lid FROM wa_lid_map)
         UNION SELECT DISTINCT sender FROM wa_messages WHERE sender LIKE '%@lid' AND sender NOT IN (SELECT lid FROM wa_lid_map)
         LIMIT ?`,
        limit,
      )
      .map((r) => r.lid);
  }

  // ----- writing ----------------------------------------------------------------------------------------------------

  upsertContacts(contacts: WaContact[]): void {
    this.db.tx(() => {
      const pairs = contacts.map((c) => pairOf(c.jid, c.altJid)).filter((p): p is WaLidPair => !!p);
      if (pairs.length) this.learnPairs(pairs, "contact");
      for (const c of contacts) {
        const jid = this.canon(c.jid);
        this.db.run(
          "INSERT INTO wa_contacts (jid, name, notify) VALUES (?, ?, ?) ON CONFLICT(jid) DO UPDATE SET name = COALESCE(excluded.name, name), notify = COALESCE(excluded.notify, notify)",
          jid,
          c.name?.slice(0, 200) ?? null,
          c.notify?.slice(0, 200) ?? null,
        );
      }
    });
  }

  upsertChats(chats: WaChat[], opts: { setUnread: boolean }): void {
    this.db.tx(() => {
      const pairs = chats.map((c) => pairOf(c.jid, c.altJid)).filter((p): p is WaLidPair => !!p);
      if (pairs.length) this.learnPairs(pairs, "chat");
      for (const c of chats) {
        const jid = this.canon(c.jid);
        const archived = c.archived === undefined ? null : c.archived ? 1 : 0;
        this.db.run(
          `INSERT INTO wa_chats (jid, name, is_group, unread, last_at, archived) VALUES (?, ?, ?, ?, ?, COALESCE(?, 0))
           ON CONFLICT(jid) DO UPDATE SET name = COALESCE(excluded.name, name), unread = CASE WHEN ? THEN excluded.unread ELSE unread END, last_at = MAX(last_at, excluded.last_at), archived = COALESCE(?, archived)`,
          jid,
          c.name?.slice(0, 200) ?? null,
          isGroup(jid) ? 1 : 0,
          Math.max(0, c.unread ?? 0),
          c.lastAt ?? 0,
          archived,
          opts.setUnread && c.unread !== undefined ? 1 : 0,
          archived,
        );
      }
    });
  }

  /** The next store sequence: a counter in `wa_meta` that never goes down, so a pruned row's number is not handed out again. */
  private nextSeq(): number {
    const n = (Number(this.db.one<{ value: string }>("SELECT value FROM wa_meta WHERE key = 'seq'")?.value) || 0) + 1;
    this.db.run("INSERT INTO wa_meta (key, value) VALUES ('seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(n));
    return n;
  }

  /** Stores messages that are not stored yet; returns the new ones. A chat gets its newest-activity time and, for a message from someone else that is not history, one more unread. */
  addMessages(messages: WaMessage[], source: "history" | "ondemand" | "offline" | "live" | "sent"): WaMessage[] {
    const fresh: WaMessage[] = [];
    // The link-time sync and the phone's answer to "older messages please" are both history: they add no unread and mark nothing read.
    const isHistory = source === "history" || source === "ondemand";
    this.db.tx(() => {
      const pairs = messages.flatMap((m) => [pairOf(m.chat, m.chatAlt), pairOf(m.sender, m.senderAlt)]).filter((p): p is WaLidPair => !!p);
      if (pairs.length) this.learnPairs(pairs, "message");
      for (const m of messages) {
        const chat = this.canon(m.chat);
        const sender = this.canon(m.sender);
        if (this.db.one("SELECT 1 AS x FROM wa_messages WHERE chat = ? AND id = ?", chat, m.id)) continue;
        // The tagged people, under the one id kept for each. Stored as a JSON list; none is stored as null.
        const tagged = [...new Set((m.mentions ?? []).slice(0, MAX_MENTIONS).map((j) => this.canon(j)))];
        const mentions = tagged.length ? JSON.stringify(tagged) : null;
        const text = m.text.length > MAX_TEXT ? `${m.text.slice(0, MAX_TEXT)}\n[cut]` : m.text;
        this.db.run(
          "INSERT INTO wa_messages (chat, id, sender, push_name, from_me, at, text, kind, source, quoted_id, seq, mentions, voice) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          chat,
          m.id,
          sender,
          m.pushName?.slice(0, 200) ?? null,
          m.fromMe ? 1 : 0,
          m.at,
          text,
          m.kind,
          source,
          m.quotedId?.slice(0, 200) ?? null,
          this.nextSeq(),
          mentions,
          m.kind === "voice note" && m.voice ? JSON.stringify(m.voice) : null,
        );
        fresh.push({ ...m, chat, sender, text });
        this.db.run(
          `INSERT INTO wa_chats (jid, name, is_group, unread, last_at) VALUES (?, NULL, ?, ?, ?)
           ON CONFLICT(jid) DO UPDATE SET last_at = MAX(last_at, excluded.last_at), unread = unread + excluded.unread`,
          chat,
          isGroup(chat) ? 1 : 0,
          isHistory || m.fromMe ? 0 : 1,
          m.at,
        );
        // A message the person sent from their phone means they have read the chat there.
        if (m.fromMe && !isHistory) this.db.run("UPDATE wa_chats SET unread = 0 WHERE jid = ?", chat);
        if (m.pushName && !m.fromMe) {
          this.db.run("INSERT INTO wa_contacts (jid, name, notify) VALUES (?, NULL, ?) ON CONFLICT(jid) DO UPDATE SET notify = excluded.notify", sender, m.pushName.slice(0, 200));
        }
      }
    });
    return fresh;
  }

  // ----- group members and mentions ----------------------------------------------------------------------------

  /** Whether the program has ever been told this group's member list (a fetched list may be empty; no row means never asked). */
  hasGroupInfo(jid: string): boolean {
    return !!this.db.one("SELECT 1 AS x FROM wa_group_info WHERE jid = ?", bareJid(jid));
  }

  /** Stores what WhatsApp said about groups: the subject (as the chat's name, only for a chat already known) and, when listed, the members, which replace the stored list. */
  learnGroups(groups: WaGroup[], now: number): void {
    this.db.tx(() => {
      for (const g of groups) {
        const jid = bareJid(g.jid);
        if (!isGroup(jid)) continue;
        if (g.subject) this.db.run("UPDATE wa_chats SET name = ? WHERE jid = ?", g.subject.slice(0, 200), jid);
        if (!g.members) continue;
        const pairs = g.members.map((m) => pairOf(m.jid, m.altJid)).filter((p): p is WaLidPair => !!p);
        if (pairs.length) this.learnPairs(pairs, "group");
        this.db.run("DELETE FROM wa_group_members WHERE grp = ?", jid);
        for (const m of g.members.slice(0, MAX_MEMBERS)) {
          this.db.run("INSERT INTO wa_group_members (grp, member, admin, at) VALUES (?, ?, ?, ?) ON CONFLICT(grp, member) DO UPDATE SET admin = excluded.admin, at = excluded.at", jid, this.canon(m.jid), m.admin ? 1 : 0, now);
        }
        this.db.run("INSERT INTO wa_group_info (jid, fetched_at) VALUES (?, ?) ON CONFLICT(jid) DO UPDATE SET fetched_at = excluded.fetched_at", jid, now);
      }
    });
  }

  /** Someone joined, left or changed rank. Applied only to a group whose list is known; a group never described is fetched whole instead. */
  changeGroup(c: WaGroupChange, now: number): void {
    const jid = bareJid(c.jid);
    if (!isGroup(jid) || !this.hasGroupInfo(jid)) return;
    this.db.tx(() => {
      const pairs = c.members.map((m) => pairOf(m.jid, m.altJid)).filter((p): p is WaLidPair => !!p);
      if (pairs.length) this.learnPairs(pairs, "group");
      for (const m of c.members.slice(0, MAX_MEMBERS)) {
        const member = this.canon(m.jid);
        if (c.action === "remove") this.db.run("DELETE FROM wa_group_members WHERE grp = ? AND member = ?", jid, member);
        else if (c.action === "add") this.db.run("INSERT INTO wa_group_members (grp, member, admin, at) VALUES (?, ?, 0, ?) ON CONFLICT(grp, member) DO NOTHING", jid, member, now);
        else this.db.run("UPDATE wa_group_members SET admin = ? WHERE grp = ? AND member = ?", c.action === "promote" ? 1 : 0, jid, member);
      }
    });
  }

  /** The stored members of a group with the names the program has for them, administrators first. Cut at MEMBERS_SHOWN. */
  members(jid: string): { members: WhatsAppMember[]; total: number } {
    const g = bareJid(jid);
    const total = this.db.one<{ n: number }>("SELECT count(*) AS n FROM wa_group_members WHERE grp = ?", g)?.n ?? 0;
    const rows = this.db.all<{ member: string; admin: number }>("SELECT member, admin FROM wa_group_members WHERE grp = ? ORDER BY admin DESC, member LIMIT ?", g, MEMBERS_SHOWN);
    return {
      total,
      members: rows.map((r) => {
        const n = this.namesOf(r.member);
        return { jid: r.member, ...(n.savedName ? { savedName: n.savedName } : {}), ...(n.pushName ? { pushName: n.pushName } : {}), ...(r.admin ? { admin: true } : {}) };
      }),
    };
  }

  private memberView(jid: string): { members?: WhatsAppMember[]; memberCount?: number } {
    if (!this.hasGroupInfo(jid)) return {};
    const r = this.members(jid);
    return { members: r.members, memberCount: r.total };
  }

  /** The saved name and the self-chosen name stored for a jid, apart from each other. */
  private namesOf(jid: string): { savedName?: string; pushName?: string } {
    const fs = this.forms(jid);
    const rows = this.db.all<{ name: string | null; notify: string | null }>(`SELECT name, notify FROM wa_contacts WHERE jid IN (${marks(fs.length)})`, ...fs);
    const savedName = rows.find((c) => c.name)?.name;
    const pushName = rows.find((c) => c.notify)?.notify;
    return { ...(savedName ? { savedName } : {}), ...(pushName ? { pushName } : {}) };
  }

  private mentionsOf(raw: string | null | undefined, cache: Map<string, { savedName?: string; pushName?: string }>): { mentions?: Array<{ jid: string; savedName?: string; pushName?: string }> } {
    if (!raw) return {};
    let list: unknown;
    try {
      list = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!Array.isArray(list) || !list.length) return {};
    const out = list.filter((j): j is string => typeof j === "string").slice(0, MAX_MENTIONS).map((j) => {
      if (!cache.has(j)) cache.set(j, this.namesOf(j));
      return { jid: j, ...cache.get(j)! };
    });
    return out.length ? { mentions: out } : {};
  }

  prune(now: number): number {
    const before = this.db.one<{ n: number }>("SELECT count(*) AS n FROM wa_messages")?.n ?? 0;
    // Messages the owner had the phone send on request are old on purpose: only the size cap below can drop them.
    this.db.run("DELETE FROM wa_messages WHERE at < ? AND source != ?", now - RETAIN_MS, ONDEMAND_SOURCE);
    const over = (this.db.one<{ n: number }>("SELECT count(*) AS n FROM wa_messages")?.n ?? 0) - MAX_MESSAGES;
    if (over > 0) this.db.run("DELETE FROM wa_messages WHERE rowid IN (SELECT rowid FROM wa_messages ORDER BY at LIMIT ?)", over);
    return before - (this.db.one<{ n: number }>("SELECT count(*) AS n FROM wa_messages")?.n ?? 0);
  }

  eraseAll(): void {
    this.db.tx(() => {
      this.db.run("DELETE FROM wa_messages");
      this.db.run("DELETE FROM wa_chats");
      this.db.run("DELETE FROM wa_contacts");
      this.db.run("DELETE FROM wa_sent");
      this.db.run("DELETE FROM wa_lid_map");
      this.db.run("DELETE FROM wa_lid_history");
      this.db.run("DELETE FROM wa_group_members");
      this.db.run("DELETE FROM wa_group_info");
    });
  }

  // ----- reading ----------------------------------------------------------------------------------------------------

  counts(): { chats: number; unread: number; messages: number } {
    const c = this.db.one<{ chats: number; unread: number; messages: number }>(
      "SELECT (SELECT count(*) FROM wa_chats) AS chats, (SELECT COALESCE(SUM(unread), 0) FROM wa_chats) AS unread, (SELECT count(*) FROM wa_messages) AS messages",
    );
    return c ?? { chats: 0, unread: 0, messages: 0 };
  }

  /** The newest chats, for the older `chats` call: no paging information. */
  chats(o: { limit: number; unreadOnly?: boolean }): WhatsAppChatView[] {
    return this.chatPage({ limit: o.limit, ...(o.unreadOnly ? { unreadOnly: true } : {}) }).chats;
  }

  /** One page of chats, newest activity first (ties by id), with the numbers that let the caller say whether the list is complete. */
  chatPage(q: Omit<WhatsAppChatQuery, "before"> & { limit: number; before?: { at: number; jid: string } }): WhatsAppChatPage {
    const withMembers = q.members === true;
    const base = ["last_at > 0"];
    const bind: number[] = [];
    if (q.unreadOnly) base.push("unread > 0");
    if (q.since !== undefined) {
      base.push("last_at >= ?");
      bind.push(q.since);
    }
    const include = q.includeArchived ?? true;
    const where = [...base, ...(include ? [] : ["archived = 0"])].join(" AND ");
    const count = (w: string): number => this.db.one<{ n: number }>(`SELECT count(*) AS n FROM wa_chats WHERE ${w}`, ...bind)?.n ?? 0;
    const total = count(where);
    const archivedHidden = include ? 0 : count(`${base.join(" AND ")} AND archived = 1`);
    const undated = this.db.one<{ n: number }>("SELECT count(*) AS n FROM wa_chats WHERE last_at = 0")?.n ?? 0;
    const rows = this.db.all<ChatRow>(
      `SELECT jid, name, is_group, unread, last_at, archived FROM wa_chats WHERE ${where}${q.before ? " AND (last_at < ? OR (last_at = ? AND jid < ?))" : ""} ORDER BY last_at DESC, jid DESC LIMIT ?`,
      ...bind,
      ...(q.before ? [q.before.at, q.before.at, q.before.jid] : []),
      q.limit + 1,
    );
    const more = rows.length > q.limit;
    const chats = rows.slice(0, q.limit).map((r) => {
      const fs = this.forms(r.jid);
      const last = this.db.one<{ text: string; kind: string; from_me: number }>(`SELECT text, kind, from_me FROM wa_messages WHERE chat IN (${marks(fs.length)}) ORDER BY at DESC LIMIT 1`, ...fs);
      const stored = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM wa_messages WHERE chat IN (${marks(fs.length)})`, ...fs)?.n ?? 0;
      const text = last ? (last.text || `[${last.kind}]`) : "";
      return {
        jid: r.jid,
        name: this.displayName(r.jid),
        isGroup: r.is_group === 1,
        unread: r.unread,
        lastAt: r.last_at,
        preview: text.replace(/\s+/g, " ").slice(0, 120),
        lastFromMe: last?.from_me === 1,
        archived: r.archived === 1,
        stored,
        ...(withMembers && r.is_group === 1 ? this.memberView(r.jid) : {}),
      };
    });
    const lastShown = chats[chats.length - 1];
    return { chats, total, more, ...(more && lastShown ? { next: cursorOf(lastShown) } : {}), archivedHidden, undated, archivedShown: chats.filter((c) => c.archived).length };
  }

  /** What is stored for a chat, to tell "nothing was said" from "WhatsApp only sent its summary". */
  chatInfo(jid: string): { jid: string; stored: number; known: boolean; lastAt: number; archived: boolean } {
    const fs = this.forms(jid);
    const stored = this.db.one<{ n: number }>(`SELECT count(*) AS n FROM wa_messages WHERE chat IN (${marks(fs.length)})`, ...fs)?.n ?? 0;
    const rows = this.db.all<{ last_at: number; archived: number }>(`SELECT last_at, archived FROM wa_chats WHERE jid IN (${marks(fs.length)})`, ...fs);
    return { jid: fs[0]!, stored, known: rows.length > 0, lastAt: Math.max(0, ...rows.map((r) => r.last_at)), archived: rows.some((r) => r.archived === 1) };
  }

  private view(r: MsgRow): WhatsAppMessageView {
    return {
      id: r.id,
      chat: this.canon(r.chat),
      sender: r.from_me ? "me" : numberOf(r.sender) ? `+${numberOf(r.sender)}` : r.sender,
      senderName: r.from_me ? "me" : (this.savedName(r.sender) ?? (r.push_name ? `~${r.push_name}` : this.displayName(r.sender))),
      fromMe: r.from_me === 1,
      at: r.at,
      text: r.text,
      kind: r.kind,
    };
  }

  /** The newest `limit` messages of a chat after `since`, oldest first. */
  messages(chat: string, o: { since?: number; limit: number }): WhatsAppMessageView[] {
    const fs = this.forms(chat);
    const rows = this.db.all<MsgRow>(`SELECT chat, id, sender, push_name, from_me, at, text, kind FROM wa_messages WHERE chat IN (${marks(fs.length)}) AND at > ? ORDER BY at DESC LIMIT ?`, ...fs, o.since ?? 0, o.limit);
    return rows.reverse().map((r) => this.view(r));
  }

  /**
   * A page of the stored messages in `(at, chat, id)` order for the context store: ascending after a key, or descending before
   * one. The keys compare bytewise, so a page boundary inside one millisecond cannot skip or repeat a message. Names are
   * resolved once per chat and sender per page.
   */
  history(q: { after?: WaHistoryKey; before?: WaHistoryKey; afterSeq?: number; order?: "asc" | "desc"; limit: number; chat?: string; id?: string; since?: number }): { items: WaHistoryMessage[]; more: boolean; oldestAt: number | null; newestAt: number | null; newestSeq: number } {
    const where: string[] = [];
    const bind: Array<string | number> = [];
    const desc = q.order === "desc" || (!!q.before && !q.after);
    const k = q.after ?? q.before;
    // The store sequence: the messages stored after a number, in the order they were stored, whatever their send time.
    const bySeq = q.afterSeq !== undefined && !k;
    if (bySeq) {
      where.push("seq > ?");
      bind.push(q.afterSeq!);
    }
    if (k) {
      const op = desc ? "<" : ">";
      where.push(`(at ${op} ? OR (at = ? AND (chat ${op} ? OR (chat = ? AND id ${op} ?))))`);
      bind.push(k.at, k.at, k.chat, k.chat, k.id);
    }
    if (q.since !== undefined) {
      where.push("at >= ?");
      bind.push(q.since);
    }
    if (q.chat) {
      const fs = this.forms(q.chat);
      where.push(`chat IN (${marks(fs.length)})`);
      bind.push(...fs);
    }
    if (q.id) {
      where.push("id = ?");
      bind.push(q.id);
    }
    const dir = desc ? "DESC" : "ASC";
    const rows = this.db.all<MsgRow>(
      `SELECT chat, id, sender, push_name, from_me, at, text, kind, quoted_id, seq, mentions FROM wa_messages ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ${bySeq ? "seq ASC" : `at ${dir}, chat ${dir}, id ${dir}`} LIMIT ?`,
      ...bind,
      q.limit + 1,
    );
    const chatNames = new Map<string, string>();
    const saved = new Map<string, string | undefined>();
    const names = new Map<string, { savedName?: string; pushName?: string }>();
    const items = rows.slice(0, q.limit).map((r): WaHistoryMessage => {
      const chat = this.canon(r.chat);
      const sender = this.canon(r.sender);
      if (!chatNames.has(chat)) chatNames.set(chat, this.displayName(chat));
      if (!saved.has(sender)) saved.set(sender, this.savedName(sender));
      const savedName = saved.get(sender);
      return {
        id: r.id,
        chat,
        chatName: chatNames.get(chat)!,
        isGroup: isGroup(chat),
        at: r.at,
        sender,
        ...(savedName ? { savedName } : {}),
        ...(r.push_name ? { pushName: r.push_name } : {}),
        fromMe: r.from_me === 1,
        text: r.text,
        kind: r.kind,
        ...(r.quoted_id ? { quotedId: r.quoted_id } : {}),
        ...this.mentionsOf(r.mentions, names),
        ...(r.seq !== null && r.seq !== undefined ? { seq: r.seq } : {}),
      };
    });
    const span = this.db.one<{ lo: number | null; hi: number | null }>("SELECT MIN(at) AS lo, MAX(at) AS hi FROM wa_messages");
    const newestSeq = Number(this.db.one<{ value: string }>("SELECT value FROM wa_meta WHERE key = 'seq'")?.value) || 0;
    return { items, more: rows.length > q.limit, oldestAt: span?.lo ?? null, newestAt: span?.hi ?? null, newestSeq };
  }

  search(query: string, o: { limit: number; chat?: string }): WhatsAppMessageView[] {
    const like = `%${query.replace(LIKE_ESCAPE, "\\$&")}%`;
    const fs = o.chat ? this.forms(o.chat) : [];
    const rows = this.db.all<MsgRow>(
      `SELECT chat, id, sender, push_name, from_me, at, text, kind FROM wa_messages WHERE text LIKE ? ESCAPE '\\' ${o.chat ? `AND chat IN (${marks(fs.length)})` : ""} ORDER BY at DESC LIMIT ?`,
      like,
      ...fs,
      o.limit,
    );
    return rows.map((r) => this.view(r));
  }

  /** The oldest stored message of a chat (either form of a person), the anchor for asking the phone for earlier ones. */
  oldest(jid: string): { chat: string; id: string; fromMe: boolean; at: number } | undefined {
    const fs = this.forms(jid);
    const r = this.db.one<{ chat: string; id: string; from_me: number; at: number }>(`SELECT chat, id, from_me, at FROM wa_messages WHERE chat IN (${marks(fs.length)}) ORDER BY at ASC, id ASC LIMIT 1`, ...fs);
    return r ? { chat: this.canon(r.chat), id: r.id, fromMe: r.from_me === 1, at: r.at } : undefined;
  }

  hasChat(jid: string): boolean {
    const fs = this.forms(jid);
    return !!this.db.one(`SELECT 1 AS x FROM wa_chats WHERE jid IN (${marks(fs.length)})`, ...fs) || !!this.db.one(`SELECT 1 AS x FROM wa_contacts WHERE jid IN (${marks(fs.length)})`, ...fs);
  }

  /**
   * What a person (or the model) wrote for "the chat": a jid, a phone number, or a name. A name matches the person's saved
   * names and chat names (a group's subject), whole or as a word; a name someone gave themselves is a last resort and
   * never decides alone when anything saved matches.
   */
  resolve(ref: string): { jid: string } | { candidates: Array<{ jid: string; name: string }> } | { none: true } {
    const r = ref.trim();
    if (!r) return { none: true };
    // Old groups have ids made of the creator's number, a hyphen and a timestamp ("15550110-1500000000@g.us").
    if (/^\d+(:\d+)?@(s\.whatsapp\.net|lid)$/.test(r) || /^\d+(-\d+)?@g\.us$/.test(r)) return { jid: this.canon(r) };
    const digits = r.replace(/[\s().+-]/g, "");
    if (/^\d{7,15}$/.test(digits)) return { jid: jidOf(digits) };
    const needle = r.toLowerCase();
    const exact = this.db
      .all<{ jid: string; name: string }>("SELECT jid, name FROM wa_contacts WHERE name IS NOT NULL UNION SELECT jid, name FROM wa_chats WHERE name IS NOT NULL")
      .filter((x) => x.name.toLowerCase() === needle);
    const uniq = (xs: Array<{ jid: string; name: string }>) => [...new Map(xs.map((x) => [x.jid, x])).values()];
    if (uniq(exact).length === 1) return { jid: exact[0]!.jid };
    if (uniq(exact).length > 1) return { candidates: uniq(exact).slice(0, 8) };
    const like = `%${needle.replace(LIKE_ESCAPE, "\\$&")}%`;
    const part = uniq(
      this.db
        .all<{ jid: string; name: string }>(`SELECT jid, name FROM wa_contacts WHERE name LIKE ? ESCAPE '\\' UNION SELECT jid, name FROM wa_chats WHERE name LIKE ? ESCAPE '\\'`, like, like)
        .filter((x) => x.name),
    );
    if (part.length === 1) return { jid: part[0]!.jid };
    if (part.length > 1) return { candidates: part.slice(0, 8) };
    const pushed = uniq(this.db.all<{ jid: string; name: string }>(`SELECT jid, notify AS name FROM wa_contacts WHERE notify LIKE ? ESCAPE '\\'`, like));
    if (pushed.length === 1) return { jid: pushed[0]!.jid };
    if (pushed.length > 1) return { candidates: pushed.slice(0, 8).map((x) => ({ jid: x.jid, name: `~${x.name}` })) };
    return { none: true };
  }
}
