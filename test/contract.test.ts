// The contract (contract/) against the running Worker: every action is called over the same HTTP shape a service binding uses,
// its reply is checked against the JSON Schema for that action, and so are the webhook bodies and /health. If a schema and the
// code drift apart, these fail.
import { SELF, env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONTRACT_VERSION,
  SCHEMAS,
  WHATSAPP_RPC_METHODS,
  healthProblem,
  hookProblem,
  manifest,
  replyProblem,
  requestProblem,
  type WhatsAppRpcMethod,
} from "../contract/index.ts";
import { FakeWhatsApp, waMsg } from "../src/fake.ts";
import { resetWaTestHooks, waTestHooks } from "../src/testing.ts";

const SECRET = "test-webhook-secret-0123456789";
const HOOK = "https://app.example.test/whatsapp/hook";
const OWNER = "15550100";
const CAROL = "15550101@s.whatsapp.net";
const GROUP = "120363000000000001@g.us";
let n = 0;
const freshAccount = () => `contract-${Date.now().toString(36)}-${++n}`;

let fake: FakeWhatsApp;
let posted: string[];

beforeEach(() => {
  fake = new FakeWhatsApp();
  posted = [];
  const hooks = waTestHooks();
  hooks.adapter = fake;
  hooks.timing = { connectMs: 1500, pollMaxMs: 1500, quietMs: 30, quietMaxMs: 150, firstSyncMs: 1500, firstQuietMs: 30, firstQuietMaxMs: 150, sendLingerMs: 30, pairMs: 60_000, olderWaitMs: 1500, olderQuietMs: 30, olderQuietMaxMs: 150, olderGapMs: 0, olderChatCooldownMs: 0 };
  hooks.post = async (_url, init) => {
    posted.push(init.body);
    return { ok: true, status: 200 };
  };
});
afterEach(() => resetWaTestHooks());

