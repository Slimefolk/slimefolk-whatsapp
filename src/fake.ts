// A scripted stand-in for the WhatsApp Web protocol (the `WaAdapter` seam), for the tests of the object and the Settings page.
// No network, no library: a test queues what "WhatsApp" has waiting for the linked device, says when the phone enters the pairing
// code or unlinks the device, and reads back what was sent. Events are delivered asynchronously, like a socket's.
import { AUTH_CREDS_KEY, type AuthKv, type WaAdapter, type WaConnectOptions, type WaConnection, type WaEvents, type WaGroup, type WaGroupChange, type WaHistoryBatch, type WaMessage } from "./adapter.ts";

interface Conn {
  events: WaEvents;
  open: boolean;
  closed: boolean;
}

export class FakeWhatsApp implements WaAdapter {
  /** Every connection attempt, with its kind. */
  readonly connects: string[] = [];
  readonly sent: Array<{ jid: string; text: string }> = [];
  /** Waiting for the device: delivered right after the next connection opens, then cleared. */
  offline: WaMessage[] = [];
  history: WaHistoryBatch | undefined;
  /** Every "older messages please" the object sent. */
  readonly historyRequests: Array<{ count: number; anchor: { chat: string; id: string; fromMe: boolean; at: number } }> = [];
  /** What the phone answers each request with, one entry per request: the messages, or "silent" (never answers). With none queued it answers with nothing. */
  olderAnswers: Array<WaMessage[] | "silent"> = [];
  /** The groups WhatsApp knows (jid to metadata), for `groupMetadata`; `groupFetches` records each ask. */
  groups = new Map<string, WaGroup>();
  readonly groupFetches: string[] = [];
  /** Group events waiting for the next connection to open, delivered right after it does (like `offline`), then cleared. */
  queuedGroups: WaGroup[] = [];
  queuedChanges: WaGroupChange[] = [];
  /** What WhatsApp's own mapping store knows (lid to phone jid), for `pnForLid`. */
  lidKnown = new Map<string, string>();
  /** The code the "phone" is shown. */
  pairingCode = "ABCD1234";
  /** The next connect throws this. */
  failNext: Error | undefined;
  /** The next connection opens and then closes with this reason. */
  dropNext: { reason: Parameters<WaEvents["close"]>[0]; detail?: string } | undefined;
  /** The next connection never opens (WhatsApp does not answer). */
  silentNext = false;
  /** Numbers that are on WhatsApp, for `lookup`. */
  registered = new Set<string>();
  /** The login is dead on WhatsApp's side (the phone removed the device). */
  unlinked = false;
  /** Do not send `drained` (a queue that never finishes). */
  noDrain = false;
  private conns: Conn[] = [];
  private pairing: { auth: AuthKv; events: WaEvents; phone: string } | undefined;
  private seq = 0;

  // ----- the test's controls ----------------------------------------------------------------------------------------

  /** The person types the code on their phone: WhatsApp accepts the pairing, then asks for a fresh connection. */
  async enterCode(name = "Alice"): Promise<void> {
    const p = this.pairing;
    if (!p) throw new Error("no pairing in progress");
    this.pairing = undefined;
    await p.auth.put(AUTH_CREDS_KEY, JSON.stringify({ me: { id: `${p.phone}:7@s.whatsapp.net`, name }, registered: true }));
    await p.auth.put("session-1", "sealed-signal-session");
    this.unlinked = false;
    setTimeout(() => this.closeAll("restart_required"), 0);
  }

  /** The person removes the device under WhatsApp, Linked devices. */
  unlinkFromPhone(): void {
    this.unlinked = true;
    this.closeAll("logged_out");
  }

  /** A message arrives while a connection is open. */
  push(messages: WaMessage[]): void {
    for (const c of this.conns) if (c.open && !c.closed) setTimeout(() => c.events.messages(messages, "live"), 0);
  }

  /** WhatsApp sends a `lid-mapping.update` on every open connection. */
  mapLid(lid: string, pn: string): void {
    for (const c of this.conns) if (c.open && !c.closed) setTimeout(() => c.events.lidMappings([{ lid, pn }]), 0);
  }

  /** WhatsApp describes groups on every open connection (`groups.upsert`). */
  pushGroups(groups: WaGroup[]): void {
    for (const c of this.conns) if (c.open && !c.closed) setTimeout(() => c.events.groups(groups), 0);
  }

