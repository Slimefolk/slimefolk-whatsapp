import { SELF, abortAllDurableObjects, env, runInDurableObject } from "cloudflare:test";
import { CONTRACT_VERSION, verifyWhatsAppHook, type WaReply, type WhatsAppHook, type WhatsAppStatus } from "../contract/index.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeWhatsApp, waMsg } from "../src/fake.ts";
import type { WhatsApp } from "../src/do.ts";
import { WA_MIGRATIONS } from "../src/schema.ts";
import { runMigrations } from "../src/sql.ts";
import { WaStore } from "../src/store.ts";
import { resetWaTestHooks, waTestHooks } from "../src/testing.ts";

const SECRET = "test-webhook-secret-0123456789";
const HOOK = "https://app.example.test/whatsapp/hook";
let n = 0;
const freshAccount = () => `acct-${Date.now().toString(36)}-${++n}`;

interface Posted {
  url: string;
  headers: Record<string, string>;
  body: string;
}

let fake: FakeWhatsApp;
let posted: Posted[];

beforeEach(() => {
  fake = new FakeWhatsApp();
  posted = [];
  const hooks = waTestHooks();
  hooks.adapter = fake;
  hooks.timing = { connectMs: 1500, pollMaxMs: 1500, quietMs: 30, quietMaxMs: 150, firstSyncMs: 1500, firstQuietMs: 30, firstQuietMaxMs: 150, sendLingerMs: 30, pairMs: 60_000 };
  hooks.post = async (url, init) => {
    posted.push({ url, ...init });
    return { ok: true, status: 200 };
  };
});
afterEach(() => resetWaTestHooks());

const stub = (account: string) => env.WHATSAPP.get(env.WHATSAPP.idFromName(account));
const rpc = (account: string): WhatsApp => stub(account) as unknown as WhatsApp;
/** The fake plays WhatsApp's side, but it touches the account's storage like the real client would: from inside the object. */
/** The timer is due now and the platform wakes the object: the Lifecycle drives the job, which runs the core's check, and the call returns once it has. */
const fire = (account: string) =>
  runInDurableObject(stub(account), async (inst: WhatsApp) => {
    await inst.clock.arm("whatsapp.tick", Date.now());
    await (inst as unknown as { alarm(): Promise<void> }).alarm();
  });
