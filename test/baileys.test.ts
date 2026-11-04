// The real client (Baileys) inside workerd, against a fake WhatsApp server in the test worker: the Noise handshake, the encrypted
// transport, login with a stored (sealed) login, the offline queue ending a check, pairing-code request, and a 401 mapped to a
// pairing that was refused. Never touches WhatsApp.
import { env, runInDurableObject } from "cloudflare:test";
import { BufferJSON, initAuthCreds, proto } from "baileys";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerLog } from "./support/fake-wa-server.ts";
import type { WhatsApp } from "../src/do.ts";
import { sealedAuth } from "../src/sql.ts";
import { resetWaTestHooks, waTestHooks } from "../src/testing.ts";

let n = 0;
const fresh = () => `real-${Date.now().toString(36)}-${++n}`;
let mode = "login-offline-drained";
let fakeName = "";

beforeEach(() => {
  const hooks = waTestHooks();
  hooks.timing = { connectMs: 8000, pollMaxMs: 8000, quietMs: 60, quietMaxMs: 300, firstSyncMs: 8000, firstQuietMs: 60, firstQuietMaxMs: 300 };
  hooks.post = async () => ({ ok: true, status: 200 });
  hooks.wsFetch = (url, init) => {
    const fake = env.FAKE_WA.get(env.FAKE_WA.idFromName(fakeName));
    return fake.fetch(`${url}?mode=${mode}`, init);
  };
});
afterEach(() => resetWaTestHooks());

const stub = (a: string) => env.WHATSAPP.get(env.WHATSAPP.idFromName(a));
const rpc = (a: string): WhatsApp => stub(a) as unknown as WhatsApp;
const fakeLog = async () => ((await (await env.FAKE_WA.get(env.FAKE_WA.idFromName(fakeName)).fetch("https://fake/log")).json()) as { server: ServerLog; headers: Record<string, string> });

async function seedLinked(account: string): Promise<void> {
  const creds = initAuthCreds();
  creds.me = { id: "15550100:7@s.whatsapp.net", name: "Test" };
  creds.registered = true;
  await runInDurableObject(stub(account), async (inst: WhatsApp, state) => {
    const sealed = (inst as unknown as { sealed: { store: Parameters<typeof sealedAuth>[0] } }).sealed;
    await sealedAuth(sealed.store).put("creds", JSON.stringify(creds, BufferJSON.replacer));
    const now = Date.now();
    for (const [k, v] of Object.entries({ state: "linked", number: "15550100", name: "Test", linked_at: now - 1000, last_poll_at: now - 1000, next_poll_at: now })) {
      state.storage.sql.exec("INSERT INTO wa_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", k, String(v));
    }
  });
}

describe("the real client against a fake WhatsApp server", () => {
  it("logs in from the sealed login, takes the offline queue, ends the check by itself, and saves the login", async () => {
    const account = fresh();
    fakeName = `fake-${account}`;
    mode = "login-offline-drained";
    await seedLinked(account);
    const r = await rpc(account).refresh();
    expect(r).toMatchObject({ ok: true, value: { ok: true } });
    const { server, headers } = await fakeLog();
    expect(headers.origin).toBe("https://web.whatsapp.com");
    expect(server.clientPayload).toMatchObject({ username: "15550100", hasPairingData: false });
    expect(server.received.some((x) => x.includes("xmlns=passive"))).toBe(true);
    const st = await rpc(account).status();
    expect(st).toMatchObject({ ok: true, value: { state: "linked", connected: false } });
  });

  it("asks for a pairing code, gets eight characters, and treats a refused pairing as unlinked with a clear reason", async () => {
    const account = fresh();
    fakeName = `fake-${account}`;
    mode = "pair-then-logout";
    const started = await rpc(account).startPairing({ method: "code", phone: "15550100" });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.pairing?.code).toMatch(/^[0-9A-Z]{8}$/);
    const { server } = await fakeLog();
    expect(server.clientPayload?.hasPairingData).toBe(true);
    expect(server.pairingCodeRequest).toMatchObject({ stage: "companion_hello", jid: "15550100@s.whatsapp.net" });
    // The fake server answers the request with a 401.
    const end = Date.now() + 5000;
    let state = "pairing";
    while (Date.now() < end && state === "pairing") {
      await new Promise((r) => setTimeout(r, 40));
      const s = await rpc(account).status();
      if (s.ok) state = s.value.state;
    }
    expect(state).toBe("unlinked");
    const s = await rpc(account).status();
    expect(s.ok && s.value.lastError).toContain("rejected");
  });
});

