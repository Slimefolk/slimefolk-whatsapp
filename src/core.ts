// The WhatsApp logic, independent of Cloudflare and of Baileys: pairing state, polling, storage, logout detection, sends. The Durable Object (do.ts) gives it SQLite, the sealed login store and the alarm; the protocol library
// arrives through the `WaAdapter` seam (adapter.ts), so all of this is tested with a fake one. Time is passed in.
//
// States: unlinked -> pairing -> linked -> logged_out (the phone unlinked it) -> pairing -> linked ...
// A poll opens a connection from the stored login, takes what WhatsApp queued while the device was away and the history sync,
// waits for things to go quiet, and closes. Polling is the only mode: a "stay connected" mode is future work (Slimefolk #746).
import {
  WA_DEFAULT_FREQUENCY,
  frequencyMs,
  isWhatsAppFrequency,
  type PollResult,
  type SendResult,
  type WaNewMessage,
  type WaHistoryKey,
  type WaHistoryPage,
  type WaHistoryQuery,
  type WaNotice,
  type WaOlderQuery,
  type WaOlderResult,
  type WhatsAppChatPage,
  type WhatsAppChatQuery,
  type WhatsAppChatView,
  type WhatsAppFrequency,
  type WhatsAppMessageView,
  type WhatsAppPairing,
  type WhatsAppState,
  type WhatsAppStatus,
} from "../contract/index.ts";
import { AUTH_CREDS_KEY, type WaAdapter, type AuthKv, type WaCloseReason, type WaConnection, type WaEvents, type WaMe, type WaMessage } from "./adapter.ts";
import { MAX_MESSAGES, ONDEMAND_SOURCE, RETAIN_MS, WaStore, bareJid, isGroup, isPnJid, numberOf, parseChatCursor, type WaDb } from "./store.ts";

/** A `history` page holds at most this many messages (the default is half). */
const HISTORY_MAX = 500;
const HISTORY_DEFAULT = 200;

/** Something the person has to fix, in words for them. The status says which HTTP status the API maps it to. */
export class WaError extends Error {
  override name = "WaError";
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 429 | 502 | 503 = 400,
  ) {
    super(message);
  }
}

export interface WaTiming {
  /** How long to wait for WhatsApp to accept a connection. */
  connectMs: number;
  /** How long a poll waits for the queued messages to finish arriving. */
  pollMaxMs: number;
  /** A poll ends when nothing has arrived for this long after the queue drained, or at the cap. */
  quietMs: number;
  quietMaxMs: number;
  /** The first connection after pairing also receives the history sync. */
  firstSyncMs: number;
  firstQuietMs: number;
  firstQuietMaxMs: number;
  /** How long a pairing code or QR stays valid. */
  pairMs: number;
  backoffBaseMs: number;
  backoffMaxMs: number;
  /** After a send, how long to stay for the delivery acknowledgement. */
  sendLingerMs: number;
  /** "Older messages please" : how long to wait for the phone's answer, then how long things must stay quiet (and at most) for the rest of it. */
  olderWaitMs: number;
  olderQuietMs: number;
  olderQuietMaxMs: number;
  /** The same chat is asked again no sooner than this; any two asks are at least `olderGapMs` apart; at most `olderPerHour` asks in an hour. */
  olderChatCooldownMs: number;
  olderGapMs: number;
  olderPerHour: number;
}

export const DEFAULT_TIMING: WaTiming = {
  connectMs: 20_000,
  pollMaxMs: 40_000,
  quietMs: 2_500,
  quietMaxMs: 8_000,
  firstSyncMs: 90_000,
  firstQuietMs: 6_000,
  firstQuietMaxMs: 60_000,
  pairMs: 180_000,
  backoffBaseMs: 30_000,
  backoffMaxMs: 15 * 60_000,
  sendLingerMs: 3_000,
  olderWaitMs: 45_000,
  olderQuietMs: 2_500,
  olderQuietMaxMs: 10_000,
  olderChatCooldownMs: 120_000,
  olderGapMs: 15_000,
  olderPerHour: 10,
};

export interface WaCoreDeps {
  db: WaDb;
  auth: AuthKv;
  adapter(): Promise<WaAdapter>;
  now(): number;
  /** Sets the one alarm (null: none). */
  setAlarm(at: number | null): void | Promise<void>;
  notify(n: WaNotice): void;
  /** Hands the new incoming messages of a check to the caller's webhook. Errors are the caller's: they never fail a check. */
  deliver(items: WaNewMessage[]): Promise<void>;
  /** The deployment has what WhatsApp needs (a key to seal the login with). */
  available(): boolean;
  timing?: Partial<WaTiming> | (() => Partial<WaTiming>);
  log?(event: string, data?: Record<string, unknown>): void;
}

interface Session {
  mode: "poll" | "pair" | "send" | "older";
  /** An "older messages" request in flight on this connection: the ids the chat is stored under, and what has come back. */
  older?: { forms: Set<string>; batches: number; added: number };
  conn?: WaConnection;
  open: boolean;
  me?: WaMe;
  drained: boolean;
  closed?: { reason: WaCloseReason; detail?: string };
  /** Counts events, for "nothing arrived for a while". */
  events: number;
  waiters: Set<() => void>;
  fresh: WaNewMessage[];
  /** Hidden-number ids already asked about on this connection, and whether a lookup is running. */
  lidsTried?: Set<string>;
  askingLids?: boolean;
  /** Groups whose metadata was already asked for on this connection: each is asked once, however it ends. */
  groupsTried?: Set<string>;
  /** We are closing it: its `close` event is not a drop. */
  closing?: boolean;
}