const inDO = <T>(account: string, fn: () => Promise<T> | T): Promise<T> => runInDurableObject(stub(account), async () => fn());
const ok = <T>(r: WaReply<T>): T => {
  if (!r.ok) throw new Error(`refused: ${r.error}`);
  return r.value;
};
const until = async (cond: () => boolean | Promise<boolean>, what: string, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timed out waiting for ${what}`);
};
const hooksOf = (type: WhatsAppHook["type"]) => posted.map((p) => JSON.parse(p.body) as WhatsAppHook).filter((h) => h.type === type);

/** Pairs by code and waits for the link, returning the account. */
async function link(account = freshAccount()): Promise<string> {
  const s = rpc(account);
  ok(await s.configure({ hookUrl: HOOK, secret: SECRET }));
  const pairing = ok(await s.startPairing({ method: "code", phone: "15550100" }));
  expect(pairing.pairing?.code).toBe("ABCD1234");
  await inDO(account, () => fake.enterCode("Alice"));
  await until(async () => ok(await s.status()).state === "linked", "the link");
  // The first connection stays for the history sync, then lets go.
  await until(() => fake.openConnections === 0, "the first sync to finish");
  return account;
}

describe("pairing", () => {
  it("pairs by phone code, reports the code, and links when the phone accepts it", async () => {
    const account = freshAccount();
    const s = rpc(account);
    expect(ok(await s.status())).toMatchObject({ state: "unlinked", frequency: 15, available: true });
    ok(await s.configure({ hookUrl: HOOK, secret: SECRET }));
    const pairing = ok(await s.startPairing({ method: "code", phone: "15550100" }));
    expect(pairing).toMatchObject({ state: "pairing", pairing: { method: "code", code: "ABCD1234", phone: "15550100" } });
    await inDO(account, () => fake.enterCode("Alice"));
    await until(async () => ok(await s.status()).state === "linked", "the link");
    expect(ok(await s.status())).toMatchObject({ state: "linked", number: "15550100", name: "Alice" });
    await until(() => hooksOf("notice").length > 0, "the linked notice");
    expect(hooksOf("notice")[0]).toMatchObject({ notice: { kind: "linked", level: "info" } });
  });

  it("refuses a bad phone number and a pairing when already linked", async () => {
    const s = rpc(freshAccount());
    expect(await s.startPairing({ method: "code", phone: "12" })).toMatchObject({ ok: false, status: 400 });
    const account = await link();
    expect(await rpc(account).startPairing({ method: "code", phone: "15550100" })).toMatchObject({ ok: false, status: 409 });
  });

  it("a QR pairing exposes the QR text", async () => {
    const s = rpc(freshAccount());
    ok(await s.startPairing({ method: "qr" }));
    await until(async () => !!ok(await s.status()).pairing?.qr, "the qr");
    expect(ok(await s.status()).pairing?.qr).toContain("fake-qr");
    expect(ok(await s.cancelPairing()).state).toBe("unlinked");
  });

  it("an interrupted pairing is cleaned up when the object restarts", async () => {
    const account = freshAccount();
    const s = rpc(account);
    ok(await s.startPairing({ method: "code", phone: "15550100" }));
    await fire(account); // not expired: stays
    expect(ok(await s.status()).state).toBe("pairing");
  });
});

describe("polling", () => {
  it("connects, pulls what was queued, stores it, hands the new incoming messages on, and disconnects", async () => {
    const account = await link();
    const s = rpc(account);
    const at = Date.now();
    fake.history = undefined;
    fake.offline = [
      waMsg({ id: "M1", at, text: "lunch at one?", sender: "15550101@s.whatsapp.net", chat: "15550101@s.whatsapp.net", pushName: "Mum" }),
      waMsg({ id: "M2", at: at + 1, text: "my own", fromMe: true, sender: "15550100@s.whatsapp.net", chat: "15550101@s.whatsapp.net" }),
    ];
    posted.length = 0;
    const r = ok(await s.refresh());
    expect(r).toMatchObject({ ok: true, newMessages: 1 });
    expect(fake.openConnections).toBe(0);
    const items = hooksOf("messages").flatMap((h) => (h.type === "messages" ? h.items : []));
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "M1", text: "lunch at one?", pushName: "Mum" });
    expect(items[0]!.savedName).toBeUndefined();
    const msgs = ok(await s.messages("15550101@s.whatsapp.net", {}));
    expect(msgs.map((m) => m.text)).toEqual(expect.arrayContaining(["lunch at one?", "my own"]));
    expect(ok(await s.status()).counts.messages).toBeGreaterThanOrEqual(2);
  });

  it.each(["x", "界"])("delivers a backlog of %s messages within the receiver's webhook byte limit", async (character) => {
    const account = await link();
    const text = character.repeat(8_000);
    const messages = Array.from({ length: 16 }, (_, i) => waMsg({ id: `batch-${i}`, at: Date.now(), text }));
    fake.history = undefined;
    fake.offline = messages;
    posted.length = 0;
    const accepted: WhatsAppHook[] = [];
    waTestHooks().post = async (url, init) => {
      posted.push({ url, ...init });
      if (new TextEncoder().encode(init.body).byteLength > 256 * 1024) return { ok: false, status: 413 };
      accepted.push(JSON.parse(init.body) as WhatsAppHook);
      return { ok: true, status: 200 };
    };

    expect(ok(await rpc(account).refresh())).toMatchObject({ ok: true, newMessages: 16 });
    const delivered = accepted.flatMap((h) => h.type === "messages" ? h.items : []);
    expect(delivered.map((m) => m.id)).toEqual(messages.map((m) => m.id));
    for (const m of delivered) expect(m.text).toBe(text);
    for (const p of posted) expect(new TextEncoder().encode(p.body).byteLength).toBeLessThanOrEqual(256 * 1024);
  });

  it("keeps shared contact names in incoming delivery and history, including multi-contact bundles", async () => {
    const { toWaMessage } = await import("../src/baileys.ts");
    const account = await link();
    const chat = "15550101@s.whatsapp.net";
    const base = { messageTimestamp: Math.floor(Date.now() / 1000) };
    fake.history = undefined;
    fake.offline = [
      toWaMessage({ ...base, key: { id: "single-contact", remoteJid: chat }, message: { contactMessage: { displayName: "Carol", vcard: "BEGIN:VCARD\nFN:Carol\nEND:VCARD" } } }, undefined)!,
      toWaMessage({ ...base, key: { id: "contact-bundle", remoteJid: chat }, message: { contactsArrayMessage: {
        displayName: "Bob and Dana",
        contacts: [{ displayName: "Bob", vcard: "BEGIN:VCARD\nFN:Bob\nEND:VCARD" }, { displayName: "Dana", vcard: "BEGIN:VCARD\nFN:Dana\nEND:VCARD" }],
      } } }, undefined)!,
    ];
    posted.length = 0;
    ok(await rpc(account).refresh());
    const expected = [
      expect.objectContaining({ id: "single-contact", kind: "contact", text: "Carol" }),
      expect.objectContaining({ id: "contact-bundle", kind: "contact", text: "Bob and Dana" }),
    ];
    expect(hooksOf("messages").flatMap((h) => h.type === "messages" ? h.items : [])).toEqual(expect.arrayContaining(expected));
    expect(ok(await rpc(account).history({ chat })).items).toEqual(expect.arrayContaining(expected));
  });

  it("a saved contact name is kept apart from a name the sender chose", async () => {
    const account = await link();
    const s = rpc(account);
    fake.history = {
      chats: [{ jid: "15550102@s.whatsapp.net", name: "Dr Smith", lastAt: Date.now() }],
      contacts: [{ jid: "15550102@s.whatsapp.net", name: "Dr Smith" }],
      messages: [],
    };
    ok(await s.refresh());
    fake.offline = [waMsg({ id: "S1", at: Date.now(), text: "appointment moved", sender: "15550102@s.whatsapp.net", chat: "15550102@s.whatsapp.net", pushName: "Definitely Your Bank" })];
    posted.length = 0;
    ok(await s.refresh());
    const items = hooksOf("messages").flatMap((h) => (h.type === "messages" ? h.items : []));
    expect(items[0]).toMatchObject({ savedName: "Dr Smith", pushName: "Definitely Your Bank" });
  });

  it("a failing connection is reported with a clear error and backs off; recovery is announced after repeated failures", async () => {
    const account = await link();
    const s = rpc(account);
    posted.length = 0;
    for (let i = 0; i < 3; i++) {
      fake.failNext = new Error("dns");
      const r = ok(await s.refresh());
      expect(r.ok).toBe(false);
    }
    expect(ok(await s.status())).toMatchObject({ consecutiveFailures: 3 });
    await until(() => hooksOf("notice").some((h) => h.type === "notice" && h.notice.kind === "failing"), "the failing notice");
    expect(ok(await s.refresh())).toMatchObject({ ok: true });
    await until(() => hooksOf("notice").some((h) => h.type === "notice" && h.notice.kind === "recovered"), "the recovered notice");
  });

  it("detects that the phone unlinked the device, tells the person once, and wipes the login", async () => {
    const account = await link();
    const s = rpc(account);
    posted.length = 0;
    await inDO(account, async () => fake.unlinkFromPhone());
    const r = ok(await s.refresh());
    expect(r.ok).toBe(false);
    await until(async () => ok(await s.status()).state === "logged_out", "the logged-out state");
    const st = ok(await s.status());
    expect(st).toMatchObject({ state: "logged_out", number: "15550100" });
    expect(hooksOf("notice").filter((h) => h.type === "notice" && h.notice.kind === "logged_out")).toHaveLength(1);
    expect(await s.send("15550101@s.whatsapp.net", "hi", "k1")).toMatchObject({ ok: true, value: { ok: false } });
  });
});

describe("frequency and the alarm", () => {
  const alarmOf = (account: string) => runInDurableObject(stub(account), async (_i: WhatsApp, state) => state.storage.getAlarm());

  it("defaults to 15 minutes, takes the listed choices only, and sets the alarm accordingly", async () => {
    const account = await link();
    const s = rpc(account);
    expect(ok(await s.status()).frequency).toBe(15);
    expect(await s.setFrequency(7 as never)).toMatchObject({ ok: false, status: 400 });
    expect(await s.setFrequency("often" as never)).toMatchObject({ ok: false });
    ok(await s.setFrequency(5));
    const alarm = await alarmOf(account);
    expect(alarm).not.toBeNull();
    expect(alarm! - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 1000);
    const st = ok(await s.setFrequency(60));
    expect(st.frequency).toBe(60);
    // Going slower never pushes a check that is due sooner further away.
    expect((await alarmOf(account))! - Date.now()).toBeLessThanOrEqual(5 * 60_000 + 1000);
  });

  it("the one timer is the object's alarm, and a restart finds it again", async () => {
    const account = await link();
    ok(await rpc(account).setFrequency(5));
    const timerOf = (a: string) => runInDurableObject(stub(a), async (inst: WhatsApp) => inst.clock.timers.get("whatsapp.tick")?.at);
    const at = (await timerOf(account))!;
    expect(at).toBeGreaterThan(Date.now());
    expect(await alarmOf(account)).toBe(at);
    await abortAllDurableObjects();
    const after = (await timerOf(account))!;
    // The restart re-arms from the stored poll time, which has not moved.
    expect(after).toBeGreaterThan(Date.now());
    expect(after - at).toBeLessThan(5_000);
    expect(await alarmOf(account)).toBe(after);
  });

  it("the alarm runs a due check", async () => {
    const account = await link();
    const s = rpc(account);
    const before = fake.connects.length;
    waTestHooks().now = () => Date.now() + 20 * 60_000;
    await fire(account);
    expect(fake.connects.length).toBeGreaterThan(before);
    expect(ok(await s.status()).lastPollAt).toBeGreaterThan(Date.now());
  });

  it("has no stay-connected mode: polling is the only one (future work, Slimefolk #746)", async () => {
    const account = await link();
    const s = rpc(account);
    expect(await s.setFrequency("realtime" as never)).toMatchObject({ ok: false, status: 400 });
    expect(ok(await s.status())).toMatchObject({ connected: false, frequency: 15 });
    expect(fake.openConnections).toBe(0);
  });
});

describe("sending", () => {
  it.each(["unregistered", "send error"])("hands incoming messages on and closes its connection after %s", async (failure) => {
    const account = await link();
    const s = rpc(account);
    if (failure === "send error") {
      fake.registered.add("15550109");
      waTestHooks().adapter = {
        connect: async (o) => ({
          ...await fake.connect(o),
          sendText: async () => { throw new Error("connection lost during send"); },
        }),
      };
    }
    const incoming = waMsg({ id: "DURING-SEND", chat: "15550101@s.whatsapp.net", sender: "15550101@s.whatsapp.net", text: "Please move our meeting", at: Date.now() });
    fake.offline = [incoming];
    posted.length = 0;
    expect(ok(await s.send("15550109@s.whatsapp.net", "hello", "failed-send"))).toMatchObject({ ok: false });
    expect(ok(await s.messages(incoming.chat, {}))).toEqual(expect.arrayContaining([expect.objectContaining({ id: incoming.id, text: incoming.text })]));
    expect(hooksOf("messages").flatMap((h) => h.type === "messages" ? h.items : [])).toEqual([expect.objectContaining({ id: incoming.id, text: incoming.text })]);
    expect(fake.openConnections).toBe(0);
    expect(fake.sent).toHaveLength(0);
    fake.offline = [incoming];
    expect(ok(await s.refresh())).toMatchObject({ ok: true, newMessages: 0 });
    expect(hooksOf("messages").flatMap((h) => h.type === "messages" ? h.items : [])).toHaveLength(1);
  });

  it("sends once per key (a repeat finds the first result), and not to a number that is not on WhatsApp", async () => {
    const account = await link();
    const s = rpc(account);
    fake.registered.add("15550109");
    const first = ok(await s.send("15550109@s.whatsapp.net", "hello there", "approval-1"));
    expect(first).toMatchObject({ ok: true });
    const again = ok(await s.send("15550109@s.whatsapp.net", "hello there", "approval-1"));
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(fake.sent).toHaveLength(1);
    expect(ok(await s.send("15550108@s.whatsapp.net", "x", "approval-2"))).toMatchObject({ ok: false, error: "That number is not on WhatsApp." });
    expect(ok(await s.send("15550109@s.whatsapp.net", "   ", "approval-3"))).toMatchObject({ ok: false });
    expect(ok(await s.send("not-a-jid", "hi", "approval-4"))).toMatchObject({ ok: false });
  });

  it("stops at twenty sends an hour", async () => {
    const account = await link();
    const s = rpc(account);
    fake.registered.add("15550109");
    for (let i = 0; i < 20; i++) expect(ok(await s.send("15550109@s.whatsapp.net", `m${i}`, `k${i}`))).toMatchObject({ ok: true });
    expect(ok(await s.send("15550109@s.whatsapp.net", "one too many", "k20"))).toMatchObject({ ok: false });
    expect(fake.sent).toHaveLength(20);
  });
});

describe("unpair", () => {
  it("unlinks on WhatsApp's side, forgets the login and everything stored, and keeps the frequency", async () => {
    const account = await link();
    const s = rpc(account);
    ok(await s.setFrequency(30));
    const st = ok(await s.unpair());
    expect(st).toMatchObject({ state: "unlinked", frequency: 30 });
    expect(st.counts.messages).toBe(0);
    expect(fake.unlinked).toBe(true);
    await runInDurableObject(stub(account), async (_i: WhatsApp, state) => {
      expect(await state.storage.getAlarm()).toBeNull();
      expect(state.storage.sql.exec("SELECT count(*) AS n FROM wa_kv WHERE k LIKE '%whatsapp/creds%'").one().n).toBe(0);
    });
  });
});

describe("the login at rest", () => {
  it("is sealed: nothing readable is in the object's tables", async () => {
    const account = await link();
    const dump = await runInDurableObject(stub(account), async (_i: WhatsApp, state) => JSON.stringify(state.storage.sql.exec("SELECT * FROM wa_kv").toArray()));
    expect(dump).not.toContain("sealed-signal-session");
    expect(dump).not.toContain("registered");
    expect(dump).not.toContain(SECRET);
  });

  it("rewrapAll finds nothing stale when the key has not changed, and the login still works", async () => {
    const account = await link();
    const s = rpc(account);
    const r = ok(await s.rewrapAll());
    expect(r).toMatchObject({ ok: true, failed: 0 });
    expect(ok(await s.refresh())).toMatchObject({ ok: true });
  });
});

describe("the webhook back to the caller", () => {
  it("is signed, carries the account, and verifies with the shared secret", async () => {
    const account = await link();
    expect(posted.length).toBeGreaterThan(0);
    const p = posted.find((x) => (JSON.parse(x.body) as WhatsAppHook).type === "notice")!;
    expect(p.url).toBe(HOOK);
    expect(p.headers["x-slimefolk-account"]).toBe(account);
    const ts = Number(p.headers["x-slimefolk-timestamp"]);
    expect(await verifyWhatsAppHook(SECRET, ts, p.body, p.headers["x-slimefolk-signature"]!, Date.now())).toBe(true);
    expect(await verifyWhatsAppHook("another-secret-0123456789", ts, p.body, p.headers["x-slimefolk-signature"]!, Date.now())).toBe(false);
    expect(await verifyWhatsAppHook(SECRET, ts, p.body + " ", p.headers["x-slimefolk-signature"]!, Date.now())).toBe(false);
    expect(await verifyWhatsAppHook(SECRET, ts, p.body, p.headers["x-slimefolk-signature"]!, ts + 6 * 60_000)).toBe(false);
  });

  it("refuses an insecure address or a short secret", async () => {
    const s = rpc(freshAccount());
    expect(await s.configure({ hookUrl: "http://evil.example.com/hook", secret: SECRET })).toMatchObject({ ok: false, status: 400 });
    expect(await s.configure({ hookUrl: HOOK, secret: "short" })).toMatchObject({ ok: false, status: 400 });
    expect(await s.configure({ hookUrl: "http://localhost:8787/whatsapp/hook", secret: SECRET })).toMatchObject({ ok: true });
  });
});

describe("the worker's JSON interface", () => {
  const call = (method: string, init: { account?: string; body?: string; http?: string } = {}) =>
    SELF.fetch(`https://whatsapp.internal/rpc/${method}`, {
      method: init.http ?? "POST",
      headers: init.account ? { "x-slimefolk-account": init.account } : {},
      ...(init.http === "GET" ? {} : { body: init.body ?? JSON.stringify({ args: [] }) }),
    });

  it("answers a method with a WaReply", async () => {
    const r = await call("status", { account: freshAccount() });
    expect(r.status).toBe(200);
    const body = (await r.json()) as WaReply<WhatsAppStatus>;
    expect(body).toMatchObject({ ok: true, value: { state: "unlinked", frequency: 15 } });
  });

  it("refuses unknown methods, missing or odd accounts, bad bodies and other verbs", async () => {
    expect((await call("destroy", { account: "a" })).status).toBe(404);
    expect((await call("status")).status).toBe(400);
    expect((await call("status", { account: "../x y" })).status).toBe(400);
    expect((await call("status", { account: "a", body: "not json" })).status).toBe(400);
    expect((await call("status", { account: "a", http: "GET" })).status).toBe(404);
    expect((await SELF.fetch("https://whatsapp.internal/")).status).toBe(404);
  });

  it("answers /health for the deploy check without an account and without touching any", async () => {
    const r = await SELF.fetch("https://whatsapp.internal/health");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, service: "slimefolk-whatsapp", contract: CONTRACT_VERSION, release: "unreleased", source: { label: "Source for the WhatsApp program", url: null, identity: "not reported", archive: null } });
    const notices = await (await SELF.fetch("https://whatsapp.internal/licences")).json() as { name: string; text: string }[];
    expect(notices.find((n) => n.name === "AGPL-3.0")?.text).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(notices.find((n) => n.name.includes("Signal file-level"))?.text).toContain("SPDX-License-Identifier: AGPL-3.0-only");
    expect((await SELF.fetch("https://whatsapp.internal/health", { method: "POST" })).status).toBe(404);
  });

  it("checks the arguments against the contract before the account's object sees them", async () => {
    const account = freshAccount();
    const refused = async (method: string, args: unknown): Promise<string> => {
      const r = await call(method, { account, body: JSON.stringify({ args }) });
      expect(r.status).toBe(400);
      const body = (await r.json()) as { ok: false; error: string; status: number };
      expect(body).toMatchObject({ ok: false, status: 400 });
      return body.error;
    };
    expect(await refused("send", ["15550101@s.whatsapp.net", "hi"])).toContain("needs at least 3 items");
    expect(await refused("send", ["15550101@s.whatsapp.net", 5, "k"])).toContain("args[1]: expected string");
    expect(await refused("setFrequency", ["realtime"])).toContain("args[0]: must be one of 5, 10, 15, 30, 60");
    expect(await refused("history", [{ limit: 10, surprise: true }])).toContain("unknown property surprise");
    expect(await refused("status", [1])).toContain("takes at most 0 items");
    expect(await refused("messages", ["15550101@s.whatsapp.net"])).toContain("needs at least 2 items");
    // "Message yourself" is not part of this program.
    expect((await call("sendOwnerFile", { account, body: JSON.stringify({ args: [{}] }) })).status).toBe(404);
    expect((await call("status", { account, body: JSON.stringify({ args: "no" }) })).status).toBe(400);
    expect((await call("status", { account, body: "[]" })).status).toBe(400);
  });

  it("takes an optional argument left out in the middle as null", async () => {
    const r = await call("chats", { account: freshAccount(), body: JSON.stringify({ args: [null, true] }) });
    expect(await r.json()).toEqual({ ok: true, value: [] });
  });

  it("passes arguments through and returns a refusal as data", async () => {
    const r = await call("startPairing", { account: freshAccount(), body: JSON.stringify({ args: [{ method: "code", phone: "1" }] }) });
    expect(await r.json()).toMatchObject({ ok: false, status: 400 });
  });
});