describe("incoming list replies", () => {
  it("keeps the text of the option the person selected", async () => {
    const { toWaMessage } = await import("../src/baileys.ts");
    const key = { id: "list-reply", remoteJid: "15550109@s.whatsapp.net" };
    const decoded = proto.WebMessageInfo.decode(proto.WebMessageInfo.encode({ key, messageTimestamp: 1_700_000_000, message: {
      listResponseMessage: { title: "Deliver tomorrow", singleSelectReply: { selectedRowId: "tomorrow" } },
    } }).finish());
    expect(toWaMessage({ ...decoded, key }, undefined)).toMatchObject({ kind: "text", text: "Deliver tomorrow" });
  });
});

describe("incoming button replies", () => {
  it.each([
    { buttonsResponseMessage: { selectedButtonId: "confirm", selectedDisplayText: "Confirm appointment" } },
    { templateButtonReplyMessage: { selectedId: "confirm", selectedDisplayText: "Confirm appointment" } },
  ])("keeps the selected button label: %j", async (message) => {
    const { toWaMessage } = await import("../src/baileys.ts");
    const key = { id: "button-reply", remoteJid: "15550109@s.whatsapp.net" };
    const decoded = proto.WebMessageInfo.decode(proto.WebMessageInfo.encode({ key, messageTimestamp: 1_700_000_000, message }).finish());
    expect(toWaMessage({ ...decoded, key }, undefined)).toMatchObject({ kind: "text", text: "Confirm appointment" });
  });
});

describe("incoming documents", () => {
  it.each([
    { caption: undefined, text: "quarterly-report.pdf" },
    { caption: "", text: "quarterly-report.pdf" },
    { caption: "Please review before Friday", text: "Please review before Friday" },
  ])("uses the caption or falls back to the filename: $caption", async ({ caption, text }) => {
    const { toWaMessage } = await import("../src/baileys.ts");
    const key = { id: "document", remoteJid: "15550109@s.whatsapp.net" };
    const decoded = proto.WebMessageInfo.decode(proto.WebMessageInfo.encode({ key, messageTimestamp: 1_700_000_000, message: {
      documentMessage: { fileName: "quarterly-report.pdf", ...(caption !== undefined ? { caption } : {}) },
    } }).finish());
    expect(toWaMessage({ ...decoded, key }, undefined)).toMatchObject({ kind: "document", text });
  });
});

describe("incoming location messages", () => {
  it("preserves a live-location caption and a static location's name", async () => {
    const { toWaMessage } = await import("../src/baileys.ts");
    const base = { messageTimestamp: 1_700_000_000, key: { id: "location", remoteJid: "15550109@s.whatsapp.net" } };
    const live = proto.WebMessageInfo.decode(proto.WebMessageInfo.encode({ ...base, message: {
      liveLocationMessage: { degreesLatitude: 52.5, degreesLongitude: 13.4, caption: "Walking home" },
    } }).finish());
    expect(toWaMessage({ ...live, key: base.key }, undefined)).toMatchObject({ kind: "location", text: "Walking home" });
    const fixed = proto.WebMessageInfo.decode(proto.WebMessageInfo.encode({ ...base, message: {
      locationMessage: { degreesLatitude: 52.6, degreesLongitude: 13.5, name: "Meeting point" },
    } }).finish());
    expect(toWaMessage({ ...fixed, key: base.key }, undefined)).toMatchObject({ kind: "location", text: "Meeting point" });
  });
});

describe("the quoted message id", () => {
  const GROUP = "120363000000000000@g.us";
  const base = { messageTimestamp: 1_700_000_000, key: { id: "R1", remoteJid: GROUP, participant: "15550109@s.whatsapp.net" } };
  it("reads contextInfo.stanzaId from an extended text reply, a captioned image reply, and one inside an ephemeral wrapper", async () => {
    const { toWaMessage } = await import("../src/baileys.ts");
    const text = toWaMessage({ ...base, message: { extendedTextMessage: { text: "yes please", contextInfo: { stanzaId: "3EB0QUOTED", participant: "15550100@s.whatsapp.net", quotedMessage: { conversation: "dinner?" } } } } } as never, "15550100@s.whatsapp.net")!;
    expect(text).toMatchObject({ kind: "text", text: "yes please", quotedId: "3EB0QUOTED" });
    const image = toWaMessage({ ...base, message: { imageMessage: { caption: "look", contextInfo: { stanzaId: "3EB0IMG" } } } } as never, "me@s.whatsapp.net")!;
    expect(image.quotedId).toBe("3EB0IMG");
    const wrapped = toWaMessage({ ...base, message: { ephemeralMessage: { message: { extendedTextMessage: { text: "ok", contextInfo: { stanzaId: "3EB0WRAP" } } } } } } as never, "me@s.whatsapp.net")!;
    expect(wrapped.quotedId).toBe("3EB0WRAP");
  });
  it("has none for a message that quotes nothing, or whose id is not a string", async () => {
    const { toWaMessage } = await import("../src/baileys.ts");
    expect("quotedId" in toWaMessage({ ...base, message: { conversation: "hi" } } as never, "me@s.whatsapp.net")!).toBe(false);
    expect("quotedId" in toWaMessage({ ...base, message: { extendedTextMessage: { text: "x", contextInfo: { mentionedJid: ["a@s.whatsapp.net"] } } } } as never, "me@s.whatsapp.net")!).toBe(false);
    expect("quotedId" in toWaMessage({ ...base, message: { extendedTextMessage: { text: "x", contextInfo: { stanzaId: 42 } } } } as never, "me@s.whatsapp.net")!).toBe(false);
  });
});

