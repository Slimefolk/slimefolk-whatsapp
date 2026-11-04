import { SELF, env, runInDurableObject } from "cloudflare:test";
import { createCipheriv, createHmac } from "node:crypto";
import { getMediaKeys } from "baileys";
import { afterEach, describe, expect, it } from "vitest";
import { fetchVoiceNote, VOICE_MAX_BYTES } from "../src/voice.ts";
import { toWaMessage } from "../src/baileys.ts";
import { WaStore } from "../src/store.ts";
import { resetWaTestHooks, waTestHooks } from "../src/testing.ts";
import type { WhatsApp } from "../src/do.ts";
import type { VoiceMedia } from "../src/adapter.ts";

const media: VoiceMedia = { key: Buffer.alloc(32, 42).toString("base64"), directPath: "/test-note", mime: "audio/ogg", seconds: 600, bytes: 12 };
afterEach(resetWaTestHooks);

async function encrypted(text: Uint8Array) {
  const { cipherKey, iv, macKey } = await getMediaKeys(Buffer.from(media.key, "base64"), "audio");
  if (!macKey) throw new Error("audio key missing");
  const cipher = createCipheriv("aes-256-cbc", cipherKey, iv);
  const body = Buffer.concat([cipher.update(text), cipher.final()]);
  return Buffer.concat([body, createHmac("sha256", macKey).update(iv).update(body).digest().subarray(0, 10)]);
}

describe("transient voice note download", () => {
  it("decrypts authenticated bytes entirely in memory, allowing exactly ten minutes", async () => {
    const audio = Buffer.from("fake ogg data");
    const bytes = await encrypted(audio);
    const result = await fetchVoiceNote(media, (async () => new Response(bytes)) as typeof fetch);
    expect(result).toEqual({ status: "ok", audio: audio.toString("base64"), mime: "audio/ogg", seconds: 600 });
    bytes[0] = bytes[0]! ^ 1;
    expect(await fetchVoiceNote(media, (async () => new Response(bytes)) as typeof fetch)).toEqual({ status: "failed" });
  });

  it("refuses either advertised bound before downloading, and rejects an oversized streamed body even if metadata lies", async () => {
    let calls = 0;
    const noFetch = (async () => { calls++; throw new Error("must not fetch"); }) as typeof fetch;
    expect(await fetchVoiceNote({ ...media, seconds: 601 }, noFetch)).toEqual({ status: "too long" });
    expect(await fetchVoiceNote({ ...media, bytes: VOICE_MAX_BYTES + 1 }, noFetch)).toEqual({ status: "too long" });
    expect(calls).toBe(0);
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(VOICE_MAX_BYTES + 27)); },
      cancel() { cancelled = true; },
    });
    expect(await fetchVoiceNote(media, (async () => new Response(body)) as typeof fetch)).toEqual({ status: "too long" });
    expect(cancelled).toBe(true);
  });

  it("accepts the byte boundary, refuses the next byte, and marks expired media unavailable", async () => {
    const bytes = await encrypted(new Uint8Array(VOICE_MAX_BYTES));
    expect((await fetchVoiceNote({ ...media, bytes: VOICE_MAX_BYTES }, (async () => new Response(bytes)) as typeof fetch)).status).toBe("ok");
    const over = await encrypted(new Uint8Array(VOICE_MAX_BYTES + 1));
    expect(await fetchVoiceNote(media, (async () => new Response(over)) as typeof fetch)).toEqual({ status: "too long" });
    for (const status of [404, 410]) expect(await fetchVoiceNote(media, (async () => new Response(null, { status })) as typeof fetch)).toEqual({ status: "unavailable" });
    expect(await fetchVoiceNote({ ...media, directPath: undefined, url: "https://attacker.example/audio" }, noNetwork)).toEqual({ status: "unavailable" });
  });

  it("retains only received media metadata with its message, never exports it in history, and uses account-scoped RPC", async () => {
    const m = toWaMessage({ key: { id: "v1", remoteJid: "15550198@s.whatsapp.net" }, messageTimestamp: 1_800_000_000, message: { audioMessage: { ptt: true, mediaKey: Buffer.from(media.key, "base64"), directPath: media.directPath, seconds: 12, fileLength: 12, mimetype: media.mime } } }, undefined)!;
    expect(m.voice).toMatchObject({ key: media.key, seconds: 12 });
    const account = `voice-${crypto.randomUUID()}`;
    const stub = env.WHATSAPP.get(env.WHATSAPP.idFromName(account));
    let fetched = 0;
    waTestHooks().adapter = { connect: async () => { throw new Error("no socket needed"); }, fetchVoiceNote: async () => (fetched++, { status: "ok", audio: btoa("fake"), mime: "audio/ogg", seconds: 12 }) };
    await runInDurableObject(stub, async (inst: WhatsApp) => {
      new WaStore(inst.db).addMessages([m], "history");
      const history = await inst.history({ id: "v1", limit: 1 });
      expect(JSON.stringify(history)).not.toContain(media.key);
      const plan = inst.db.all<{ detail: string }>("EXPLAIN QUERY PLAN SELECT voice FROM wa_messages WHERE chat = ? AND id = ? AND kind = 'voice note'", m.chat, m.id);
      expect(plan.map((r) => r.detail).join(" ")).toMatch(/SEARCH wa_messages USING PRIMARY KEY/);
    });
    const call = (acct: string, id: string, includeAccount = true) => SELF.fetch("https://private.test/rpc/fetchVoiceNote", { method: "POST", headers: { "content-type": "application/json", ...(includeAccount ? { "x-slimefolk-account": acct } : {}) }, body: JSON.stringify({ args: [m.chat, id] }) });
    expect(await (await call(account, "v1")).json()).toMatchObject({ ok: true, value: { status: "ok", audio: btoa("fake") } });
    expect(await (await call(`${account}-other`, "v1")).json()).toMatchObject({ ok: true, value: { status: "unavailable" } });
    expect((await call(account, "v1", false)).status).toBe(400);
    expect(fetched).toBe(1);
    await runInDurableObject(stub, async (inst: WhatsApp) => {
      new WaStore(inst.db).eraseAll();
      expect(inst.db.all("SELECT voice FROM wa_messages")).toHaveLength(0);
    });
  });
});

const noNetwork = (async () => { throw new Error("network forbidden in test"); }) as typeof fetch;