// ----- one person under two ids; paging; chats WhatsApp only summarised ----------------------------------------------

const PN = "15550109@s.whatsapp.net";
const LID = "99887766554433@lid";
const lidMsg = (id: string, over: Partial<Parameters<typeof waMsg>[0]> = {}) => waMsg({ id, chat: LID, sender: LID, at: Date.now(), ...over });

describe("one person under a phone id and a hidden-number id", () => {
  it("a mapping learned late merges the split chats, loses no message and is idempotent", async () => {
    const account = await link();
    const s = rpc(account);
    const t = Date.now();
    fake.history = { chats: [{ jid: PN, name: "Carol", lastAt: t - 5000 }], contacts: [{ jid: PN, name: "Carol" }], messages: [] };
    fake.offline = [
      waMsg({ id: "A1", chat: PN, sender: PN, at: t - 4000, text: "from the phone form" }),
      lidMsg("A2", { at: t - 3000, text: "from the lid form" }),
      lidMsg("A3", { at: t - 2000, text: "same message under both" }),
      waMsg({ id: "A3", chat: PN, sender: PN, at: t - 2000, text: "same message under both" }),
    ];
    ok(await s.refresh());
    // Split: the lid chat has its own messages and the phone chat does not see them.
    expect(ok(await s.messages(PN, {})).map((m) => m.id).sort()).toEqual(["A1", "A3"]);
    expect(ok(await s.messages(LID, {})).map((m) => m.id).sort()).toEqual(["A2", "A3"]);
    expect(ok(await s.chatPage({})).chats.filter((c) => c.jid === LID || c.jid === PN)).toHaveLength(2);

    fake.history = { chats: [], contacts: [], messages: [], lidMappings: [{ lid: LID, pn: PN }] };
    ok(await s.refresh());
    const after = ok(await s.messages(PN, {}));
    expect(after.map((m) => m.id).sort()).toEqual(["A1", "A2", "A3"]);
    expect(after.every((m) => m.chat === PN)).toBe(true);
    expect(ok(await s.chatPage({})).chats.map((c) => c.jid)).toEqual([PN]);
    expect(ok(await s.chatPage({})).chats[0]).toMatchObject({ name: "Carol", stored: 3 });

    // Running the merge again changes nothing.
    const rows = await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      const before = JSON.stringify(inst.db.all("SELECT chat, id FROM wa_messages ORDER BY chat, id"));
      store.learnLids([{ lid: LID, pn: PN }], "again");
      expect(store.mergeKnown()).toBe(0);
      expect(JSON.stringify(inst.db.all("SELECT chat, id FROM wa_messages ORDER BY chat, id"))).toBe(before);
      return { lids: inst.db.all("SELECT chat FROM wa_messages WHERE chat LIKE '%@lid'").length, chatRows: inst.db.all("SELECT jid FROM wa_chats WHERE jid LIKE '%@lid'").length };
    });
    expect(rows).toEqual({ lids: 0, chatRows: 0 });
  });

  it("resolves an old group's id (creator number, hyphen, timestamp) as an id, not a name", async () => {
    const account = await link();
    const s = rpc(account);
    const OLD = "15550110-1500000000@g.us";
    fake.history = { chats: [{ jid: OLD, name: "Alumni Club", lastAt: Date.now() }], contacts: [], messages: [], lidMappings: [] };
    ok(await s.refresh());
    expect(ok(await s.resolve(OLD))).toEqual({ jid: OLD });
    expect(ok(await s.resolve("120363000000000044@g.us"))).toEqual({ jid: "120363000000000044@g.us" });
  });

  it("read, search, resolve and names look through the mapping from either form", async () => {
    const account = await link();
    const s = rpc(account);
    const t = Date.now();
    fake.history = { chats: [{ jid: PN, name: "Carol", lastAt: t }], contacts: [{ jid: PN, name: "Carol" }], messages: [], lidMappings: [{ lid: LID, pn: PN }] };
    fake.offline = [lidMsg("B1", { at: t, text: "dinner on friday?", pushName: "carrie" })];
    ok(await s.refresh());
    for (const form of [PN, LID, "15550109", "Carol"]) {
      const r = ok(await s.resolve(form));
      expect(r, form).toEqual({ jid: PN });
      expect(ok(await s.messages(PN, {})).map((m) => m.text)).toEqual(["dinner on friday?"]);
    }
    expect(ok(await s.messages(LID, {})).map((m) => m.id)).toEqual(["B1"]);
    expect(ok(await s.search("friday", { chat: LID })).map((m) => m.chat)).toEqual([PN]);
    expect(ok(await s.search("friday", {})).map((m) => m.chat)).toEqual([PN]);
    expect(ok(await s.nameOf(LID))).toMatchObject({ name: "Carol", jid: PN, stored: 1, known: true });
  });

  it("learns from the alternate id on a message, from a contact with both ids, and from WhatsApp's own mapping on request", async () => {
    const account = await link();
    const s = rpc(account);
    const t = Date.now();
    const LID2 = "11112222333344@lid";
    const PN2 = "15550110@s.whatsapp.net";
    const LID3 = "55556666777788@lid";
    const PN3 = "15550111@s.whatsapp.net";
    const LID4 = "22223333444455@lid";
    const PN4 = "15550112@s.whatsapp.net";
    fake.history = { chats: [{ jid: PN2, name: "Bob", lastAt: t }], contacts: [{ jid: LID3, altJid: PN3, name: "Frank" }], messages: [] };
    fake.offline = [
      lidMsg("C1", { chat: LID2, sender: LID2, chatAlt: PN2, text: "alt on the message" }),
      lidMsg("C2", { chat: LID4, sender: LID4, text: "only the client knows" }),
    ];
    fake.lidKnown.set(LID4, PN4);
    ok(await s.refresh());
    await until(async () => ok(await s.messages(PN4, {})).length === 1, "the lookup of WhatsApp's own mapping");
    expect(ok(await s.messages(PN2, {})).map((m) => m.id)).toEqual(["C1"]);
    expect(ok(await s.nameOf(PN3))).toMatchObject({ name: "Frank" });
    expect(ok(await s.chatPage({})).chats.filter((c) => c.jid.endsWith("@lid"))).toEqual([]);
  });

  it("sends to either form: the phone form once the mapping is known, the lid form as given while it is not", async () => {
    const account = await link();
    const s = rpc(account);
    ok(await s.refresh());
    expect(ok(await s.send(LID, "to the lid, unmapped", "k-unmapped"))).toMatchObject({ ok: true });
    expect(fake.sent.at(-1)).toEqual({ jid: LID, text: "to the lid, unmapped" });
    fake.history = { chats: [], contacts: [], messages: [], lidMappings: [{ lid: LID, pn: PN }] };
    ok(await s.refresh());
    expect(ok(await s.send(LID, "to the lid, mapped", "k-mapped"))).toMatchObject({ ok: true });
    expect(fake.sent.at(-1)).toEqual({ jid: PN, text: "to the lid, mapped" });
    expect(ok(await s.send(PN, "to the phone", "k-pn"))).toMatchObject({ ok: true });
    expect(fake.sent.at(-1)).toEqual({ jid: PN, text: "to the phone" });
    // What was sent while unmapped is now in the one chat.
    expect(ok(await s.messages(PN, {})).map((m) => m.text)).toEqual(expect.arrayContaining(["to the lid, unmapped", "to the lid, mapped", "to the phone"]));
  });

  it("never pairs the person's own ids with a stranger's, so a mix-up cannot merge or redirect a chat", async () => {
    const account = await link(); // the linked number is 15550100
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      const ME = "15550100@s.whatsapp.net";
      inst.db.run("INSERT INTO wa_meta (key, value) VALUES ('lid', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", "55500011122233@lid");
      // Our number against somebody else's hidden id, and our hidden id against somebody else's number.
      expect(store.learnLids([{ lid: LID, pn: ME }], "mixup")).toMatchObject({ learned: 0, conflicts: 1 });
      expect(store.learnLids([{ lid: "55500011122233@lid", pn: PN }], "mixup")).toMatchObject({ learned: 0, conflicts: 1 });
      expect(store.canon(LID)).toBe(LID);
      // Our own two ids belong together.
      expect(store.learnLids([{ lid: "55500011122233@lid", pn: ME }], "self")).toMatchObject({ learned: 1 });
    });
  });

  it("merging keeps the larger unread count and shows a chat as archived only when both were", async () => {
    const account = await link();
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      inst.db.run("INSERT INTO wa_chats (jid, name, is_group, unread, last_at, archived) VALUES (?, 'A', 0, 2, 100, 1), (?, NULL, 0, 3, 90, 0)", PN, LID);
      store.learnLids([{ lid: LID, pn: PN }], "t");
      expect(inst.db.all("SELECT unread, last_at, archived FROM wa_chats WHERE jid = ?", PN)).toEqual([{ unread: 3, last_at: 100, archived: 0 }]);
    });
  });

  it("a different inferred mapping for a known hidden-number id is ignored, not applied over the first", async () => {
    const account = await link();
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      expect(store.learnLids([{ lid: LID, pn: PN }], "a")).toMatchObject({ learned: 1 });
      expect(store.learnLids([{ lid: LID, pn: "15550199@s.whatsapp.net" }], "b")).toMatchObject({ learned: 0, conflicts: 1 });
      expect(store.canon(LID)).toBe(PN);
      // Junk is dropped: not a lid, not a phone id.
      expect(store.learnLids([{ lid: "x@lid", pn: PN }, { lid: "123456@g.us", pn: PN }], "c")).toMatchObject({ learned: 0 });
    });
  });
});