describe("the translation of ids", () => {
  it("keeps both ids of a person when WhatsApp sends both, and never invents one", async () => {
    const { toWaMessage } = await import("../src/baileys.ts");
    const PN = "15550109@s.whatsapp.net";
    const LID = "99887766554433@lid";
    const base = { message: { conversation: "hi" }, messageTimestamp: 1_700_000_000 };
    const a = toWaMessage({ ...base, key: { id: "X1", remoteJid: LID, remoteJidAlt: PN } } as never, "me@s.whatsapp.net")!;
    expect(a).toMatchObject({ chat: LID, chatAlt: PN, sender: LID, senderAlt: PN });
    const b = toWaMessage({ ...base, key: { id: "X2", remoteJid: PN, remoteJidAlt: LID } } as never, "me@s.whatsapp.net")!;
    expect(b).toMatchObject({ chat: PN, chatAlt: LID });
    const c = toWaMessage({ ...base, key: { id: "X3", remoteJid: LID } } as never, "me@s.whatsapp.net")!;
    expect(c.chatAlt).toBeUndefined();
    // A group message: the alternate belongs to the member, not to the group.
    const g = toWaMessage({ ...base, key: { id: "X4", remoteJid: "120363000000000000@g.us", participant: LID, participantAlt: PN } } as never, "me@s.whatsapp.net")!;
    expect(g).toMatchObject({ chat: "120363000000000000@g.us", sender: LID, senderAlt: PN });
    expect(g.chatAlt).toBeUndefined();
    // A message we sent from another device: the alternate id is ours, not the chat's, so it is never a mapping for the chat.
    const mine = toWaMessage({ ...base, key: { id: "X6", remoteJid: LID, remoteJidAlt: "15550100@s.whatsapp.net", fromMe: true } } as never, "15550100@s.whatsapp.net")!;
    expect(mine.chatAlt).toBeUndefined();
    expect(mine.senderAlt).toBeUndefined();
    // A mismatched "alternate" (same kind of id) is not a mapping.
    const d = toWaMessage({ ...base, key: { id: "X5", remoteJid: PN, remoteJidAlt: "15550110@s.whatsapp.net" } } as never, "me@s.whatsapp.net")!;
    expect(d.chatAlt).toBeUndefined();
  });
});

describe("group members and mentions from the protocol", () => {
  it("reads the tagged jids of a message, without device parts, and nothing when it tags nobody", async () => {
    const { toWaMessage } = await import("../src/baileys.ts");
    const base = { messageTimestamp: 1_700_000_000, key: { id: "T1", remoteJid: "120363000000000000@g.us", participant: "15550121@s.whatsapp.net" } };
    const tagged = toWaMessage({ ...base, message: { extendedTextMessage: { text: "@Bob hi", contextInfo: { mentionedJid: ["15550122:3@s.whatsapp.net", "15550122@s.whatsapp.net", "77788899900011@lid"] } } } } as never, "me@s.whatsapp.net")!;
    expect(tagged.mentions).toEqual(["15550122@s.whatsapp.net", "77788899900011@lid"]);
    const plain = toWaMessage({ ...base, key: { ...base.key, id: "T2" }, message: { conversation: "hi" } } as never, "me@s.whatsapp.net")!;
    expect(plain.mentions).toBeUndefined();
  });

  it("maps a group's participants: both forms of an id, and the admin flag", async () => {
    const { toWaGroup } = await import("../src/baileys.ts");
    const g = toWaGroup({
      id: "120363000000000000@g.us",
      subject: "Flat",
      participants: [
        { id: "77788899900011@lid", phoneNumber: "15550123@s.whatsapp.net", admin: "superadmin" },
        { id: "15550122@s.whatsapp.net", admin: null },
      ],
    } as never)!;
    expect(g).toEqual({ jid: "120363000000000000@g.us", subject: "Flat", members: [{ jid: "77788899900011@lid", altJid: "15550123@s.whatsapp.net", admin: true }, { jid: "15550122@s.whatsapp.net" }] });
    expect(toWaGroup({ id: "15550122@s.whatsapp.net" } as never)).toBeUndefined();
    expect(toWaGroup({ id: "120363000000000000@g.us", subject: "New name" } as never)).toEqual({ jid: "120363000000000000@g.us", subject: "New name" });
  });
});
