// Download only into memory. No socket/reupload, persistence or content-bearing logs.
import { createDecipheriv, createHmac, timingSafeEqual } from "node:crypto";
import { getMediaKeys } from "baileys";
import type { WaVoiceNote } from "../contract/index.ts";
import type { VoiceMedia } from "./adapter.ts";

export const VOICE_MAX_BYTES = 16 * 1024 * 1024;
export const VOICE_MAX_SECONDS = 600;

export async function fetchVoiceNote(media: VoiceMedia, fetcher: typeof fetch = fetch): Promise<WaVoiceNote> {
  if (media.seconds > VOICE_MAX_SECONDS || media.bytes > VOICE_MAX_BYTES) return { status: "too long" };
  if (!Number.isFinite(media.seconds) || media.seconds < 0 || !Number.isFinite(media.bytes) || media.bytes < 0 || !media.key) return { status: "unavailable" };
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 25_000);
  try {
    const url = new URL(media.directPath ? `https://mmg.whatsapp.net${media.directPath}` : media.url ?? "");
    if (url.protocol !== "https:" || url.port || url.username || url.password || !/(^|\.)whatsapp\.(net|com)$/.test(url.hostname)) return { status: "unavailable" };
    const response = await fetcher(url, { signal: abort.signal, redirect: "error" });
    if (response.status === 404 || response.status === 410) return { status: "unavailable" };
    if (!response.ok || !response.body) return { status: "failed" };
    // AES-CBC padding (up to 16 bytes), followed by WhatsApp's ten-byte MAC.
    const cap = VOICE_MAX_BYTES + 26;
    if (Number(response.headers.get("content-length")) > cap) return { status: "too long" };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > cap) return { status: "too long" };
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const encrypted = Buffer.concat(chunks, length);
    if (length <= 10) return { status: "failed" };
    const { cipherKey, iv, macKey } = await getMediaKeys(Buffer.from(media.key, "base64"), "audio");
    if (!macKey) return { status: "failed" };
    const ciphertext = encrypted.subarray(0, -10);
    const mac = createHmac("sha256", macKey).update(iv).update(ciphertext).digest().subarray(0, 10);
    if (!timingSafeEqual(mac, encrypted.subarray(-10))) return { status: "failed" };
    const decipher = createDecipheriv("aes-256-cbc", cipherKey, iv);
    const bytes = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (bytes.byteLength > VOICE_MAX_BYTES) return { status: "too long" };
    return { status: "ok", audio: bytes.toString("base64"), mime: media.mime, seconds: media.seconds };
  } catch {
    return { status: "failed" };
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}