describe("ranked mapping sources and a number change", () => {
  const PN2 = "15550199@s.whatsapp.net";
  const src = (inst: WhatsApp) => inst.db.all<{ pn: string; source: string }>("SELECT pn, source FROM wa_lid_map WHERE lid = ?", LID);

  it("WhatsApp's own word replaces a guess, and a guess never replaces WhatsApp's word", async () => {
    const account = await link();
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      store.learnLids([{ lid: LID, pn: PN2 }], "message");
      expect(store.learnLids([{ lid: LID, pn: PN }], "history")).toMatchObject({ learned: 1, conflicts: 0 });
      expect(store.canon(LID)).toBe(PN);
      expect(src(inst)).toEqual([{ pn: PN, source: "history" }]);
      // Weaker sources cannot move it back.
      expect(store.learnLids([{ lid: LID, pn: PN2 }], "contact")).toMatchObject({ learned: 0, conflicts: 1 });
      expect(store.learnLids([{ lid: LID, pn: PN2 }], "chat")).toMatchObject({ conflicts: 1 });
      expect(store.canon(LID)).toBe(PN);
      // The same number from a stronger source only upgrades the source.
      store.learnLids([{ lid: LID, pn: PN }], "event");
      expect(src(inst)).toEqual([{ pn: PN, source: "event" }]);
      // A history snapshot is below a live event.
      expect(store.learnLids([{ lid: LID, pn: PN2 }], "history")).toMatchObject({ conflicts: 1 });
      expect(store.canon(LID)).toBe(PN);
    });
  });

  it("a newer WhatsApp mapping replaces the old number, which is kept so earlier messages still resolve", async () => {
    const account = await link();
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      expect(store.learnLids([{ lid: LID, pn: PN }], "event")).toMatchObject({ learned: 1 });
      inst.db.run("INSERT INTO wa_messages (chat, id, sender, push_name, from_me, at, text, kind, source) VALUES (?, 'OLD', ?, NULL, 0, 100, 'before', 'text', 'live')", PN, PN);
      expect(store.learnLids([{ lid: LID, pn: PN2 }], "event")).toMatchObject({ learned: 1, conflicts: 0 });
      expect(store.canon(LID)).toBe(PN2);
      expect(inst.db.all("SELECT lid, pn, source FROM wa_lid_history")).toEqual([{ lid: LID, pn: PN, source: "event" }]);
      inst.db.run("INSERT INTO wa_messages (chat, id, sender, push_name, from_me, at, text, kind, source) VALUES (?, 'NEW', ?, NULL, 0, 200, 'after', 'text', 'live')", PN2, PN2);
      // Either number, or the hidden id, finds the whole person.
      for (const j of [PN, PN2, LID]) expect(store.forms(j)).toEqual(expect.arrayContaining([PN, PN2, LID]));
      expect(store.history({ chat: PN2, limit: 50 }).items.map((m) => m.id).sort()).toEqual(["NEW", "OLD"]);
      expect(store.history({ chat: PN, limit: 50 }).items.map((m) => m.id).sort()).toEqual(["NEW", "OLD"]);
      // Going back to the old number later keeps both on record and does not duplicate.
      store.learnLids([{ lid: LID, pn: PN }], "event");
      expect(store.canon(LID)).toBe(PN);
      expect(inst.db.all("SELECT pn FROM wa_lid_history WHERE lid = ?", LID)).toEqual([{ pn: PN2 }]);
    });
  });

  it("the own-number refusal still holds when a higher source disagrees", async () => {
    const account = await link();
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      const ME = "15550100@s.whatsapp.net";
      store.learnLids([{ lid: LID, pn: PN }], "message");
      expect(store.learnLids([{ lid: LID, pn: ME }], "event")).toMatchObject({ learned: 0, conflicts: 1 });
      expect(store.canon(LID)).toBe(PN);
    });
  });

  it("the history table is added by its own migration and runs again as a no-op", async () => {
    const account = freshAccount();
    await link(account);
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      inst.db.run("DROP TABLE wa_lid_history");
      inst.db.run("DELETE FROM wa_schema WHERE version = 4");
      expect(runMigrations(inst.db, WA_MIGRATIONS)).toEqual([4]);
      expect(runMigrations(inst.db, WA_MIGRATIONS)).toEqual([]);
    });
  });
});