async function call(account: string, method: WhatsAppRpcMethod, ...args: unknown[]): Promise<unknown> {
  expect(requestProblem(method, args), `${method} request`).toBeNull();
  const r = await SELF.fetch(`https://whatsapp.internal/rpc/${method}`, { method: "POST", headers: { "x-slimefolk-account": account }, body: JSON.stringify({ args }) });
  const body = await r.json();
  expect(replyProblem(method, body), `${method} reply: ${JSON.stringify(body).slice(0, 300)}`).toBeNull();
  return body;
}
const value = (reply: unknown): any => {
  const r = reply as { ok: boolean; value?: unknown; error?: string };
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

describe("the contract's files", () => {
  it("has a request and a response schema for exactly the actions the Worker serves", () => {
    expect(Object.keys(manifest.actions).sort()).toEqual([...WHATSAPP_RPC_METHODS].sort());
    for (const a of Object.values(manifest.actions)) {
      expect(SCHEMAS[a.request]).toBeDefined();
      expect(SCHEMAS[a.response]).toBeDefined();
    }
    expect(manifest.version).toBe(CONTRACT_VERSION);
  });

  it("rejects what is not in the shape, so the checks are not vacuous", () => {
    expect(replyProblem("status", { ok: true, value: { state: "linked" } })).toContain("missing");
    expect(replyProblem("status", { ok: true, value: { state: "asleep", connected: false, frequency: 15, counts: { chats: 0, unread: 0, messages: 0 }, available: true } })).toContain("must be one of");
    expect(replyProblem("send", { ok: true, value: { ok: true } })).toContain("exactly one");
    expect(replyProblem("status", { ok: false, error: "x" })).not.toBeNull();
    expect(replyProblem("status", { ok: false, error: "x", status: 503 })).toBeNull();
    expect(hookProblem({ type: "messages" })).not.toBeNull();
    expect(healthProblem({ ok: true })).not.toBeNull();
  });

  it("takes the arguments a caller sends, with optional ones null or left off", () => {
    expect(requestProblem("chats", [])).toBeNull();
    expect(requestProblem("chats", ["many"])).toContain("expected integer, got string");
    expect(requestProblem("chats", [100, null])).toBeNull();
    expect(requestProblem("chats", [null, true])).toBeNull();
    expect(requestProblem("startPairing", [{ method: "code", phone: "15550100" }])).toBeNull();
    expect(requestProblem("startPairing", [{ method: "code", phone: "+1 555" }])).toContain("does not match");
    expect(requestProblem("fetchOlder", [{ chat: CAROL, count: 5 }])).toContain("below 10");
    expect(requestProblem("history", [{ after: { at: 1, chat: CAROL, id: "m" }, order: "asc", limit: 500 }])).toBeNull();
    expect(requestProblem("configure", [{ hookUrl: HOOK, secret: "short" }])).toContain("shorter than 16");
  });
});

describe("every action, over HTTP", () => {
  it("link: startPairing, cancelPairing, status", async () => {
    const account = freshAccount();
    expect(value(await call(account, "status"))).toMatchObject({ state: "unlinked", frequency: 15, available: true });
    expect(value(await call(account, "startPairing", { method: "code", phone: OWNER }))).toMatchObject({ state: "pairing", pairing: { method: "code", code: "ABCD1234" } });
    expect(value(await call(account, "cancelPairing"))).toMatchObject({ state: "unlinked" });
    expect(value(await call(account, "startPairing", { method: "qr" }))).toMatchObject({ state: "pairing", pairing: { method: "qr" } });
    expect(value(await call(account, "cancelPairing"))).toMatchObject({ state: "unlinked" });
  });

  it("reads, sends, walks history, asks for older messages and unlinks", async () => {
    const account = freshAccount();
    value(await call(account, "configure", { hookUrl: HOOK, secret: SECRET }));
    value(await call(account, "startPairing", { method: "code", phone: OWNER }));
    // The fake plays WhatsApp's side but touches the account's storage like the real client would: from inside the object.
    await runInDurableObject(env.WHATSAPP.get(env.WHATSAPP.idFromName(account)), async () => fake.enterCode("Alice"));
    await until(async () => value(await call(account, "status")).state === "linked", "the link");
    await until(() => fake.openConnections === 0, "the first sync to finish");
    expect(value(await call(account, "status"))).toMatchObject({ state: "linked", number: OWNER, name: "Alice", hookUrl: HOOK });

    const t = Date.now() - 60_000;
    fake.history = {
      chats: [{ jid: CAROL, name: "Carol", unread: 1, lastAt: t }, { jid: GROUP, name: "Flat 3B", lastAt: t - 1000 }],
      contacts: [{ jid: CAROL, name: "Carol" }],
      messages: [waMsg({ id: "H1", chat: CAROL, sender: CAROL, at: t, text: "lunch at one?" }), waMsg({ id: "H2", chat: GROUP, sender: CAROL, at: t - 1000, text: "who has the keys", pushName: "Carol" })],
      lidMappings: [],
    };
    fake.offline = [waMsg({ id: "N1", chat: CAROL, sender: CAROL, at: Date.now(), text: "see you there" })];
    expect(value(await call(account, "refresh"))).toMatchObject({ ok: true });
    expect(value(await call(account, "setFrequency", 30))).toMatchObject({ frequency: 30 });

    expect(value(await call(account, "chats", 10, false))).toHaveLength(2);
    expect(value(await call(account, "chats", null, true)).length).toBeGreaterThan(0);
    expect(value(await call(account, "chatPage", { limit: 1, members: true })).more).toBe(true);
    expect(value(await call(account, "chatPage", {})).total).toBe(2);
    expect(value(await call(account, "resolve", "Carol"))).toEqual({ jid: CAROL });
    expect(value(await call(account, "resolve", "Nobody Here"))).toEqual({ none: true });
    expect(value(await call(account, "messages", CAROL, { limit: 10 })).map((m: { id: string }) => m.id)).toContain("H1");
    expect(value(await call(account, "search", "lunch", {}))).toHaveLength(1);
    expect(value(await call(account, "search", "keys", { chat: GROUP, limit: 5 }))).toHaveLength(1);
    const page = value(await call(account, "history", { limit: 2, order: "desc" }));
    expect(page.items).toHaveLength(2);
    expect(value(await call(account, "history", { after: { at: 0, chat: "", id: "" }, limit: 500 })).items.length).toBe(3);
    expect(value(await call(account, "history", { afterSeq: 0 })).newestSeq).toBeGreaterThan(0);
    expect(value(await call(account, "nameOf", CAROL))).toMatchObject({ name: "Carol", number: "15550101", known: true });
    expect(value(await call(account, "fetchVoiceNote", CAROL, "H1"))).toEqual({ status: "unavailable" });

    fake.olderAnswers = [[waMsg({ id: "O1", chat: CAROL, sender: CAROL, at: t - 5000, text: "older one" })]];
    expect(value(await call(account, "fetchOlder", { chat: CAROL, count: 10 }))).toMatchObject({ status: "loaded", added: 1 });
    expect(value(await call(account, "fetchOlder", { chat: "15550177@s.whatsapp.net" }))).toMatchObject({ status: "no_anchor" });

    expect(value(await call(account, "send", CAROL, "on my way", "key-1"))).toMatchObject({ ok: true });
    expect(value(await call(account, "send", CAROL, "on my way", "key-1"))).toMatchObject({ ok: true, duplicate: true });
    expect(value(await call(account, "send", "not a chat", "hi", "key-2"))).toMatchObject({ ok: false });
    expect(fake.sent).toEqual([{ jid: CAROL, text: "on my way" }]);

    expect(value(await call(account, "rewrapAll"))).toMatchObject({ ok: true, failed: 0 });

    // What the program posted to the webhook is in the shape the schema says.
    const bodies = posted.map((b) => JSON.parse(b));
    expect(bodies.some((b) => b.type === "messages")).toBe(true);
    expect(bodies.some((b) => b.type === "notice")).toBe(true);
    for (const b of bodies) expect(hookProblem(b), JSON.stringify(b).slice(0, 200)).toBeNull();

    expect(value(await call(account, "unpair"))).toMatchObject({ state: "unlinked" });
  });

  it("refusals are data in the same envelope", async () => {
    const account = freshAccount();
    const r = (await call(account, "send", CAROL, "hi", "k")) as { ok: boolean; value: { ok: boolean; error: string } };
    expect(r.value).toMatchObject({ ok: false, error: "WhatsApp is not linked." });
    expect(await call(account, "configure", { hookUrl: "http://evil.example.test/hook", secret: SECRET })).toMatchObject({ ok: false, status: 400 });
    expect(await call(account, "history", { after: { at: 1, chat: "c", id: "i" }, before: { at: 2, chat: "c", id: "i" } })).toMatchObject({ ok: false, status: 400 });
  });

  it("GET /health answers in the contract's shape", async () => {
    const body = await (await SELF.fetch("https://whatsapp.internal/health")).json();
    expect(healthProblem(body)).toBeNull();
    expect(body).toMatchObject({ contract: CONTRACT_VERSION });
  });
});
