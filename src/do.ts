// The WhatsApp object: one Durable Object per account. It holds the linked-device
// login sealed under the key-encryption key, the chats and messages it pulled, and runs the polling on its timer. The logic is
// `WhatsAppCore`; this file gives it SQLite, the sealed store, the alarm and the way back to the caller (one signed webhook).
// The protocol library is loaded only when a connection is opened (baileys.ts), so an account that never links WhatsApp never pays for it.
import { DurableObject } from "cloudflare:workers";
import { getText } from "./seal.ts";
import {
  signWhatsAppHook,
  type PollResult,
  type SendResult,
  type WaHistoryPage,
  type WaHistoryQuery,
  type WaNewMessage,
  type WaNotice,
  type WaOlderQuery,
  type WaOlderResult,
  type WaReply,
  type WaResolved,
  type WhatsAppChatPage,
  type WhatsAppChatQuery,
  type WhatsAppChatView,
  type WhatsAppFrequency,
  type WhatsAppHook,
  type WhatsAppMessageView,
  type WhatsAppStatus,
} from "../contract/index.ts";
import type { WaAdapter } from "./adapter.ts";
import { WaError, WhatsAppCore } from "./core.ts";
import { WA_EXPECTED_COLUMNS, WA_MIGRATIONS } from "./schema.ts";
import { Db, lazyEncryptedStore, NotConfigured, runMigrations, sealedAuth, verifySchema } from "./sql.ts";
import { oneTimer, type OneTimer } from "./timer.ts";
import { waTestHooks } from "./testing.ts";

export interface WaEnv {
  KEY_ENCRYPTION_KEY?: string;
  KEY_ENCRYPTION_KEY_PREVIOUS?: string;
}

/** A refusal is data, not a thrown class (a thrown class would lose its status over RPC). */
async function reply<T>(run: () => Promise<T> | T): Promise<WaReply<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (e) {
    if (e instanceof WaError) return { ok: false, error: e.message, status: e.status };
    if (e instanceof NotConfigured) return { ok: false, error: e.message, status: 503 };
    console.warn("whatsapp: unexpected", e instanceof Error ? e.message : e);
    return { ok: false, error: "Something went wrong with WhatsApp. Try again in a minute.", status: 500 };
  }
}

const HOOK_NS = "whatsapp-hook";
const HOOK_KEY = "config";

/** The one timer of this object: the earliest thing that needs time to pass, which the core works out (`reschedule`). */
const TICK = "whatsapp.tick";

export class WhatsApp extends DurableObject<WaEnv> {
  readonly db: Db;
  private readonly core: WhatsAppCore;
  private readonly sealed: ReturnType<typeof lazyEncryptedStore>;
  readonly clock: OneTimer;

  constructor(ctx: DurableObjectState, env: WaEnv) {
    super(ctx, env);
    this.db = new Db(ctx.storage);
    runMigrations(this.db, WA_MIGRATIONS);
    verifySchema(this.db, WA_EXPECTED_COLUMNS);
    this.sealed = lazyEncryptedStore(this.db, env);
    this.core = new WhatsAppCore({
      db: this.db,
      auth: sealedAuth(this.sealed.store),
      adapter: () => this.adapter(),
      now: () => (waTestHooks().now ?? Date.now)(),
      // The core arms the one timer; while the timer itself is running its asks are folded into the run's answer (timer.ts).
      setAlarm: (at) => this.clock.arm(TICK, at),
      notify: (n) => void this.tell(n),
      deliver: (items) => this.hand(items),
      available: () => this.sealed.configured,
      timing: () => waTestHooks().timing ?? {},
      log: (event, data) => void this.post({ type: "event", name: event, data: data ?? {} }).catch(() => undefined),
    });
    this.clock = oneTimer(ctx.storage, TICK);
    // A new instance has lost every connection: what was in flight is dropped, what is stored carries on.
    ctx.blockConcurrencyWhile(() => this.clock.start().then(() => this.core.boot()).catch((e: unknown) => console.warn("whatsapp: boot", e instanceof Error ? e.message : e)));
  }

  /** The platform calls this when the timer is due. A failed check is retried by the core's own backoff; a throw here is retried by the platform. */
  override async alarm(): Promise<void> {
    await this.clock.fire(() => this.core.alarm());
  }

  /** The account this object belongs to: the name it was made under. */
  get account(): string {
    return this.ctx.id.name ?? "main";
  }

  private async adapter(): Promise<WaAdapter> {
    const fake = waTestHooks().adapter;
    if (fake) return fake;
    const { baileysAdapter } = await import("./baileys.ts");
    return baileysAdapter();
  }

  // ----- The way back to the caller ----------------------------------------------------------------------------------

  private async hook(): Promise<{ hookUrl: string; secret: string } | undefined> {
    const raw = await getText(this.sealed.store, HOOK_NS, HOOK_KEY).catch(() => null);
    if (!raw) return undefined;
    try {
      const v = JSON.parse(raw) as { hookUrl?: string; secret?: string };
      return v.hookUrl && v.secret ? { hookUrl: v.hookUrl, secret: v.secret } : undefined;
    } catch {
      return undefined;
    }
  }