describe("the migration that adds the mapping table", () => {
  it("upgrades a store that has split rows without touching them, and runs again as a no-op", async () => {
    const account = freshAccount();
    await link(account);
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const db = inst.db;
      // Back to how version 1 left the tables, with a split person in them.
      db.run("DROP TABLE wa_lid_map");
      db.run("ALTER TABLE wa_chats DROP COLUMN archived");
      db.run("DELETE FROM wa_schema WHERE version = 2");
      db.run("INSERT INTO wa_chats (jid, name, is_group, unread, last_at) VALUES (?, 'Carol', 0, 1, 100), (?, NULL, 0, 2, 200)", PN, LID);
      db.run("INSERT INTO wa_messages (chat, id, sender, push_name, from_me, at, text, kind, source) VALUES (?, 'M1', ?, NULL, 0, 100, 'one', 'text', 'live'), (?, 'M2', ?, NULL, 0, 200, 'two', 'text', 'live')", PN, PN, LID, LID);
      expect(runMigrations(db, WA_MIGRATIONS)).toEqual([2]);
      expect(runMigrations(db, WA_MIGRATIONS)).toEqual([]);
      expect(db.all("SELECT count(*) AS n FROM wa_messages")).toEqual([{ n: 2 }]);
      expect(db.all("SELECT archived FROM wa_chats ORDER BY jid").every((r) => (r as { archived: number }).archived === 0)).toBe(true);
      // The mapping arrives afterwards and merges them.
      const store = new WaStore(db);
      expect(store.learnLids([{ lid: LID, pn: PN }], "later")).toMatchObject({ learned: 1, merged: 1 });
      expect(db.all("SELECT chat, id FROM wa_messages ORDER BY id")).toEqual([
        { chat: PN, id: "M1" },
        { chat: PN, id: "M2" },
      ]);
      expect(db.all("SELECT jid, name, unread, last_at FROM wa_chats")).toEqual([{ jid: PN, name: "Carol", unread: 2, last_at: 200 }]);
    });
  });
});

describe("a merged chat is read again under its new id", () => {
  it("messages moved from the hidden-number chat get new sequences under the phone chat; the others keep theirs", async () => {
    const account = await link();
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const db = inst.db;
      const store = new WaStore(db);
      store.addMessages([waMsg({ id: "P1", chat: PN, sender: PN, at: 1000, text: "phone" }), lidMsg("L1", { at: 2000, text: "lid" }), lidMsg("L2", { at: 3000, text: "same" }), waMsg({ id: "L2", chat: PN, sender: PN, at: 3000, text: "same" })], "live");
      const seqs = () => Object.fromEntries(db.all<{ id: string; seq: number }>("SELECT id, seq FROM wa_messages WHERE chat = ?", PN).map((r) => [r.id, r.seq]));
      expect(db.all("SELECT chat, id FROM wa_messages WHERE id = 'L1'")).toEqual([{ chat: LID, id: "L1" }]);
      const lidSeq = db.all<{ seq: number }>("SELECT seq FROM wa_messages WHERE chat = ? AND id = 'L1'", LID)[0]!.seq;
      const before = store.history({ afterSeq: 0, limit: 50 }).newestSeq;
      expect(store.learnLids([{ lid: LID, pn: PN }], "later")).toMatchObject({ merged: 1 });
      const now = seqs();
      expect(Object.keys(now).sort()).toEqual(["L1", "L2", "P1"]);
      expect(now.L1).toBeGreaterThan(before);
      expect(now.L2).toBeGreaterThan(before);
      expect(now.L1).not.toBe(lidSeq);
      expect(now.P1).toBeLessThan(before);
      // A reader that had read up to `before` gets exactly the moved messages, now in the phone chat.
      const next = store.history({ afterSeq: before, limit: 50 });
      expect(next.items.map((m) => [m.id, m.chat]).sort()).toEqual([["L1", PN], ["L2", PN]]);
      // Merging again moves nothing and bumps nothing.
      const again = JSON.stringify(seqs());
      store.learnLids([{ lid: LID, pn: PN }], "again");
      expect(store.mergeKnown()).toBe(0);
      expect(JSON.stringify(seqs())).toBe(again);
    });
  });
});

