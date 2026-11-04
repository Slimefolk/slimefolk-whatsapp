// Older messages on request: the object asks the phone with fetchMessageHistory from the chat's oldest stored message, and the
// phone's ON_DEMAND history sync is stored as history. All against the fake WhatsApp (src/fake.ts); no real pairing.
import { SELF, env, runInDurableObject } from "cloudflare:test";
import type { WaReply, WhatsAppHook } from "../contract/index.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeWhatsApp, waMsg } from "../src/fake.ts";
import type { WhatsApp } from "../src/do.ts";
import { WaStore } from "../src/store.ts";
import { resetWaTestHooks, waTestHooks } from "../src/testing.ts";

const SECRET = "test-webhook-secret-0123456789";
const HOOK = "https://app.example.test/whatsapp/hook";
const CAROL = "15550121@s.whatsapp.net";
const BOB = "15550122@s.whatsapp.net";
const DAY = 86_400_000;
let n = 0;
const freshAccount = () => `older-${Date.now().toString(36)}-${++n}`;

let fake: FakeWhatsApp;
let posted: Array<{ body: string }>;
let clock: { t: number };

beforeEach(() => {
  fake = new FakeWhatsApp();
  posted = [];
  clock = { t: Date.now() };
  const hooks = waTestHooks();
  hooks.adapter = fake;
  hooks.now = () => clock.t;
  hooks.timing = { connectMs: 1500, pollMaxMs: 1500, quietMs: 30, quietMaxMs: 150, firstSyncMs: 1500, firstQuietMs: 30, firstQuietMaxMs: 150, sendLingerMs: 30, pairMs: 60_000, olderWaitMs: 150, olderQuietMs: 30, olderQuietMaxMs: 120, olderChatCooldownMs: 60_000, olderGapMs: 1000, olderPerHour: 10 };
  hooks.post = async (_url, init) => {
    posted.push({ body: init.body });
    return { ok: true, status: 200 };
  };
});
afterEach(() => resetWaTestHooks());

const stub = (account: string) => env.WHATSAPP.get(env.WHATSAPP.idFromName(account));
const rpc = (account: string): WhatsApp => stub(account) as unknown as WhatsApp;
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
const messageHooks = () => posted.map((p) => JSON.parse(p.body) as WhatsAppHook).filter((h) => h.type === "messages");

async function link(): Promise<string> {
  const account = freshAccount();
  const s = rpc(account);
  ok(await s.configure({ hookUrl: HOOK, secret: SECRET }));
  ok(await s.startPairing({ method: "code", phone: "15550100" }));
  await inDO(account, () => fake.enterCode("Alice"));
  await until(async () => ok(await s.status()).state === "linked", "the link");
  await until(() => fake.openConnections === 0, "the first sync to finish");
  return account;
}

const msg = (chat: string, id: string, at: number, text = id) => waMsg({ id, chat, sender: chat, at, text });
/** Stores messages straight into an account's store. */
const seed = (account: string, ms: Array<ReturnType<typeof waMsg>>, source: "history" | "ondemand" = "history") => runInDurableObject(stub(account), async (inst: WhatsApp) => void new WaStore(inst.db).addMessages(ms, source));
const prune = (account: string) => runInDurableObject(stub(account), async (inst: WhatsApp) => void new WaStore(inst.db).prune(clock.t));

/** A linked account holding two messages of Carol's chat (the summary WhatsApp sent at link time) and 2 unread. */
async function withCarol(): Promise<{ account: string; s: WhatsApp; t: number }> {
  const account = await link();
  const s = rpc(account);
  const t = clock.t - 10 * DAY;
  fake.history = { chats: [{ jid: CAROL, name: "Carol", unread: 2, lastAt: t }], contacts: [{ jid: CAROL, name: "Carol" }], messages: [msg(CAROL, "H2", t - 1000), msg(CAROL, "H3", t)] };
  ok(await s.refresh());
  return { account, s, t };
}
const chatOf = async (s: WhatsApp, jid: string) => ok(await s.chatPage({})).chats.find((c) => c.jid === jid);