/** Groups described per batch of messages or history: the first sight of a group is one metadata fetch, never a sweep. */
const GROUPS_PER_BATCH = 5;
const OLDER_MIN = 10;
const OLDER_DEFAULT = 50;
const OLDER_MAX = 100;
const SEND_LIMIT_PER_HOUR = 20;
const MAX_SEND_CHARS = 4000;
const FAILURES_BEFORE_NOTICE = 3;
const NUMBER = /^\d{7,15}$/;

const digitsOf = (id: string): string => /^(\d{5,16})(?::\d+)?@/.exec(id)?.[1] ?? "";
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class WhatsAppCore {
  readonly store: WaStore;
  private get t(): WaTiming {
    const o = this.d.timing;
    return { ...DEFAULT_TIMING, ...(typeof o === "function" ? o() : o) };
  }
  private pairSession: Session | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private polling: Promise<PollResult> | undefined;

  constructor(private readonly d: WaCoreDeps) {
    this.store = new WaStore(d.db);
    // Catch up on mappings that were learned but not applied (a restart in the middle of a sync). Idempotent.
    try {
      this.store.mergeKnown();
    } catch (e) {
      d.log?.("whatsapp_merge_error", { message: msg(e) });
    }
  }

  // ----- small state ------------------------------------------------------------------------------------------------

  private meta(key: string): string | undefined {
    return this.d.db.one<{ value: string }>("SELECT value FROM wa_meta WHERE key = ?", key)?.value;
  }
  private setMeta(key: string, value: string | number | null): void {
    if (value === null) this.d.db.run("DELETE FROM wa_meta WHERE key = ?", key);
    else this.d.db.run("INSERT INTO wa_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));
  }
  private num(key: string): number | undefined {
    const v = this.meta(key);
    return v === undefined ? undefined : Number(v);
  }
  private json<T>(key: string): T | undefined {
    const v = this.meta(key);
    return v === undefined ? undefined : (JSON.parse(v) as T);
  }

  private get state(): WhatsAppState {
    const s = this.meta("state");
    return s === "pairing" || s === "linked" || s === "logged_out" ? s : "unlinked";
  }
  private setState(s: WhatsAppState): void {
    this.setMeta("state", s);
  }

  get frequency(): WhatsAppFrequency {
    const v = this.meta("frequency");
    const n = v === undefined ? undefined : Number(v);
    return isWhatsAppFrequency(n) ? n : WA_DEFAULT_FREQUENCY;
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // ----- status -----------------------------------------------------------------------------------------------------

  status(): WhatsAppStatus {
    const state = this.state;
    const connected = !!this.pairSession?.open;
    const freq = this.frequency;
    const pairing = state === "pairing" ? this.json<WhatsAppPairing>("pairing") : undefined;
    const number = this.meta("number");
    const name = this.meta("name");
    const lastPollAt = this.num("last_poll_at");
    const nextPollAt = state === "linked" ? this.num("next_poll_at") : undefined;
    const lastError = this.meta("last_error");
    const failures = this.num("failures");
    const loggedOutAt = this.num("logged_out_at");
    const linkedAt = this.num("linked_at");
    return {
      state,
      connected,
      frequency: freq,
      counts: this.store.counts(),
      available: this.d.available(),
      ...(state === "linked" || state === "logged_out" ? (number ? { number } : {}) : {}),
      ...(state === "linked" && name ? { name } : {}),
      ...(lastPollAt !== undefined && state === "linked" ? { lastPollAt } : {}),
      ...(nextPollAt !== undefined ? { nextPollAt } : {}),
      ...(lastError ? { lastError } : {}),
      ...(failures ? { consecutiveFailures: failures } : {}),
      ...(pairing ? { pairing } : {}),
      ...(loggedOutAt !== undefined && state === "logged_out" ? { loggedOutAt } : {}),
      ...(linkedAt !== undefined && state === "linked" ? { linkedAt } : {}),
    };
  }

  // ----- sessions ---------------------------------------------------------------------------------------------------

  private ping(s: Session): void {
    for (const w of [...s.waiters]) w();
  }

  private waitFor(s: Session, done: () => boolean, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (done()) return resolve(true);
      const w = () => {
        if (!done()) return;
        clearTimeout(timer);
        s.waiters.delete(w);
        resolve(true);
      };
      const timer = setTimeout(() => {
        s.waiters.delete(w);
        resolve(false);
      }, ms);
      s.waiters.add(w);
    });
  }

  /** Waits until nothing has arrived for `quietMs`, at most `capMs` in all. */
  private async quiet(s: Session, quietMs: number, capMs: number): Promise<void> {
    const end = Date.now() + capMs;
    for (;;) {
      const seen = s.events;
      await this.waitFor(s, () => !!s.closed, quietMs);
      if (s.closed || s.events === seen || Date.now() >= end) return;
    }
  }

  private sessionEvents(s: Session): WaEvents {
    const guard =
      <A extends unknown[]>(name: string, fn: (...a: A) => void) =>
      (...a: A): void => {
        try {
          fn(...a);
        } catch (e) {
          this.d.log?.("whatsapp_event_error", { event: name, message: msg(e) });
        } finally {
          s.events++;
          this.ping(s);
        }
      };
    return {
      open: guard("open", (me) => {
        s.open = true;
        s.me = me;
        if (me.lid && /^\d{5,40}@lid$/.test(me.lid)) this.setMeta("lid", me.lid);
        if (this.state === "pairing") void this.completeLink(s, me).catch((e) => this.d.log?.("whatsapp_error", { message: msg(e) }));
      }),
      close: guard("close", (reason, detail) => {
        s.open = false;
        s.closed = { reason, ...(detail ? { detail } : {}) };
        this.onClosed(s);
      }),
      qr: guard("qr", (qr) => {
        const p = this.json<WhatsAppPairing>("pairing");
        if (this.state === "pairing" && p && p.method === "qr") this.setMeta("pairing", JSON.stringify({ ...p, qr }));
      }),
      drained: guard("drained", () => {
        s.drained = true;
        void this.askForLids(s);
      }),
      history: guard("history", (b) => {
        if (b.onDemand) {
          // The phone's answer to "older messages please". Stored as history (no unread, nothing marked read), never handed to event
          // routines, and the chat list is left alone: its unread counts and times describe the chat now, not this slice of its past.
          if (b.lidMappings?.length) this.store.learnLids(b.lidMappings, "history");
          this.store.upsertContacts(b.contacts);
          const added = this.store.addMessages(b.messages, ONDEMAND_SOURCE);
          if (s.older) {
            s.older.batches++;
            s.older.added += added.filter((m) => s.older!.forms.has(m.chat) || s.older!.forms.has(this.store.canon(m.chat))).length;
          }
          return;
        }
        if (b.lidMappings?.length) this.store.learnLids(b.lidMappings, "history");
        this.store.upsertContacts(b.contacts);
        this.store.upsertChats(b.chats, { setUnread: true });
        this.store.addMessages(b.messages, "history");
        // The newest groups of the sync that were never described (a group with no message in it is not asked about).
        const newest = new Map<string, number>();
        for (const m of b.messages) newest.set(m.chat, Math.max(newest.get(m.chat) ?? 0, m.at));
        void this.askForGroups(s, [...newest.keys()].sort((x, y) => newest.get(y)! - newest.get(x)!));
      }),
      lidMappings: guard("lidMappings", (pairs) => void this.store.learnLids(pairs, "event")),
      messages: guard("messages", (ms, how) => {
        const added = this.store.addMessages(ms, how);
        const linkedAt = this.num("linked_at") ?? 0;
        for (const m of added) if (!m.fromMe && m.at >= linkedAt - 60_000) s.fresh.push(this.newMessage(m));
        // A hidden-number id with no explanation in the message itself: ask WhatsApp's own mapping.
        if (s.drained && added.some((m) => m.chat.endsWith("@lid") || m.sender.endsWith("@lid"))) void this.askForLids(s);
        // A group seen for the first time: ask WhatsApp once who is in it.
        void this.askForGroups(s, added.map((m) => m.chat));
      }),
      chats: guard("chats", (cs) => this.store.upsertChats(cs, { setUnread: true })),
      contacts: guard("contacts", (cs) => this.store.upsertContacts(cs)),
      groups: guard("groups", (gs) => this.store.learnGroups(gs, this.d.now())),
      groupChange: guard("groupChange", (c) => this.store.changeGroup(c, this.d.now())),
    };
  }

  /** Asks WhatsApp once for the subject and members of groups the program has never had described. Best effort; one fetch per group per connection. */
  private async askForGroups(s: Session, chats: string[]): Promise<void> {
    const ask = s.conn?.groupMetadata?.bind(s.conn);
    if (!ask || !s.open) return;
    s.groupsTried ??= new Set();
    const todo = [...new Set(chats)].filter((j) => isGroup(j) && !s.groupsTried!.has(j) && !this.store.hasGroupInfo(j)).slice(0, GROUPS_PER_BATCH);
    for (const jid of todo) {
      s.groupsTried.add(jid);
      try {
        const g = await ask(jid);
        if (g) this.store.learnGroups([g], this.d.now());
      } catch (e) {
        this.d.log?.("whatsapp_group_error", { message: msg(e) });
      } finally {
        s.events++;
        this.ping(s);
      }
    }
  }

  /** Asks WhatsApp's own mapping (kept by the client, local) about hidden-number ids no event has explained yet. Best effort. */
  private async askForLids(s: Session): Promise<void> {
    if (s.askingLids) return;
    s.askingLids = true;
    try {
      const ask = s.conn?.pnForLid?.bind(s.conn);
      if (!ask) return;
      s.lidsTried ??= new Set();
      const pairs: Array<{ lid: string; pn: string }> = [];
      // Each id is asked about once per connection, a bounded number at a time.
      for (const lid of this.store.unmappedLids(100)) {
        if (s.lidsTried.has(lid)) continue;
        s.lidsTried.add(lid);
        const pn = await ask(lid).catch(() => null);
        if (pn && isPnJid(bareJid(pn))) pairs.push({ lid, pn });
      }
      if (pairs.length) this.store.learnLids(pairs, "lookup");
    } catch (e) {
      this.d.log?.("whatsapp_lid_lookup_error", { message: msg(e) });
    } finally {
      s.askingLids = false;
    }
  }

  private newMessage(m: WaMessage): WaNewMessage {
    const saved = this.store.savedName(m.sender);
    return {
      id: m.id,
      at: m.at,
      chat: m.chat,
      chatName: this.store.displayName(m.chat),
      isGroup: isGroup(m.chat),
      sender: m.sender,
      ...(saved ? { savedName: saved } : {}),
      ...(m.pushName ? { pushName: m.pushName } : {}),
      text: m.text,
      kind: m.kind,
    };
  }

  private async flush(s: Session): Promise<void> {
    const items = s.fresh.splice(0);
    if (!items.length) return;
    try {
      await this.d.deliver(items);
    } catch (e) {
      this.d.log?.("whatsapp_deliver_error", { message: msg(e) });
    }
  }

  /** Opens a connection and waits for WhatsApp to accept it (or refuse). The session may come back closed. */
  private async openSession(mode: Session["mode"], extra: { pairPhone?: string; pairQr?: boolean } = {}): Promise<Session> {
    const s: Session = { mode, open: false, drained: false, events: 0, waiters: new Set(), fresh: [] };
    const adapter = await this.d.adapter();
    try {
      s.conn = await adapter.connect({ auth: this.d.auth, events: this.sessionEvents(s), ...extra });
    } catch (e) {
      throw new WaError(`Could not reach WhatsApp: ${msg(e)}`, 502);
    }
    if (mode === "pair") return s;
    await this.waitFor(s, () => s.open || !!s.closed, this.t.connectMs);
    return s;
  }

  private closeSession(s: Session | undefined): void {
    if (!s) return;
    try {
      s.conn?.close();
    } catch {
      /* already closed */
    }
    s.closing = true;
    s.open = false;
    if (!s.closed) s.closed = { reason: "other", detail: "closed here" };
    this.ping(s);
  }

  // ----- a connection ended -----------------------------------------------------------------------------------------

  private onClosed(s: Session): void {
    const reason = s.closed?.reason;
    if (reason === "logged_out") {
      void this.soft(() => this.loggedOut(s.closed?.detail));
      return;
    }
    if (s.closing) return;
    if (s.mode === "pair") {
      if (s === this.pairSession) this.pairSession = undefined;
      if (this.state !== "pairing") return;
      if (reason === "restart_required") {
        // Pairing worked; WhatsApp wants a fresh connection with the new login. Opening it completes the link.
        void this.soft(() => this.reopenAfterPairing());
        return;
      }
      void this.soft(() => this.failPairing(reason === "forbidden" ? "WhatsApp refused the connection. The number may be restricted." : "The connection to WhatsApp dropped before the code was entered. Try again."));
      return;
    }
  }

  private async soft(fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.d.log?.("whatsapp_error", { message: msg(e) });
    }
  }

  private backoff(failures: number): number {
    return Math.min(this.t.backoffMaxMs, this.t.backoffBaseMs * 2 ** Math.max(0, failures - 1));
  }

  // ----- pairing ----------------------------------------------------------------------------------------------------

  async startPairing(o: { method: "code" | "qr"; phone?: string }): Promise<WhatsAppStatus> {
    return this.exclusive(async () => {
      if (!this.d.available()) throw new WaError("This deployment has no KEY_ENCRYPTION_KEY, so it cannot keep the WhatsApp login safe. Add it to the deployment's secrets first.", 503);
      if (this.state === "linked") throw new WaError("WhatsApp is already linked. Unlink it first to link a different number.", 409);
      if (o.method === "code" && !(o.phone && NUMBER.test(o.phone))) throw new WaError("Type the phone number with its country code, for example 15550100.");
      await this.dropSessions();
      await this.wipeAuth();
      const now = this.d.now();
      const pairing: WhatsAppPairing = { method: o.method, startedAt: now, expiresAt: now + this.t.pairMs, ...(o.phone ? { phone: o.phone } : {}) };
      this.setState("pairing");
      this.setMeta("pairing", JSON.stringify(pairing));
      this.setMeta("last_error", null);
      let s: Session;
      try {
        s = await this.openSession("pair", o.method === "code" ? { pairPhone: o.phone! } : { pairQr: true });
      } catch (e) {
        this.setState(this.meta("number") ? "logged_out" : "unlinked");
        this.setMeta("pairing", null);
        throw e;
      }
      this.pairSession = s;
      if (o.method === "code") {
        const code = s.conn?.pairingCode;
        if (!code) {
          this.closeSession(s);
          this.pairSession = undefined;
          this.setState("unlinked");
          this.setMeta("pairing", null);
          throw new WaError("WhatsApp did not give a code. Check the number and try again.", 502);
        }
        this.setMeta("pairing", JSON.stringify({ ...pairing, code }));
      }
      await this.reschedule();
      return this.status();
    });
  }

  async cancelPairing(reason?: string): Promise<WhatsAppStatus> {
    return this.exclusive(async () => {
      if (this.state === "pairing") await this.failPairing(reason);
      return this.status();
    });
  }

  private async failPairing(why?: string): Promise<void> {
    this.closeSession(this.pairSession);
    this.pairSession = undefined;
    await this.wipeAuth();
    this.setState(this.meta("number") && this.meta("logged_out_at") ? "logged_out" : "unlinked");
    this.setMeta("pairing", null);
    if (why) this.setMeta("last_error", why);
    await this.reschedule();
  }

  /** After the code was accepted: reconnect with the login WhatsApp just issued. Opening it completes the link. */
  private async reopenAfterPairing(attempt = 1): Promise<void> {
    try {
      const s = await this.openSession("poll");
      // Opening it fired `open`, which completed the link (and took the session over); nothing more to do.
      if (this.state !== "pairing") return;
      if (s.closed?.reason === "restart_required" && attempt < 3) return this.reopenAfterPairing(attempt + 1);
      if (!s.open) await this.failPairing("WhatsApp accepted the code but the connection did not come up. Try again.");
    } catch (e) {
      await this.failPairing(msg(e));
    }
  }

  private async completeLink(s: Session, me: WaMe): Promise<void> {
    if (this.state !== "pairing") return;
    const now = this.d.now();
    const number = digitsOf(me.id);
    this.pairSession = undefined;
    this.setState("linked");
    this.setMeta("pairing", null);
    this.setMeta("number", number);
    if (me.name) this.setMeta("name", me.name);
    this.setMeta("linked_at", now);
    this.setMeta("logged_out_at", null);
    this.setMeta("last_error", null);
    this.setMeta("failures", null);
    this.setMeta("last_poll_at", now);
    this.setMeta("next_poll_at", now + frequencyMs(this.frequency));
    s.mode = "poll";
    this.d.notify({ kind: "linked", level: "info", text: `WhatsApp is linked${number ? ` (+${number})` : ""}. Your chats are read every ${this.frequency} minutes, and nothing is sent without being asked.` });
    await this.reschedule();
    // The first connection also brings the history sync: stay for it, then let go (poll mode).
    void this.soft(async () => {
      await this.waitFor(s, () => s.drained || !!s.closed, this.t.firstSyncMs);
      await this.quiet(s, this.t.firstQuietMs, this.t.firstQuietMaxMs);
      this.store.prune(this.d.now());
      this.setMeta("last_poll_at", this.d.now());
      this.closeSession(s);
      this.setMeta("next_poll_at", this.d.now() + frequencyMs(this.frequency));
      await this.reschedule();
    });
  }

  // ----- polling ----------------------------------------------------------------------------------------------------

  /** Connects, takes what is queued, disconnects. Called by the alarm and by "check now". Concurrent calls share one check. */
  poll(): Promise<PollResult> {
    if (this.polling) return this.polling;
    const run = this.exclusive(() => this.runPoll()).finally(() => {
      this.polling = undefined;
    });
    this.polling = run;
    return run;
  }

  private async runPoll(): Promise<PollResult> {
    const at = this.d.now();
    if (this.state !== "linked") return { ok: false, error: this.state === "logged_out" ? "WhatsApp was unlinked from the phone; pair it again." : "WhatsApp is not linked.", at };
    let s: Session | undefined;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        s = await this.openSession("poll");
        if (s.closed?.reason !== "restart_required") break;
      }
      if (!s) throw new WaError("No connection.");
      if (this.state !== "linked") return { ok: false, error: "WhatsApp was unlinked.", at };
      if (!s.open) throw new WaError(this.closedWords(s));
      await this.waitFor(s, () => s!.drained || !!s!.closed, this.t.pollMaxMs);
      if (!s.closed) await this.quiet(s, this.t.quietMs, this.t.quietMaxMs);
      if (s.closed?.reason === "logged_out") return { ok: false, error: "WhatsApp was unlinked from the phone; pair it again.", at };
      const fresh = s.fresh.length;
      const cut = s.closed && !s.drained ? this.closedWords(s) : undefined;
      this.closeSession(s);
      this.store.prune(this.d.now());
      // What did arrive is kept and handed on even when the connection dropped before the queue was finished.
      await this.flush(s);
      return cut ? this.failed(cut) : this.succeeded(fresh);
    } catch (e) {
      this.closeSession(s);
      return this.failed(msg(e));
    }
  }

  private closedWords(s: Session): string {
    const why = s.closed;
    if (!why) return "WhatsApp did not answer in time.";
    if (why.reason === "forbidden") return "WhatsApp refused the connection (the number may be restricted).";
    if (why.reason === "replaced") return "Another session took over this linked device.";
    return `The connection to WhatsApp closed${why.detail ? `: ${why.detail}` : ""}.`;
  }

  private succeeded(newMessages: number): PollResult {
    const now = this.d.now();
    const before = this.num("failures") ?? 0;
    this.setMeta("last_poll_at", now);
    this.setMeta("failures", null);
    this.setMeta("last_error", null);
    this.setMeta("next_poll_at", now + frequencyMs(this.frequency));
    if (before >= FAILURES_BEFORE_NOTICE) this.d.notify({ kind: "recovered", level: "info", text: "WhatsApp is being read again." });
    void this.reschedule();
    return { ok: true, newMessages, at: now };
  }

  private failed(error: string): PollResult {
    const now = this.d.now();
    const n = (this.num("failures") ?? 0) + 1;
    this.setMeta("failures", n);
    this.setMeta("last_error", error);
    const interval = frequencyMs(this.frequency);
    this.setMeta("next_poll_at", now + Math.min(interval, this.backoff(n)));
    if (n === FAILURES_BEFORE_NOTICE) this.d.notify({ kind: "failing", level: "warn", text: `Slimefolk could not check WhatsApp ${n} times in a row: ${error}` });
    void this.reschedule();
    return { ok: false, error, at: now };
  }

  // ----- the alarm and what the object does after a restart ---------------------------------------------------------

  async alarm(): Promise<void> {
    const now = this.d.now();
    const state = this.state;
    try {
      if (state === "pairing") {
        const p = this.json<WhatsAppPairing>("pairing");
        if (!p || now >= p.expiresAt) await this.cancelPairing("The code expired. Start again when you are ready to type it.");
      } else if (state === "linked") {
        if (now >= (this.num("next_poll_at") ?? 0)) await this.poll();
      }
    } finally {
      await this.reschedule();
    }
  }

  /** After the object was created again (evicted, deployed): what was in flight is gone; what is stored carries on. */
  async boot(): Promise<void> {
    if (this.state === "pairing") {
      // The connection that held the code died with the object; the code is useless.
      await this.failPairing("The pairing was interrupted. Start it again.");
      return;
    }
    if (this.state === "linked" && this.num("next_poll_at") === undefined) this.setMeta("next_poll_at", this.d.now());
    await this.reschedule();
  }

  /** Sets the one alarm to the earliest thing that needs time to pass. */
  async reschedule(): Promise<void> {
    const now = this.d.now();
    let at: number | null = null;
    if (this.state === "pairing") at = this.json<WhatsAppPairing>("pairing")?.expiresAt ?? now + 1000;
    else if (this.state === "linked") at = Math.max(this.num("next_poll_at") ?? now, now + 1000);
    await this.d.setAlarm(at);
  }

  // ----- settings ---------------------------------------------------------------------------------------------------

  async setFrequency(f: unknown): Promise<WhatsAppStatus> {
    if (!isWhatsAppFrequency(f)) throw new WaError("Choose every 5, 10, 15, 30 or 60 minutes.");
    const before = this.frequency;
    this.setMeta("frequency", String(f));
    if (this.state === "linked" && before !== f) {
      const now = this.d.now();
      const ms = frequencyMs(f);
      const next = this.num("next_poll_at");
      this.setMeta("next_poll_at", next === undefined ? now + ms : Math.min(next, now + ms));
      await this.reschedule();
    }
    return this.status();
  }

  async refresh(): Promise<PollResult> {
    return this.poll();
  }

  // ----- leaving ----------------------------------------------------------------------------------------------------

  private async dropSessions(): Promise<void> {
    this.closeSession(this.pairSession);
    this.pairSession = undefined;
  }

  private async wipeAuth(): Promise<void> {
    for (const k of await this.d.auth.list("")) await this.d.auth.delete(k);
  }

  private async loggedOut(detail?: string): Promise<void> {
    if (this.state === "logged_out" || this.state === "unlinked") return;
    await this.dropSessions();
    await this.wipeAuth();
    const wasPairing = this.state === "pairing";
    this.setMeta("pairing", null);
    if (wasPairing) {
      this.setState("unlinked");
      this.setMeta("last_error", "WhatsApp rejected the pairing. Try again.");
    } else {
      this.setState("logged_out");
      this.setMeta("logged_out_at", this.d.now());
      this.setMeta("last_error", "This device was unlinked from your WhatsApp. Pair it again to carry on.");
      this.d.notify({ kind: "logged_out", level: "warn", text: `WhatsApp was unlinked${detail ? ` (${detail})` : ""}: Slimefolk can no longer read your chats. Link it again under Settings, WhatsApp. What was already stored is still there.` });
    }
    await this.reschedule();
  }

  /** Unlinks: tells WhatsApp (so the device leaves the phone's list) when it can, then forgets the login and everything stored. */
  async unpair(): Promise<WhatsAppStatus> {
    return this.exclusive(async () => {
      const wasLinked = this.state === "linked";
      let s: Session | undefined;
      if (wasLinked) {
        try {
          s = await this.openSession("send");
        } catch {
          s = undefined;
        }
      }
      let told = false;
      if (s?.open && s.conn) {
        try {
          await Promise.race([s.conn.logout(), new Promise((_, no) => setTimeout(() => no(new Error("timeout")), 8000))]);
          told = true;
        } catch {
          told = false;
        }
      }
      await this.dropSessions();
      this.closeSession(s);
      await this.wipeAuth();
      this.store.eraseAll();
      this.d.db.run("DELETE FROM wa_meta WHERE key NOT IN ('frequency', 'seq')");
      this.setState("unlinked");
      if (wasLinked && !told) this.setMeta("last_error", "Unlinked here, but WhatsApp could not be told. Remove Slimefolk under WhatsApp, Linked devices on your phone.");
      await this.d.setAlarm(null);
      return this.status();
    });
  }

  // ----- sending ----------------------------------------------------------------------------------------------------

  /** Sends one text message. `key` (the approval's) makes a repeat find the first result instead of sending twice. */
  async send(jid: string, text: string, key: string): Promise<SendResult> {
    const body = text.trim();
    if (!body) return { ok: false, error: "The message is empty." };
    if (body.length > MAX_SEND_CHARS) return { ok: false, error: `The message is longer than ${MAX_SEND_CHARS} characters.` };
    const given = bareJid(jid);
    if (!/^(\d{5,16}@s\.whatsapp\.net|\d{5,40}@lid|[\d-]{5,40}@g\.us)$/.test(given)) return { ok: false, error: "That is not a WhatsApp chat id." };
    // Either form of a person works: the phone id when the mapping is known, else the id as given.
    const to = this.store.canon(given);
    return this.exclusive(async () => {
      const dup = this.d.db.one<{ id: string; at: number }>("SELECT id, at FROM wa_sent WHERE key = ?", key);
      if (dup) return { ok: true as const, id: dup.id, at: dup.at, duplicate: true };
      if (this.state !== "linked") return { ok: false as const, error: this.state === "logged_out" ? "WhatsApp was unlinked from the phone; pair it again." : "WhatsApp is not linked." };
      const recent = this.d.db.one<{ n: number }>("SELECT count(*) AS n FROM wa_sent WHERE at > ?", this.d.now() - 3_600_000)?.n ?? 0;
      if (recent >= SEND_LIMIT_PER_HOUR) return { ok: false as const, error: `Sent ${recent} messages in the last hour; slow down (WhatsApp can ban numbers that send in bursts).` };
      let s: Session | undefined;
      let conn: WaConnection | undefined;
      try {
        for (let attempt = 0; attempt < 3; attempt++) {
          s = await this.openSession("send");
          if (s.closed?.reason !== "restart_required") break;
        }
        if (!s?.open) return { ok: false as const, error: s ? this.closedWords(s) : "No connection." };
        conn = s.conn!;
        if (to.endsWith("@s.whatsapp.net") && !this.store.hasChat(to)) {
          const found = await conn.lookup(digitsOf(to));
          if (!found) return { ok: false as const, error: "That number is not on WhatsApp." };
        }
        const sent = await conn.sendText(to, body);
        const at = this.d.now();
        this.d.db.run("INSERT INTO wa_sent (key, jid, id, at) VALUES (?, ?, ?, ?)", key, to, sent.id, at);
        this.store.addMessages([{ id: sent.id, chat: to, sender: `${this.meta("number") ?? "me"}@s.whatsapp.net`, fromMe: true, at, text: body, kind: "text" }], "sent");
        await this.waitFor(s, () => !!s!.closed, this.t.sendLingerMs);
        return { ok: true as const, id: sent.id, at };
      } catch (e) {
        return { ok: false as const, error: `Could not send: ${msg(e)}` };
      } finally {
        if (s) {
          this.closeSession(s);
          await this.flush(s);
        }
      }
    });
  }

  // ----- reading ----------------------------------------------------------------------------------------------------

  /** Private, account-scoped RPC. The metadata dies with the existing message row; audio is never stored. */
  async fetchVoiceNote(chat: string, id: string): Promise<import("../contract/index.ts").WaVoiceNote> {
    if (typeof chat !== "string" || typeof id !== "string" || chat.length > 200 || id.length > 200) return { status: "unavailable" };
    const row = this.d.db.one<{ voice: string | null }>("SELECT voice FROM wa_messages WHERE chat = ? AND id = ? AND kind = 'voice note'", this.store.canon(chat), id);
    if (!row?.voice) return { status: "unavailable" };
    try {
      const adapter = await this.d.adapter();
      return adapter.fetchVoiceNote ? await adapter.fetchVoiceNote(JSON.parse(row.voice)) : { status: "unavailable" };
    } catch {
      return { status: "failed" };
    }
  }

  chats(limit = 30, unreadOnly = false): WhatsAppChatView[] {
    return this.store.chats({ limit: Math.min(100, Math.max(1, limit)), unreadOnly });
  }

  chatPage(q: WhatsAppChatQuery): WhatsAppChatPage {
    const before = q.before === undefined ? undefined : parseChatCursor(q.before);
    if (q.before !== undefined && !before) throw new WaError("That is not a page cursor. Pass the `before` value the previous result gave.", 400);
    if (q.since !== undefined && !(Number.isFinite(q.since) && q.since >= 0)) throw new WaError("`since` must be a time in milliseconds.", 400);
    return this.store.chatPage({
      limit: Math.min(100, Math.max(1, Math.trunc(q.limit ?? 20))),
      ...(q.unreadOnly ? { unreadOnly: true } : {}),
      ...(q.since !== undefined ? { since: q.since } : {}),
      ...(q.includeArchived !== undefined ? { includeArchived: q.includeArchived } : {}),
      ...(q.members === true ? { members: true } : {}),
      ...(before ? { before } : {}),
    });
  }

  chatInfo(jid: string) {
    return this.store.chatInfo(jid);
  }

  resolve(ref: string) {
    return this.store.resolve(ref);
  }

  messages(chat: string, o: { since?: number; limit?: number }): WhatsAppMessageView[] {
    return this.store.messages(chat, { ...(o.since !== undefined ? { since: o.since } : {}), limit: Math.min(200, Math.max(1, o.limit ?? 30)) });
  }

  search(query: string, o: { limit?: number; chat?: string }): WhatsAppMessageView[] {
    return this.store.search(query, { limit: Math.min(100, Math.max(1, o.limit ?? 20)), ...(o.chat ? { chat: o.chat } : {}) });
  }

  // ----- older messages on request --------------------------------------------------------------------------

  /**
   * Asks the phone for earlier messages of one chat, from before the oldest one stored, and stores what comes back as history.
   * Needs the phone online (the answer is an ON_DEMAND history sync over the open connection) and one stored message to start
   * from. A phone that does not answer is reported, not recorded as "no more": a later call tries again. Rate-limited per chat and
   * in all, because WhatsApp can flag an account that asks in bursts. An answer with nothing older marks the chat complete.
   */
  async fetchOlder(q: WaOlderQuery): Promise<WaOlderResult> {
    const raw = q && typeof q === "object" && typeof q.chat === "string" ? bareJid(q.chat.trim()) : "";
    if (!/^(\d{5,16}@s\.whatsapp\.net|\d{5,40}@lid|[\d-]{5,40}@g\.us)$/.test(raw)) throw new WaError("That is not a WhatsApp chat id.", 400);
    const asked = typeof q.count === "number" && Number.isFinite(q.count) ? Math.trunc(q.count) : OLDER_DEFAULT;
    const count = Math.min(OLDER_MAX, Math.max(OLDER_MIN, asked));
    const chat = this.store.canon(raw);
    return this.exclusive(() => this.runOlder(chat, count));
  }

  private async runOlder(chat: string, count: number): Promise<WaOlderResult> {
    const chatName = this.store.displayName(chat);
    const result = (status: WaOlderResult["status"], message: string, extra: Partial<WaOlderResult> = {}): WaOlderResult => ({
      status,
      chat,
      chatName,
      added: 0,
      stored: this.store.chatInfo(chat).stored,
      oldestAt: this.store.oldest(chat)?.at ?? null,
      message,
      ...extra,
    });
    if (this.state !== "linked") return result("unavailable", this.state === "logged_out" ? "WhatsApp was unlinked from the phone; pair it again." : "WhatsApp is not linked.");
    if (this.meta(`older_done:${chat}`)) return result("complete", "The phone has nothing older for this chat: all of its history that WhatsApp keeps is stored.");
    const anchor = this.store.oldest(chat);
    if (!anchor) return result("no_anchor", "No message of this chat is stored, and WhatsApp can only be asked for messages from before one it has. Newer messages will appear as they arrive; then older ones can be asked for.");

    // Pace: the same chat no more than every few minutes, any two asks apart, and a few an hour.
    const now = this.d.now();
    const t = this.t;
    const log = (this.json<number[]>("older_log") ?? []).filter((at) => now - at < 3_600_000);
    const wait = Math.max(
      (this.num(`older_at:${chat}`) ?? 0) + t.olderChatCooldownMs - now,
      (log.length ? log[log.length - 1]! : 0) + t.olderGapMs - now,
      log.length >= t.olderPerHour ? log[0]! + 3_600_000 - now : 0,
    );
    if (wait > 0) {
      const mins = Math.max(1, Math.ceil(wait / 60_000));
      return result("rate_limited", `Asked the phone for older messages too recently (WhatsApp can flag an account that asks in bursts). Try again in about ${wait < 60_000 ? `${Math.ceil(wait / 1000)} seconds` : `${mins} minute${mins === 1 ? "" : "s"}`}.`, { retryInMs: wait });
    }

    let s: Session | undefined;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        s = await this.openSession("older");
        if (s.closed?.reason !== "restart_required") break;
      }
      if (!s?.open) return result("unavailable", s ? this.closedWords(s) : "No connection.");
      // What was queued while the device was away comes first; the ask goes in behind it.
      await this.waitFor(s, () => s!.drained || !!s!.closed, t.pollMaxMs);
      const conn = s.conn;
      if (!s!.open || !conn?.fetchHistory) return result("unavailable", s!.open ? "This connection to WhatsApp cannot ask the phone for older messages." : this.closedWords(s!));
      s!.older = { forms: new Set(this.store.forms(chat)), batches: 0, added: 0 };
      // The ask counts against the pace from here, whether or not the phone answers.
      this.setMeta(`older_at:${chat}`, now);
      this.setMeta("older_log", JSON.stringify([...log, now]));
      await conn.fetchHistory(count, anchor);
      await this.waitFor(s!, () => s!.older!.batches > 0 || !!s!.closed, t.olderWaitMs);
      if (s!.older.batches === 0) {
        return result("no_answer", s!.closed ? `The connection to WhatsApp closed before the phone answered. Try again later.` : "The phone didn't answer. It may be switched off, offline or asleep; open WhatsApp on it and try again in a few minutes.");
      }
      // The answer can come in several parts.
      if (!s!.closed) await this.quiet(s!, t.olderQuietMs, t.olderQuietMaxMs);
      const added = s!.older.added;
      if (added === 0) {
        this.setMeta(`older_done:${chat}`, 1);
        return result("complete", "The phone had nothing older for this chat: all of its history that WhatsApp keeps is stored.");
      }
      return result("loaded", `Stored ${added} older message${added === 1 ? "" : "s"}.`, { added, anchor: { at: anchor.at, chat: anchor.chat, id: anchor.id } });
    } catch (e) {
      return result("unavailable", `Could not ask the phone: ${msg(e)}`);
    } finally {
      if (s) {
        s.older = undefined;
        this.closeSession(s);
        await this.flush(s);
      }
    }
  }

  /** A walk over the stored messages. Read-only; a bad cursor is refused, never guessed at. */
  history(q: WaHistoryQuery): WaHistoryPage {
    const q0 = q && typeof q === "object" ? q : {};
    const key = (k: unknown, what: string): WaHistoryKey | undefined => {
      if (k === undefined || k === null) return undefined;
      const o = k as Partial<WaHistoryKey>;
      if (!o || typeof o.at !== "number" || !Number.isFinite(o.at) || o.at < 0 || typeof o.chat !== "string" || typeof o.id !== "string" || o.chat.length > 200 || o.id.length > 200) {
        throw new WaError(`\`${what}\` must be {at, chat, id}: the key of the last message you have.`, 400);
      }
      return { at: o.at, chat: o.chat, id: o.id };
    };
    const after = key(q0.after, "after");
    const before = key(q0.before, "before");
    if (q0.order !== undefined && q0.order !== "asc" && q0.order !== "desc") throw new WaError("`order` is asc or desc.", 400);
    if (after && before) throw new WaError("Give `after` or `before`, not both.", 400);
    if (q0.since !== undefined && !(Number.isFinite(q0.since) && q0.since >= 0)) throw new WaError("`since` must be a time in milliseconds.", 400);
    if (q0.afterSeq !== undefined && !(Number.isInteger(q0.afterSeq) && q0.afterSeq >= 0)) throw new WaError("`afterSeq` must be a whole number, the last store sequence you have.", 400);
    if (q0.afterSeq !== undefined && (after || before)) throw new WaError("Give `afterSeq` or a key, not both.", 400);
    if ((q0.chat !== undefined && (typeof q0.chat !== "string" || q0.chat.length > 200)) || (q0.id !== undefined && (typeof q0.id !== "string" || q0.id.length > 200))) throw new WaError("`chat` and `id` must be short strings.", 400);
    const r = this.store.history({
      ...(after ? { after } : {}),
      ...(before ? { before } : {}),
      ...(q0.order ? { order: q0.order } : before ? { order: "desc" as const } : {}),
      limit: Math.min(HISTORY_MAX, Math.max(1, Math.trunc(q0.limit ?? HISTORY_DEFAULT))),
      ...(q0.chat ? { chat: q0.chat } : {}),
      ...(q0.id ? { id: q0.id } : {}),
      ...(q0.since !== undefined ? { since: q0.since } : {}),
      ...(q0.afterSeq !== undefined ? { afterSeq: q0.afterSeq } : {}),
    });
    return { ...r, state: this.state, retain: { days: RETAIN_MS / 86_400_000, maxMessages: MAX_MESSAGES } };
  }

  nameOf(jid: string): string {
    return this.store.displayName(jid);
  }

  /** The phone already said this chat has nothing older (`fetchOlder` answers `complete` without asking it again). */
  olderComplete(jid: string): boolean {
    return !!this.meta(`older_done:${this.store.canon(jid)}`);
  }

  numberOf(jid: string): string {
    return numberOf(this.store.canon(jid));
  }

  /** Whether a login is stored (the adapter keeps the credentials under AUTH_CREDS_KEY). */
  async hasLogin(): Promise<boolean> {
    return (await this.d.auth.get(AUTH_CREDS_KEY)) !== null;
  }
}