  /** A group's member list changes on every open connection (`group-participants.update`). */
  pushGroupChange(change: WaGroupChange): void {
    for (const c of this.conns) if (c.open && !c.closed) setTimeout(() => c.events.groupChange(change), 0);
  }

  /** The connection drops under the object. */
  drop(reason: Parameters<WaEvents["close"]>[0] = "connection_lost", detail?: string): void {
    this.closeAll(reason, detail);
  }

  get openConnections(): number {
    return this.conns.filter((c) => c.open && !c.closed).length;
  }

  qrNow(qr: string): void {
    for (const c of this.conns) c.events.qr(qr);
  }

  private closeAll(reason: Parameters<WaEvents["close"]>[0], detail?: string): void {
    for (const c of this.conns) {
      if (c.closed) continue;
      c.closed = true;
      c.open = false;
      c.events.close(reason, detail);
    }
  }

  // ----- the adapter ------------------------------------------------------------------------------------------------

  async connect(o: WaConnectOptions): Promise<WaConnection> {
    if (this.failNext) {
      const e = this.failNext;
      this.failNext = undefined;
      throw e;
    }
    const conn: Conn = { events: o.events, open: false, closed: false };
    this.conns.push(conn);
    const creds = await o.auth.get(AUTH_CREDS_KEY);
    const pairing = o.pairPhone !== undefined || o.pairQr === true;
    this.connects.push(pairing ? (o.pairPhone ? "pair-code" : "pair-qr") : "login");
    const connection: WaConnection = {
      ...(o.pairPhone ? { pairingCode: this.pairingCode } : {}),
      sendText: async (jid, text) => {
        if (conn.closed) throw new Error("connection closed");
        this.sent.push({ jid, text });
        return { id: `SENT${++this.seq}` };
      },
      fetchHistory: async (count, anchor) => {
        if (conn.closed) throw new Error("connection closed");
        this.historyRequests.push({ count, anchor });
        const answer = this.olderAnswers.shift() ?? [];
        if (answer === "silent") return;
        setTimeout(() => {
          if (!conn.closed) o.events.history({ chats: [], contacts: [], messages: answer, onDemand: true });
        }, 0);
      },
      pnForLid: async (lid) => this.lidKnown.get(lid) ?? null,
      groupMetadata: async (jid) => {
        if (conn.closed) throw new Error("connection closed");
        this.groupFetches.push(jid);
        return this.groups.get(jid) ?? null;
      },
      lookup: async (phone) => (this.registered.has(phone) ? `${phone}@s.whatsapp.net` : null),
      logout: async () => {
        this.unlinked = true;
        await o.auth.delete(AUTH_CREDS_KEY);
        this.closeAll("logged_out");
      },
      close: () => {
        if (conn.closed) return;
        conn.closed = true;
        conn.open = false;
        setTimeout(() => o.events.close("other", "closed by us"), 0);
      },
    };
    if (pairing) {
      if (o.pairPhone) this.pairing = { auth: o.auth, events: o.events, phone: o.pairPhone };
      else setTimeout(() => o.events.qr("2@fake-qr-1,fake,fake"), 0);
      return connection;
    }
    setTimeout(() => {
      if (this.silentNext) {
        this.silentNext = false;
        return;
      }
      if (!creds || this.unlinked) {
        conn.closed = true;
        return o.events.close("logged_out", "401");
      }
      if (this.dropNext) {
        const d = this.dropNext;
        this.dropNext = undefined;
        conn.closed = true;
        return o.events.close(d.reason, d.detail);
      }
      const me = (JSON.parse(creds) as { me: { id: string; name?: string } }).me;
      conn.open = true;
      o.events.open(me);
      if (this.history) {
        o.events.history(this.history);
        this.history = undefined;
      }
      if (this.queuedGroups.length) {
        o.events.groups(this.queuedGroups);
        this.queuedGroups = [];
      }
      for (const c of this.queuedChanges.splice(0)) o.events.groupChange(c);
      if (this.offline.length) {
        o.events.messages(this.offline, "offline");
        this.offline = [];
      }
      if (!this.noDrain) o.events.drained();
    }, 0);
    return connection;
  }
}

/** A message in the shape the adapter reports, for tests. */
export function waMsg(over: Partial<WaMessage> & { id: string }): WaMessage {
  return { chat: "15550100@s.whatsapp.net", sender: "15550100@s.whatsapp.net", fromMe: false, at: Date.now(), text: "hello", kind: "text", ...over };
}