describe("older messages on request", () => {
  it("asks from the oldest stored message, stores the phone's answer as history, and changes no unread count", async () => {
    const { s, t } = await withCarol();
    const handedOn = messageHooks().length;
    fake.olderAnswers = [[msg(CAROL, "O1", t - 5000), msg(CAROL, "O2", t - 4000), msg(CAROL, "O3", t - 3000)]];
    const r = ok(await s.fetchOlder({ chat: CAROL }));
    expect(fake.historyRequests).toHaveLength(1);
    expect(fake.historyRequests[0]).toEqual({ count: 50, anchor: { chat: CAROL, id: "H2", fromMe: false, at: t - 1000 } });
    expect(r).toMatchObject({ status: "loaded", chat: CAROL, chatName: "Carol", added: 3, stored: 5, oldestAt: t - 5000, anchor: { at: t - 1000, chat: CAROL, id: "H2" } });
    expect(ok(await s.messages(CAROL, { limit: 10 })).map((m) => m.id)).toEqual(["O1", "O2", "O3", "H2", "H3"]);
    expect(ok(await s.search("O2", {})).map((m) => m.id)).toEqual(["O2"]);
    // Unread is what it was, the chat's newest activity did not move, and event routines were not handed old messages.
    expect(await chatOf(s, CAROL)).toMatchObject({ unread: 2, lastAt: t });
    expect(messageHooks().length).toBe(handedOn);
    await until(() => fake.openConnections === 0, "the connection it opened to close");
  });

  it("clamps the count, and refuses what is not a chat id", async () => {
    const { s, t } = await withCarol();
    fake.olderAnswers = [[msg(CAROL, "O1", t - 5000)]];
    ok(await s.fetchOlder({ chat: CAROL, count: 5000 }));
    expect(fake.historyRequests[0]!.count).toBe(100);
    expect(await s.fetchOlder({ chat: "not a chat" })).toMatchObject({ ok: false, status: 400 });
    expect(fake.historyRequests).toHaveLength(1);
  });

  it("stores each message once: an answer that only repeats stored ones adds nothing and completes the chat for good", async () => {
    const { s, t } = await withCarol();
    const two = [msg(CAROL, "O1", t - 5000), msg(CAROL, "O2", t - 4000)];
    fake.olderAnswers = [two, two];
    expect(ok(await s.fetchOlder({ chat: CAROL }))).toMatchObject({ status: "loaded", added: 2 });
    clock.t += 5 * 60_000;
    expect(ok(await s.fetchOlder({ chat: CAROL }))).toMatchObject({ status: "complete", added: 0, stored: 4 });
    // The second ask went back from the new oldest message.
    expect(fake.historyRequests[1]!.anchor).toMatchObject({ id: "O1", at: t - 5000 });
    // Complete is remembered: the phone is not asked a third time, however much later.
    clock.t += 3 * 3_600_000;
    expect(ok(await s.fetchOlder({ chat: CAROL })).status).toBe("complete");
    expect(fake.historyRequests).toHaveLength(2);
    expect(ok(await s.messages(CAROL, { limit: 10 }))).toHaveLength(4);
  });

  it("an empty answer means the phone has nothing older: the chat is complete", async () => {
    const { s } = await withCarol();
    fake.olderAnswers = [[]];
    expect(ok(await s.nameOf(CAROL)).olderComplete).toBe(false);
    expect(ok(await s.fetchOlder({ chat: CAROL }))).toMatchObject({ status: "complete", added: 0, stored: 2 });
    expect(ok(await s.nameOf(CAROL)).olderComplete).toBe(true); // the app hides "Load older" for it
    expect(ok(await s.fetchOlder({ chat: CAROL })).status).toBe("complete");
    expect(fake.historyRequests).toHaveLength(1);
  });

  it("a phone that never answers is reported, nothing is recorded as complete, and a later call tries again", async () => {
    const { s, t } = await withCarol();
    fake.olderAnswers = ["silent", [msg(CAROL, "O1", t - 5000)]];
    const first = ok(await s.fetchOlder({ chat: CAROL }));
    expect(first).toMatchObject({ status: "no_answer", added: 0, stored: 2 });
    expect(first.message).toMatch(/didn't answer/);
    await until(() => fake.openConnections === 0, "the connection to close");
    // Straight away it is the pace, not the phone, that says no.
    expect(ok(await s.fetchOlder({ chat: CAROL })).status).toBe("rate_limited");
    expect(fake.historyRequests).toHaveLength(1);
    clock.t += 5 * 60_000;
    expect(ok(await s.fetchOlder({ chat: CAROL }))).toMatchObject({ status: "loaded", added: 1 });
    expect(fake.historyRequests).toHaveLength(2);
  });

  it("an answer that lands after the wait is still stored when it does, with no unread and no routines", async () => {
    const { s, t } = await withCarol();
    fake.olderAnswers = ["silent"];
    expect(ok(await s.fetchOlder({ chat: CAROL })).status).toBe("no_answer");
    const handedOn = messageHooks().length;
    // The phone comes back online and its answer reaches a later connection.
    fake.history = { chats: [], contacts: [], messages: [msg(CAROL, "LATE", t - 9000)], onDemand: true };
    ok(await s.refresh());
    expect(ok(await s.messages(CAROL, { limit: 10 })).map((m) => m.id)).toContain("LATE");
    expect(await chatOf(s, CAROL)).toMatchObject({ unread: 2 });
    expect(messageHooks().length).toBe(handedOn);
  });

  it("paces the asks: the same chat waits, any two are apart, and a few an hour in all", async () => {
    const { account, s, t } = await withCarol();
    await seed(account, [msg(BOB, "B2", t)]);
    waTestHooks().timing = { ...waTestHooks().timing, olderChatCooldownMs: 10_000, olderGapMs: 2000, olderPerHour: 3 };
    fake.olderAnswers = [[msg(CAROL, "O1", t - 5000)], [msg(BOB, "P1", t - 5000)], [msg(CAROL, "O0", t - 6000)], [msg(BOB, "P0", t - 6000)]];
    expect(ok(await s.fetchOlder({ chat: CAROL })).status).toBe("loaded");
    // A burst: the same chat again at once, and another chat inside the gap. The phone hears nothing of it.
    const same = ok(await s.fetchOlder({ chat: CAROL }));
    expect(same.status).toBe("rate_limited");
    expect(same.retryInMs).toBeGreaterThan(0);
    expect(same.retryInMs).toBeLessThanOrEqual(10_000);
    expect(ok(await s.fetchOlder({ chat: BOB })).status).toBe("rate_limited");
    expect(fake.historyRequests).toHaveLength(1);
    clock.t += 3000;
    expect(ok(await s.fetchOlder({ chat: BOB })).status).toBe("loaded");
    clock.t += 11_000;
    expect(ok(await s.fetchOlder({ chat: CAROL })).status).toBe("loaded");
    // Three asks in the hour: the fourth waits for the hour to pass, whichever chat it is.
    clock.t += 11_000;
    const capped = ok(await s.fetchOlder({ chat: BOB }));
    expect(capped.status).toBe("rate_limited");
    expect(capped.retryInMs).toBeGreaterThan(3_000_000);
    expect(fake.historyRequests).toHaveLength(3);
    clock.t += 3_600_000;
    expect(ok(await s.fetchOlder({ chat: BOB })).status).toBe("loaded");
    expect(fake.historyRequests).toHaveLength(4);
  });

  it("cannot start an empty chat, and says so without bothering the phone", async () => {
    const { s } = await withCarol();
    expect(ok(await s.fetchOlder({ chat: BOB }))).toMatchObject({ status: "no_anchor", stored: 0, oldestAt: null });
    expect(fake.historyRequests).toHaveLength(0);
  });

  it("is refused while WhatsApp is not linked", async () => {
    const s = rpc(freshAccount());
    expect(ok(await s.fetchOlder({ chat: CAROL }))).toMatchObject({ status: "unavailable", message: "WhatsApp is not linked." });
    expect(fake.historyRequests).toHaveLength(0);
  });

  it("keeps what was fetched past the 90 days the program otherwise keeps", async () => {
    const { account, s } = await withCarol();
    const old = clock.t - 200 * DAY;
    fake.olderAnswers = [[msg(CAROL, "ANCIENT", old)]];
    expect(ok(await s.fetchOlder({ chat: CAROL }))).toMatchObject({ status: "loaded", oldestAt: old });
    await prune(account);
    expect(ok(await s.messages(CAROL, { limit: 10 })).map((m) => m.id)).toEqual(["ANCIENT", "H2", "H3"]);
    // The link-time summary is still pruned at 90 days, as before.
    await seed(account, [msg(CAROL, "SUMMARY", clock.t - 120 * DAY)]);
    await prune(account);
    expect(ok(await s.messages(CAROL, { limit: 10 })).map((m) => m.id)).not.toContain("SUMMARY");
  });

  it("is a method of the JSON interface", async () => {
    const r = await SELF.fetch("https://whatsapp.internal/rpc/fetchOlder", { method: "POST", headers: { "x-slimefolk-account": freshAccount() }, body: JSON.stringify({ args: [{ chat: CAROL }] }) });
    expect(await r.json()).toMatchObject({ ok: true, value: { status: "unavailable" } });
  });
});