describe("paging and the time filter on chats", () => {
  async function seed(account: string, count: number): Promise<number> {
    const s = rpc(account);
    const t = Date.now() - 100_000;
    fake.history = {
      chats: Array.from({ length: count }, (_, i) => ({
        jid: `1555015${i}@s.whatsapp.net`,
        name: `Chat ${i}`,
        // The last two share a time, to check the cursor does not skip or repeat.
        lastAt: t + (i >= count - 2 ? (count - 2) * 1000 : i * 1000),
        ...(i === 1 ? { archived: true } : {}),
      })),
      contacts: [],
      messages: [],
    };
    ok(await s.refresh());
    return t;
  }

  it("pages through every chat once, says when more exist, and when the list is complete", async () => {
    const account = await link();
    const s = rpc(account);
    await seed(account, 7);
    const seen: string[] = [];
    let before: string | undefined;
    let pages = 0;
    for (;;) {
      const p = ok(await s.chatPage({ limit: 3, ...(before ? { before } : {}) }));
      pages++;
      expect(p.total).toBe(7);
      seen.push(...p.chats.map((c) => c.jid));
      if (!p.more) {
        expect(p.next).toBeUndefined();
        break;
      }
      expect(p.next).toMatch(/^\d+:/);
      before = p.next;
    }
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(7);
    expect(seen).toHaveLength(7);
  });

  it("since keeps only chats active at or after the time; archived chats are marked and can be left out", async () => {
    const account = await link();
    const s = rpc(account);
    const t = await seed(account, 7);
    const since = ok(await s.chatPage({ since: t + 3000 }));
    expect(since.chats.every((c) => c.lastAt >= t + 3000)).toBe(true);
    expect(since).toMatchObject({ total: 4, more: false });
    const all = ok(await s.chatPage({ since: t }));
    expect(all.chats.find((c) => c.name === "Chat 1")).toMatchObject({ archived: true });
    expect(all).toMatchObject({ total: 7, archivedShown: 1, archivedHidden: 0 });
    const noArchived = ok(await s.chatPage({ since: t, includeArchived: false }));
    expect(noArchived).toMatchObject({ total: 6, archivedHidden: 1 });
    expect(noArchived.chats.some((c) => c.name === "Chat 1")).toBe(false);
  });

  it("refuses a cursor it did not make, and caps the page size", async () => {
    const account = await link();
    const s = rpc(account);
    await seed(account, 3);
    expect(await s.chatPage({ before: "garbage; DROP TABLE wa_chats" })).toMatchObject({ ok: false, status: 400 });
    expect(ok(await s.chatPage({ limit: 100000 })).chats.length).toBeLessThanOrEqual(100);
  });
});

describe("chats WhatsApp only summarised", () => {
  it("shows up with no stored messages, so the reader can say why there is nothing to read", async () => {
    const account = await link();
    const s = rpc(account);
    fake.history = { chats: [{ jid: PN, name: "Erin", lastAt: Date.now() - 1000 }], contacts: [], messages: [] };
    ok(await s.refresh());
    expect(ok(await s.messages(PN, {}))).toEqual([]);
    expect(ok(await s.nameOf(PN))).toMatchObject({ name: "Erin", stored: 0, known: true });
    expect(ok(await s.chatPage({})).chats.find((c) => c.jid === PN)).toMatchObject({ stored: 0, preview: "" });
    expect(ok(await s.nameOf("15550177@s.whatsapp.net"))).toMatchObject({ stored: 0, known: false });
    // A message that then arrives is stored under the same chat.
    fake.offline = [waMsg({ id: "E1", chat: PN, sender: PN, text: "hello Erin", at: Date.now() })];
    ok(await s.refresh());
    expect(ok(await s.nameOf(PN))).toMatchObject({ stored: 1 });
  });
});

// ----- history: the context store's read-only walk, paged by (at, chat, id) -----------------------------------------------