  /** One signed POST. A receiver that is restarting gets one retry; after that the change stays in the store (messages) or is dropped (a notice is repeated by status). */
  private async post(body: WhatsAppHook): Promise<void> {
    const cfg = await this.hook();
    if (!cfg) return;
    const text = JSON.stringify(body);
    const at = (waTestHooks().now ?? Date.now)();
    const headers = { "content-type": "application/json", "x-slimefolk-account": this.account, "x-slimefolk-timestamp": String(at), "x-slimefolk-signature": await signWhatsAppHook(cfg.secret, at, text) };
    const send = async (): Promise<boolean> => {
      const hooks = waTestHooks();
      const r = hooks.post ? await hooks.post(cfg.hookUrl, { headers, body: text }) : await fetch(cfg.hookUrl, { method: "POST", headers, body: text });
      return r.ok;
    };
    if (!(await send().catch(() => false))) await send().catch(() => false);
  }

  private async tell(n: WaNotice): Promise<void> {
    try {
      await this.post({ type: "notice", notice: n });
    } catch (e) {
      console.warn("whatsapp: could not tell the caller", e instanceof Error ? e.message : e);
    }
  }

  /** The receiving webhook takes at most 256 KB: a big batch goes in several posts. */
  private async hand(items: WaNewMessage[]): Promise<void> {
    let batch: WaNewMessage[] = [];
    let size = 0;
    for (const item of items) {
      const n = new TextEncoder().encode(JSON.stringify(item)).byteLength;
      if (batch.length && size + n > 150_000) {
        await this.post({ type: "messages", items: batch });
        batch = [];
        size = 0;
      }
      batch.push(item);
      size += n;
    }
    if (batch.length) await this.post({ type: "messages", items: batch });
  }

  // ----- RPC: the shape of `WhatsAppRpc` (contract/types.ts), each answer wrapped in a WaReply -------------------------------

  status(): Promise<WaReply<WhatsAppStatus>> {
    return reply(async () => {
      const hookUrl = (await this.hook())?.hookUrl;
      return { ...this.core.status(), ...(hookUrl ? { hookUrl } : {}) };
    });
  }
  startPairing(o: { method: "code" | "qr"; phone?: string }): Promise<WaReply<WhatsAppStatus>> {
    return reply(() => this.core.startPairing(o));
  }
  cancelPairing(): Promise<WaReply<WhatsAppStatus>> {
    return reply(() => this.core.cancelPairing());
  }
  unpair(): Promise<WaReply<WhatsAppStatus>> {
    return reply(() => this.core.unpair());
  }
  setFrequency(f: WhatsAppFrequency): Promise<WaReply<WhatsAppStatus>> {
    return reply(() => this.core.setFrequency(f));
  }
  refresh(): Promise<WaReply<PollResult>> {
    return reply(() => this.core.refresh());
  }
  chats(limit?: number, unreadOnly?: boolean): Promise<WaReply<WhatsAppChatView[]>> {
    return reply(() => this.core.chats(limit, unreadOnly));
  }
  chatPage(q: WhatsAppChatQuery): Promise<WaReply<WhatsAppChatPage>> {
    return reply(() => this.core.chatPage(q ?? {}));
  }
  resolve(ref: string): Promise<WaReply<WaResolved>> {
    return reply(() => this.core.resolve(ref));
  }
  messages(chat: string, o: { since?: number; limit?: number }): Promise<WaReply<WhatsAppMessageView[]>> {
    return reply(() => this.core.messages(chat, o));
  }
  search(query: string, o: { limit?: number; chat?: string }): Promise<WaReply<WhatsAppMessageView[]>> {
    return reply(() => this.core.search(query, o));
  }
  history(q: WaHistoryQuery): Promise<WaReply<WaHistoryPage>> {
    return reply(() => this.core.history(q));
  }
  fetchVoiceNote(chat: string, id: string) {
    return reply(() => this.core.fetchVoiceNote(chat, id));
  }
  fetchOlder(q: WaOlderQuery): Promise<WaReply<WaOlderResult>> {
    return reply(() => this.core.fetchOlder(q));
  }
  nameOf(jid: string): Promise<WaReply<{ name: string; number: string; jid?: string; stored?: number; known?: boolean; lastAt?: number; archived?: boolean; olderComplete?: boolean }>> {
    return reply(() => ({ name: this.core.nameOf(jid), number: this.core.numberOf(jid), ...this.core.chatInfo(jid), olderComplete: this.core.olderComplete(jid) }));
  }
  send(jid: string, text: string, key: string): Promise<WaReply<SendResult>> {
    return reply(() => this.core.send(jid, text, key));
  }
  configure(o: { hookUrl: string; secret: string }): Promise<WaReply<{ ok: true }>> {
    return reply(async () => {
      if (!/^https:\/\//.test(o.hookUrl) && !/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(o.hookUrl)) throw new WaError("The webhook address must be https.", 400);
      if (!o.secret || o.secret.length < 16) throw new WaError("The webhook secret is too short.", 400);
      await this.sealed.store.put(HOOK_NS, HOOK_KEY, JSON.stringify({ hookUrl: o.hookUrl, secret: o.secret }));
      return { ok: true as const };
    });
  }

  /** Moves the sealed login and webhook secret to the current key-encryption key (key rotation). */
  async rewrapAll(): Promise<WaReply<{ ok: boolean; rewrapped: number; failed: number }>> {
    return reply(async () => {
      if (!this.sealed.configured) return { ok: true, rewrapped: 0, failed: 0 };
      const r = await (await this.sealed.envelope()).rewrapAll();
      return { ok: r.failed.length === 0, rewrapped: r.rewrapped, failed: r.failed.length };
    });
  }
}