describe("history", () => {
  const CHATS = ["15550111@s.whatsapp.net", "15550112@s.whatsapp.net", "120363000000000001@g.us"];
  const T = 1_800_000_000_000;
  /** Stores messages straight into an account's store (the fake plays WhatsApp's side elsewhere). */
  const seed = (account: string, ms: Array<ReturnType<typeof waMsg>>) =>
    runInDurableObject(stub(account), async (inst: WhatsApp) => {
      new WaStore(inst.db).addMessages(ms, "history");
    });
  const key = (m: { at: number; chat: string; id: string }) => `${m.at}|${m.chat}|${m.id}`;
  const walk = async (account: string, limit: number, dir: "after" | "before" = "after") => {
    const out: Array<{ at: number; chat: string; id: string }> = [];
    let cur: { at: number; chat: string; id: string } | undefined;
    for (let i = 0; i < 100; i++) {
      const p = ok(await rpc(account).history({ limit, ...(dir === "before" ? { order: "desc" } : {}), ...(cur ? { [dir]: cur } : {}) } as never));
      out.push(...p.items);
      if (!p.more) return out;
      const last = p.items[p.items.length - 1]!;
      cur = { at: last.at, chat: last.chat, id: last.id };
    }
    throw new Error("history did not end");
  };

  it("pages by (at, chat, id): ties at one millisecond across chats are neither skipped nor repeated, at any page size", async () => {
    const account = freshAccount();
    const ms = [] as Array<ReturnType<typeof waMsg>>;
    for (let i = 0; i < 12; i++) {
      const chat = CHATS[i % 3]!;
      // Four messages share each of three timestamps; ids sort unlike their insertion order.
      ms.push(waMsg({ id: `m${(11 - i).toString().padStart(2, "0")}`, chat, sender: chat, at: T + Math.floor(i / 4) * 1000, text: `t${i}` }));
    }
    await seed(account, ms);
    const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
    const want = ms.map(key).sort((a, b) => {
      const [aa, ac, ai] = a.split("|");
      const [ba, bc, bi] = b.split("|");
      return Number(aa) - Number(ba) || cmp(ac!, bc!) || cmp(ai!, bi!);
    });
    for (const limit of [1, 2, 3, 5, 12, 500]) expect((await walk(account, limit)).map(key)).toEqual(want);
    // Newest first is the same list reversed.
    expect((await walk(account, 5, "before")).map(key)).toEqual([...want].reverse());
  });

  it("answers the first page, the span of what is stored, the state and what is kept", async () => {
    const account = freshAccount();
    await seed(account, [waMsg({ id: "a", chat: CHATS[0]!, sender: CHATS[0]!, at: T }), waMsg({ id: "b", chat: CHATS[0]!, sender: CHATS[0]!, at: T + 5 })]);
    const p = ok(await rpc(account).history({ limit: 1 }));
    expect(p).toMatchObject({ more: true, oldestAt: T, newestAt: T + 5, state: "unlinked", retain: { days: 90, maxMessages: 50_000 } });
    expect(p.items.map((m) => m.id)).toEqual(["a"]);
    const empty = ok(await rpc(freshAccount()).history({}));
    expect(empty).toMatchObject({ items: [], more: false, oldestAt: null, newestAt: null });
  });

  it("walks by the store sequence: a message with an old send time stored later comes after the position", async () => {
    const account = freshAccount();
    await seed(account, [waMsg({ id: "a", chat: CHATS[0]!, sender: CHATS[0]!, at: T + 10 }), waMsg({ id: "b", chat: CHATS[1]!, sender: CHATS[1]!, at: T + 20 })]);
    const first = ok(await rpc(account).history({ afterSeq: 0, limit: 10 }));
    expect(first.items.map((m) => [m.id, m.seq])).toEqual([["a", 1], ["b", 2]]);
    expect(first.newestSeq).toBe(2);
    expect(ok(await rpc(account).history({ afterSeq: 2, limit: 10 })).items).toEqual([]);
    // WhatsApp hands over a message sent days earlier, after the newer ones. By time it sorts first; by sequence it is new.
    await seed(account, [waMsg({ id: "late", chat: CHATS[0]!, sender: CHATS[0]!, at: T - 3 * 86_400_000 })]);
    const next = ok(await rpc(account).history({ afterSeq: 2, limit: 10 }));
    expect(next.items.map((m) => [m.id, m.seq])).toEqual([["late", 3]]);
    expect(next.newestSeq).toBe(3);
    // Paged by sequence, in store order, however small the page.
    const one = ok(await rpc(account).history({ afterSeq: 0, limit: 1 }));
    expect(one).toMatchObject({ more: true });
    expect(one.items.map((m) => m.id)).toEqual(["a"]);
    // A message already stored is not stored again, so it keeps its place.
    await seed(account, [waMsg({ id: "a", chat: CHATS[0]!, sender: CHATS[0]!, at: T + 10 })]);
    expect(ok(await rpc(account).history({ afterSeq: 3, limit: 10 })).items).toEqual([]);
    // The two ways of asking do not mix, and the number must be a whole one.
    expect(await rpc(account).history({ afterSeq: 1, after: { at: T, chat: CHATS[0]!, id: "a" } } as never)).toMatchObject({ ok: false, status: 400 });
    expect(await rpc(account).history({ afterSeq: -1 } as never)).toMatchObject({ ok: false, status: 400 });
    expect(await rpc(account).history({ afterSeq: 1.5 } as never)).toMatchObject({ ok: false, status: 400 });
  });

  it("the sequence never goes back: a pruned message's number is not handed out again, and unpairing keeps the counter", async () => {
    const account = freshAccount();
    await seed(account, [waMsg({ id: "x1", chat: CHATS[0]!, sender: CHATS[0]!, at: T }), waMsg({ id: "x2", chat: CHATS[0]!, sender: CHATS[0]!, at: T + 1 })]);
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      store.prune(T + 10 * 86_400_000 * 365);
      expect(inst.db.all("SELECT count(*) AS n FROM wa_messages")).toEqual([{ n: 0 }]);
      store.eraseAll();
    });
    await seed(account, [waMsg({ id: "x3", chat: CHATS[0]!, sender: CHATS[0]!, at: T + 2 })]);
    expect(ok(await rpc(account).history({ afterSeq: 2, limit: 10 })).items.map((m) => [m.id, m.seq])).toEqual([["x3", 3]]);
  });

  it("the sequence migration numbers the stored messages in the old (at, chat, id) order and runs again as a no-op", async () => {
    const account = freshAccount();
    await link(account);
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const db = inst.db;
      db.run("DELETE FROM wa_schema WHERE version = 5");
      db.run("DELETE FROM wa_meta WHERE key = 'seq'");
      db.run("INSERT INTO wa_messages (chat, id, sender, push_name, from_me, at, text, kind, source, seq) VALUES (?, 'b', ?, NULL, 0, 200, 'two', 'text', 'live', NULL), (?, 'a', ?, NULL, 0, 200, 'one', 'text', 'live', NULL), (?, 'z', ?, NULL, 0, 100, 'zero', 'text', 'live', NULL)", CHATS[0]!, CHATS[0]!, CHATS[0]!, CHATS[0]!, CHATS[0]!, CHATS[0]!);
      expect(runMigrations(db, WA_MIGRATIONS)).toEqual([5]);
      expect(runMigrations(db, WA_MIGRATIONS)).toEqual([]);
      expect(db.all("SELECT id, seq FROM wa_messages ORDER BY seq")).toEqual([{ id: "z", seq: 1 }, { id: "a", seq: 2 }, { id: "b", seq: 3 }]);
      expect(db.all("SELECT value FROM wa_meta WHERE key = 'seq'")).toEqual([{ value: "3" }]);
      new WaStore(db).addMessages([waMsg({ id: "n", chat: CHATS[0]!, sender: CHATS[0]!, at: 50 })], "history");
      expect(db.all("SELECT seq FROM wa_messages WHERE id = 'n'")).toEqual([{ seq: 4 }]);
    });
  });

  it("names the chat and the sender as the person knows them; a name the sender chose stays apart", async () => {
    const account = freshAccount();
    const group = CHATS[2]!;
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      store.upsertChats([{ jid: group, name: "Flat 3B", lastAt: T }], { setUnread: false });
      store.upsertContacts([{ jid: CHATS[0]!, name: "Carol" }]);
      store.addMessages(
        [
          waMsg({ id: "g1", chat: group, sender: CHATS[0]!, at: T, text: "who has the keys" }),
          waMsg({ id: "g2", chat: group, sender: CHATS[1]!, at: T + 1, text: "me", pushName: "Definitely Your Bank" }),
          waMsg({ id: "g3", chat: group, sender: "15550100@s.whatsapp.net", fromMe: true, at: T + 2, text: "on my way" }),
        ],
        "history",
      );
    });
    const items = ok(await rpc(account).history({ chat: group })).items;
    expect(items[0]).toMatchObject({ chat: group, chatName: "Flat 3B", isGroup: true, sender: CHATS[0], savedName: "Carol", fromMe: false });
    expect(items[1]).toMatchObject({ pushName: "Definitely Your Bank" });
    expect(items[1]!.savedName).toBeUndefined();
    expect(items[2]).toMatchObject({ fromMe: true, text: "on my way" });
  });

  it("a reply's quoted id is stored and comes out of history; a message without one has none", async () => {
    const account = freshAccount();
    const group = CHATS[2]!;
    await seed(account, [
      waMsg({ id: "q1", chat: group, sender: "15550100@s.whatsapp.net", fromMe: true, at: T, text: "who has the keys" }),
      waMsg({ id: "q2", chat: group, sender: CHATS[0]!, at: T + 1, text: "me", quotedId: "q1" }),
    ]);
    const items = ok(await rpc(account).history({ chat: group })).items;
    expect(items[0]!.quotedId).toBeUndefined();
    expect(items[1]).toMatchObject({ id: "q2", quotedId: "q1" });
  });

  it("keeps one chat per person: a message stored under a hidden-number id comes out under the phone id", async () => {
    const account = freshAccount();
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      store.addMessages([lidMsg("l1", { at: T, text: "under lid" }), waMsg({ id: "p1", chat: PN, sender: PN, at: T + 1, text: "under phone" })], "history");
      store.learnLids([{ lid: LID, pn: PN }], "test");
    });
    const items = ok(await rpc(account).history({})).items;
    expect(items.map((m) => [m.id, m.chat])).toEqual([
      ["l1", PN],
      ["p1", PN],
    ]);
    // Asking by either id finds the one chat.
    expect(ok(await rpc(account).history({ chat: LID })).items).toHaveLength(2);
  });

  it("narrows to a chat, a message id or a start time, and refuses malformed arguments without touching anything", async () => {
    const account = freshAccount();
    await seed(account, [
      waMsg({ id: "x1", chat: CHATS[0]!, sender: CHATS[0]!, at: T }),
      waMsg({ id: "x2", chat: CHATS[1]!, sender: CHATS[1]!, at: T + 10 }),
      waMsg({ id: "x3", chat: CHATS[1]!, sender: CHATS[1]!, at: T + 20 }),
    ]);
    const s = rpc(account);
    expect(ok(await s.history({ chat: CHATS[1]! })).items.map((m) => m.id)).toEqual(["x2", "x3"]);
    expect(ok(await s.history({ id: "x1" })).items.map((m) => m.id)).toEqual(["x1"]);
    expect(ok(await s.history({ since: T + 10 })).items.map((m) => m.id)).toEqual(["x2", "x3"]);
    for (const bad of [{ after: { at: "now", chat: "c", id: "i" } }, { after: { at: 1, chat: 7, id: "i" } }, { after: { at: 1, chat: "c", id: "i" }, before: { at: 2, chat: "c", id: "i" } }, { since: -1 }, { order: "sideways" }, { chat: "x".repeat(300) }]) {
      expect(await s.history(bad as never)).toMatchObject({ ok: false, status: 400 });
    }
    // Reading changes nothing: no unread counts, no rows.
    const counts = ok(await s.status()).counts;
    ok(await s.history({ limit: 500 }));
    expect(ok(await s.status()).counts).toEqual(counts);
    // The limit is clamped, not refused.
    expect(ok(await s.history({ limit: 99999 })).items).toHaveLength(3);
    expect(ok(await s.history({ limit: 0 })).items).toHaveLength(1);
  });

  it("shows what pruning did: the oldest stored time moves up and the span says so", async () => {
    const account = freshAccount();
    const now = Date.now();
    await seed(account, [waMsg({ id: "old", chat: CHATS[0]!, sender: CHATS[0]!, at: now - 100 * 86_400_000 }), waMsg({ id: "new", chat: CHATS[0]!, sender: CHATS[0]!, at: now - 1000 })]);
    expect(ok(await rpc(account).history({})).oldestAt).toBe(now - 100 * 86_400_000);
    await runInDurableObject(stub(account), async (inst: WhatsApp) => void new WaStore(inst.db).prune(now));
    const p = ok(await rpc(account).history({}));
    expect(p.items.map((m) => m.id)).toEqual(["new"]);
    expect(p.oldestAt).toBe(now - 1000);
  });

  it("is a method of the JSON interface, and an unknown one is still refused", async () => {
    const r = await SELF.fetch("https://whatsapp.internal/rpc/history", { method: "POST", headers: { "x-slimefolk-account": freshAccount() }, body: JSON.stringify({ args: [{ limit: 5 }] }) });
    expect(await r.json()).toMatchObject({ ok: true, value: { items: [], more: false } });
    const nope = await SELF.fetch("https://whatsapp.internal/rpc/historyy", { method: "POST", headers: { "x-slimefolk-account": "a" }, body: "{}" });
    expect(await nope.json()).toEqual({ ok: false, error: "Unknown method", status: 404 });
  });
});

describe("group members and mentions", () => {
  const G = "120363000000000042@g.us";
  const CAROL = "15550121@s.whatsapp.net";
  const BOB = "15550122@s.whatsapp.net";
  const CARA_LID = "77788899900011@lid";
  const CARA = "15550123@s.whatsapp.net";
  const group = { jid: G, subject: "Flat", members: [{ jid: CAROL, admin: true }, { jid: BOB }, { jid: CARA_LID, altJid: CARA }] };

  it("the migration adds the member tables and the mentions column and runs again as a no-op", async () => {
    const account = freshAccount();
    await link(account);
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const db = inst.db;
      db.run("DROP TABLE wa_group_members");
      db.run("DROP TABLE wa_group_info");
      db.run("ALTER TABLE wa_messages DROP COLUMN mentions");
      db.run("DELETE FROM wa_schema WHERE version = 6");
      expect(runMigrations(db, WA_MIGRATIONS)).toEqual([6]);
      expect(runMigrations(db, WA_MIGRATIONS)).toEqual([]);
      expect(db.all("SELECT count(*) AS n FROM wa_group_members")).toEqual([{ n: 0 }]);
      expect(db.columns("SELECT * FROM wa_messages LIMIT 0")).toContain("mentions");
    });
  });

  it("a group seen for the first time is described once; its members and the tags on a message come out of the store", async () => {
    const account = await link();
    const s = rpc(account);
    fake.history = undefined;
    fake.groups.set(G, group);
    const at = Date.now();
    fake.offline = [
      waMsg({ id: "G1", at, chat: G, sender: CAROL, text: "@Bob dinner?", pushName: "Carol P", mentions: [BOB] }),
      waMsg({ id: "G2", at: at + 1, chat: G, sender: BOB, text: "yes" }),
    ];
    ok(await s.refresh());
    // One fetch for the group, however many messages it had.
    expect(fake.groupFetches).toEqual([G]);
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      store.upsertContacts([{ jid: CAROL, name: "Carol" }, { jid: BOB, notify: "Bobby" }]);
      const r = store.members(G);
      expect(r.total).toBe(3);
      // The hidden-number member is kept under the phone form WhatsApp gave beside it.
      expect(r.members.map((m) => m.jid).sort()).toEqual([CAROL, BOB, CARA].sort());
      expect(r.members[0]).toMatchObject({ jid: CAROL, savedName: "Carol", admin: true });
      expect(r.members.find((m) => m.jid === BOB)).toMatchObject({ pushName: "Bobby" });
      expect(r.members.find((m) => m.jid === BOB)?.savedName).toBeUndefined();
    });
    const page = ok(await s.history({ chat: G, limit: 10, order: "asc" }));
    expect(page.items.find((m) => m.id === "G1")?.mentions).toEqual([{ jid: BOB, pushName: "Bobby" }]);
    expect(page.items.find((m) => m.id === "G2")?.mentions).toBeUndefined();
    // The chat page carries members only when asked, and only for groups.
    const plain = ok(await s.chatPage({ limit: 10 })).chats.find((c) => c.jid === G)!;
    expect(plain.members).toBeUndefined();
    const withMembers = ok(await s.chatPage({ limit: 10, members: true })).chats.find((c) => c.jid === G)!;
    expect(withMembers).toMatchObject({ isGroup: true, memberCount: 3 });
    expect(withMembers.members?.map((m) => m.jid)).toContain(CAROL);
  });

  it("does not ask again for a group it knows, and asks once for a group WhatsApp has nothing for", async () => {
    const account = await link();
    const s = rpc(account);
    fake.history = undefined;
    fake.groups.set(G, group);
    fake.offline = [waMsg({ id: "H1", chat: G, sender: CAROL, text: "one" })];
    ok(await s.refresh());
    fake.offline = [waMsg({ id: "H2", chat: G, sender: CAROL, text: "two" })];
    ok(await s.refresh());
    expect(fake.groupFetches).toEqual([G]);
    const NONE = "120363000000000043@g.us";
    fake.offline = [waMsg({ id: "H3", chat: NONE, sender: CAROL, text: "x" }), waMsg({ id: "H4", chat: NONE, sender: CAROL, text: "y" })];
    ok(await s.refresh());
    expect(fake.groupFetches).toEqual([G, NONE]);
  });

  it("joins, leaves and rank changes update the stored list; a group never described ignores them", async () => {
    const account = freshAccount();
    await link(account);
    const DAN = "15550124@s.whatsapp.net";
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      const list = () => store.members(G).members.map((m) => `${m.jid}${m.admin ? "*" : ""}`).sort();
      store.learnGroups([group], Date.now());
      store.changeGroup({ jid: G, action: "add", members: [{ jid: DAN }] }, Date.now());
      store.changeGroup({ jid: G, action: "remove", members: [{ jid: BOB }] }, Date.now());
      store.changeGroup({ jid: G, action: "promote", members: [{ jid: DAN }] }, Date.now());
      store.changeGroup({ jid: G, action: "demote", members: [{ jid: CAROL }] }, Date.now());
      expect(list()).toEqual([CAROL, CARA, `${DAN}*`].sort());
      store.changeGroup({ jid: "120363000000000099@g.us", action: "add", members: [{ jid: DAN }] }, Date.now());
      expect(store.members("120363000000000099@g.us").total).toBe(0);
    });
  });

  it("group events WhatsApp pushes reach the store", async () => {
    const account = await link();
    const s = rpc(account);
    fake.history = undefined;
    fake.groups.set(G, group);
    fake.offline = [waMsg({ id: "L1", chat: G, sender: CAROL, text: "hi" })];
    ok(await s.refresh());
    fake.history = undefined;
    fake.queuedChanges = [{ jid: G, action: "remove", members: [{ jid: BOB }] }];
    fake.queuedGroups = [{ jid: G, subject: "Flat 2" }];
    ok(await s.refresh());
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      expect(store.members(G).members.map((m) => m.jid)).not.toContain(BOB);
      expect(inst.db.all("SELECT name FROM wa_chats WHERE jid = ?", G)).toEqual([{ name: "Flat 2" }]);
    });
  });

  it("a hidden-number member is merged into the phone form when the mapping arrives", async () => {
    const account = freshAccount();
    await link(account);
    const LID2 = "55544433322211@lid";
    const PN2 = "15550131@s.whatsapp.net";
    await runInDurableObject(stub(account), async (inst: WhatsApp) => {
      const store = new WaStore(inst.db);
      store.learnGroups([{ jid: G, members: [{ jid: LID2 }, { jid: CAROL }] }], Date.now());
      expect(store.members(G).members.map((m) => m.jid).sort()).toEqual([CAROL, LID2].sort());
      store.learnLids([{ lid: LID2, pn: PN2 }], "event");
      expect(store.members(G).members.map((m) => m.jid).sort()).toEqual([CAROL, PN2].sort());
    });
  });
});
