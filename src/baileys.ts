// The real `WaAdapter`: a translation between Baileys (the WhatsApp Web multi-device client) and the seam in adapter.ts. Nothing in
// here decides anything; it maps Baileys' events to ours and keeps the login in the sealed `AuthKv`. Baileys and its Signal library
// are GPL-3.0 (via libsignal), which is why this program is licensed AGPL-3.0 and kept separate from any other code.
//
// What the spike found and this handles (docs/design/whatsapp.md): the transport and a Buffer bug are patched at load; the WASM
// helper is replaced by a precompiled copy through the `alias` in wrangler.jsonc; stored creds are revived with BufferJSON.
import makeWASocket, { Browsers, BufferJSON, DisconnectReason, getContentType, initAuthCreds, jidNormalizedUser, normalizeMessageContent, proto } from "baileys";
import type { AuthenticationCreds, ConnectionState, Contact, WAMessage, SignalDataSet, SignalDataTypeMap, SignalKeyStore, Chat, GroupMetadata, GroupParticipant } from "baileys";
import { AUTH_CREDS_KEY, type AuthKv, type WaAdapter, type WaChat, type WaCloseReason, type WaConnectOptions, type WaConnection, type WaContact, type WaGroup, type WaGroupMember, type WaLidPair, type WaMessage } from "./adapter.ts";
import { installWorkerdBufferFix } from "./buffer-fix.ts";
import { waTestHooks } from "./testing.ts";
import { installWorkerdTransport } from "./transport.ts";
import { fetchVoiceNote } from "./voice.ts";

const KEY_PREFIX = "k/";
const PAIR_READY_MS = 30_000;

/** Silent: Baileys' log lines can carry message ids and contents. Only the short message of a warning or error is kept. */
const logger = (() => {
  const l = {
    level: "warn",
    child: () => l,
    trace: () => {},
    debug: () => {},
    info: () => {},
    warn: (_o: unknown, msg?: string) => void (msg && console.warn("whatsapp: baileys", msg.slice(0, 200))),
    error: (_o: unknown, msg?: string) => void (msg && console.warn("whatsapp: baileys error", msg.slice(0, 200))),
  };
  return l;
})();

/** Signal keys, one sealed row per (type, id), values written with BufferJSON so Buffers come back as Buffers. */
function keyStore(auth: AuthKv): SignalKeyStore {
  return {
    async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
      const out: { [id: string]: SignalDataTypeMap[T] } = {};
      await Promise.all(
        ids.map(async (id) => {
          const raw = await auth.get(`${KEY_PREFIX}${type}/${id}`);
          if (raw) out[id] = JSON.parse(raw, BufferJSON.reviver) as SignalDataTypeMap[T];
        }),
      );
      return out;
    },
    async set(data: SignalDataSet) {
      const jobs: Array<Promise<void>> = [];
      for (const [type, byId] of Object.entries(data)) {
        for (const [id, value] of Object.entries(byId ?? {})) {
          const key = `${KEY_PREFIX}${type}/${id}`;
          jobs.push(value == null ? auth.delete(key) : auth.put(key, JSON.stringify(value, BufferJSON.replacer)));
        }
      }
      await Promise.all(jobs);
    },
  };
}

const toMs = (t: unknown): number => {
  const n = typeof t === "number" ? t : t && typeof (t as { toNumber?: () => number }).toNumber === "function" ? (t as { toNumber(): number }).toNumber() : Number(t ?? 0);
  return Number.isFinite(n) && n > 0 ? n * 1000 : 0;
};

const isPn = (jid: string | null | undefined): jid is string => !!jid && jid.endsWith("@s.whatsapp.net");
const isLidJid = (jid: string | null | undefined): jid is string => !!jid && jid.endsWith("@lid");

/** A jid as WhatsApp gave it, without its device part. Which of the two forms is the chat's is decided by the store, from what it learned. */
const norm = (jid: string | null | undefined): string => (jid ? jidNormalizedUser(jid) : "");
/** The other form of an id, when it really is the other form (a phone id for a hidden-number id or the reverse). */
const altOf = (jid: string, alt: string | null | undefined): string | undefined => {
  if (!alt) return undefined;
  const a = jidNormalizedUser(alt);
  return (isLidJid(jid) && isPn(a)) || (isPn(jid) && isLidJid(a)) ? a : undefined;
};

function kindOf(content: ReturnType<typeof normalizeMessageContent>): { kind: string; text: string } | undefined {
  if (!content) return undefined;
  const type = getContentType(content);
  const c = content as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (type) {
    case "conversation":
      return { kind: "text", text: String(c.conversation ?? "") };
    case "extendedTextMessage":
      return { kind: "text", text: String(c.extendedTextMessage?.text ?? "") };
    case "listResponseMessage":
      return { kind: "text", text: String(c.listResponseMessage?.title ?? "") };
    case "buttonsResponseMessage":
    case "templateButtonReplyMessage":
      return { kind: "text", text: String(c[type]?.selectedDisplayText ?? "") };
    case "imageMessage":
      return { kind: "image", text: String(c.imageMessage?.caption ?? "") };
    case "videoMessage":
      return { kind: "video", text: String(c.videoMessage?.caption ?? "") };
    case "audioMessage":
      return { kind: c.audioMessage?.ptt ? "voice note" : "audio", text: "" };
    case "documentMessage":
      return { kind: "document", text: String(c.documentMessage?.caption || c.documentMessage?.fileName || "") };
    case "stickerMessage":
      return { kind: "sticker", text: "" };
    case "locationMessage":
      return { kind: "location", text: String(c.locationMessage?.name ?? "") };
    case "liveLocationMessage":
      return { kind: "location", text: String(c.liveLocationMessage?.caption ?? "") };
    case "contactMessage":
    case "contactsArrayMessage":
      return { kind: "contact", text: String(c[type]?.displayName ?? "") };
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3":
      return { kind: "poll", text: String(c[type]?.name ?? "") };
    case "reactionMessage":
      return { kind: "reaction", text: String(c.reactionMessage?.text ?? "") };
    case undefined:
      return undefined;
    // Protocol housekeeping (key distribution, revokes, history notices) is not a message the person would read.
    case "protocolMessage":
    case "senderKeyDistributionMessage":
    case "messageContextInfo":
      return undefined;
    default:
      return { kind: "other", text: "" };
  }
}

/** The id of the message a reply quotes (`contextInfo.stanzaId` of whatever content the message carries), or undefined for a message that quotes nothing. */
export function quotedIdOf(content: ReturnType<typeof normalizeMessageContent>): string | undefined {
  if (!content) return undefined;
  const type = getContentType(content);
  if (!type) return undefined;
  const id = ((content as Record<string, any>)[type] as { contextInfo?: { stanzaId?: unknown } } | undefined)?.contextInfo?.stanzaId; // eslint-disable-line @typescript-eslint/no-explicit-any
  return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : undefined;
}

/** The jids a message tags (`contextInfo.mentionedJid` of whatever content it carries), without their device part; undefined when it tags nobody. */
export function mentionsOf(content: ReturnType<typeof normalizeMessageContent>): string[] | undefined {
  if (!content) return undefined;
  const type = getContentType(content);
  if (!type) return undefined;
  const list = ((content as Record<string, any>)[type] as { contextInfo?: { mentionedJid?: unknown } } | undefined)?.contextInfo?.mentionedJid; // eslint-disable-line @typescript-eslint/no-explicit-any
  if (!Array.isArray(list)) return undefined;
  const out = [...new Set(list.filter((j): j is string => typeof j === "string" && j.length > 0 && j.length <= 100).map((j) => norm(j)).filter(Boolean))].slice(0, 50);
  return out.length ? out : undefined;
}

/** One group member in our shape: WhatsApp lists the id it uses for the group, and sometimes the other form beside it. */
export function toWaMember(p: GroupParticipant): WaGroupMember | undefined {
  if (!p?.id) return undefined;
  const jid = norm(p.id);
  const alt = altOf(jid, p.phoneNumber ? (p.phoneNumber.includes("@") ? p.phoneNumber : `${p.phoneNumber.replace(/\D/g, "")}@s.whatsapp.net`) : undefined) ?? altOf(jid, p.lid);
  const admin = p.admin === "admin" || p.admin === "superadmin" || p.isAdmin === true || p.isSuperAdmin === true;
  return { jid, ...(alt ? { altJid: alt } : {}), ...(admin ? { admin: true } : {}) };
}

/** A group's metadata in our shape. */
export function toWaGroup(g: Partial<GroupMetadata>): WaGroup | undefined {
  if (!g.id || !g.id.endsWith("@g.us")) return undefined;
  return { jid: norm(g.id), ...(g.subject ? { subject: g.subject } : {}), ...(Array.isArray(g.participants) ? { members: g.participants.map(toWaMember).filter(nonNull) } : {}) };
}

/** One WhatsApp message in our shape, or undefined when it is not something to keep. */
export function toWaMessage(m: WAMessage, myJid: string | undefined): WaMessage | undefined {
  const key = m.key;
  if (!key?.id || !key.remoteJid) return undefined;
  if (key.remoteJid === "status@broadcast" || key.remoteJid.endsWith("@newsletter") || key.remoteJid.endsWith("@broadcast")) return undefined;
  const normalized = normalizeMessageContent(m.message);
  const content = kindOf(normalized);
  if (!content) return undefined;
  const quotedId = quotedIdOf(normalized);
  const mentions = mentionsOf(normalized);
  if (content.kind === "reaction") return undefined;
  const chat = norm(key.remoteJid);
  const fromMe = !!key.fromMe;
  // Baileys' `remoteJidAlt` is the other id of whoever sent the message. For a message we sent ourselves that is us, not the chat.
  const chatAlt = fromMe ? undefined : altOf(chat, key.remoteJidAlt);
  const senderRaw = fromMe ? (myJid ?? chat) : norm(key.participant ?? key.remoteJid);
  const senderAlt = fromMe ? undefined : altOf(senderRaw, key.participant ? key.participantAlt : (key.participantAlt ?? key.remoteJidAlt));
  const sender = senderRaw;
  const at = toMs(m.messageTimestamp);
  return {
    id: key.id,
    chat,
    ...(chatAlt ? { chatAlt } : {}),
    sender,
    ...(senderAlt ? { senderAlt } : {}),
    ...(!fromMe && m.pushName ? { pushName: m.pushName } : {}),
    fromMe,
    at: at || Date.now(),
    text: content.text,
    kind: content.kind,
    ...(quotedId ? { quotedId } : {}),
    ...(mentions ? { mentions } : {}),
    ...(content.kind === "voice note" && normalized?.audioMessage ? { voice: {
      key: Buffer.from(normalized.audioMessage.mediaKey ?? []).toString("base64"),
      ...(normalized.audioMessage.directPath ? { directPath: normalized.audioMessage.directPath } : {}),
      ...(normalized.audioMessage.url ? { url: normalized.audioMessage.url } : {}),
      seconds: Number(normalized.audioMessage.seconds ?? -1),
      bytes: Number(normalized.audioMessage.fileLength ?? -1),
      mime: normalized.audioMessage.mimetype ?? "audio/ogg",
    } } : {}),
  };
}

const toWaChat = (c: Partial<Chat>): WaChat | undefined => {
  if (!c.id || c.id === "status@broadcast" || c.id.endsWith("@newsletter")) return undefined;
  const lastAt = toMs(c.conversationTimestamp);
  const jid = norm(c.id);
  // `accountLid` is the linked account's own id on some records, so it is never read as the chat's other id.
  const alt = altOf(jid, c.pnJid) ?? altOf(jid, c.lidJid);
  return {
    jid,
    ...(c.name ? { name: c.name } : {}),
    ...(typeof c.unreadCount === "number" ? { unread: Math.max(0, c.unreadCount) } : {}),
    ...(lastAt ? { lastAt } : {}),
    ...(typeof c.archived === "boolean" ? { archived: c.archived } : {}),
    ...(alt ? { altJid: alt } : {}),
  };
};

const toWaContact = (c: Partial<Contact>): WaContact | undefined => {
  if (!c.id) return undefined;
  const id = norm(c.id);
  const phone = c.phoneNumber ? (c.phoneNumber.includes("@") ? norm(c.phoneNumber) : `${c.phoneNumber.replace(/\D/g, "")}@s.whatsapp.net`) : undefined;
  const other = [phone, c.lid ? norm(c.lid) : undefined].find((x) => altOf(id, x));
  return { jid: id, ...(c.name ? { name: c.name } : {}), ...(c.notify ? { notify: c.notify } : {}), ...(other ? { altJid: other } : {}) };
};

const nonNull = <T>(x: T | undefined): x is T => x !== undefined;

function closeReason(code: number | undefined): WaCloseReason {
  switch (code) {
    case DisconnectReason.loggedOut:
      return "logged_out";
    case DisconnectReason.restartRequired:
      return "restart_required";
    case DisconnectReason.connectionReplaced:
      return "replaced";
    case DisconnectReason.forbidden:
      return "forbidden";
    case DisconnectReason.connectionClosed:
    case DisconnectReason.connectionLost:
    case DisconnectReason.timedOut:
    case DisconnectReason.unavailableService:
      return "connection_lost";
    default:
      return "other";
  }
}

export function baileysAdapter(): WaAdapter {
  installWorkerdTransport();
  installWorkerdBufferFix();
  return {
    fetchVoiceNote,
    async connect(o: WaConnectOptions): Promise<WaConnection> {
      const stored = await o.auth.get(AUTH_CREDS_KEY);
      const creds: AuthenticationCreds = stored ? (JSON.parse(stored, BufferJSON.reviver) as AuthenticationCreds) : initAuthCreds();
      const keys = keyStore(o.auth);

      // Credential writes are ordered, and the connection's `close` waits for them: a pairing login must be on disk before the
      // "restart required" that follows it is reported.
      let saving: Promise<void> = Promise.resolve();
      const saveCreds = (): void => {
        saving = saving.then(() => o.auth.put(AUTH_CREDS_KEY, JSON.stringify(creds, BufferJSON.replacer))).catch((e) => console.warn("whatsapp: could not save the login", e instanceof Error ? e.message : e));
      };

      const sock = makeWASocket({
        auth: { creds, keys },
        logger: logger as never,
        // The phone shows this under Linked devices. WhatsApp only accepts a pairing code for a known browser name.
        browser: Browsers.macOS("Chrome"),
        // Reading is the whole point and a presence of "online" would silence the phone's own notifications.
        markOnlineOnConnect: false,
        syncFullHistory: false,
        printQRInTerminal: false,
        generateHighQualityLinkPreview: false,
        connectTimeoutMs: 20_000,
        // We never retry a send from our cache: a lost message is reported to the person, not resent behind their back.
        getMessage: async () => undefined,
        ...(waTestHooks().wsFetch ? { wsFetch: waTestHooks().wsFetch } : {}),
      } as never);

      let drained = false;
      let closed = false;
      let pairingCode: string | undefined;
      let pairError: Error | undefined;
      let pairReady: (() => void) | undefined;
      const readyForPairing = new Promise<void>((resolve) => (pairReady = resolve));
      const myJid = (): string | undefined => (sock.user?.id ? jidNormalizedUser(sock.user.id) : undefined);

      sock.ev.on("creds.update", (u) => {
        Object.assign(creds, u);
        saveCreds();
      });

      sock.ev.on("connection.update", (u: Partial<ConnectionState>) => {
        if (u.qr) {
          if (o.pairPhone) {
            // A code is requested once the server is ready for a new device, which is when it would show a QR.
            pairReady?.();
          } else o.events.qr(u.qr);
        }
        if (u.connection === "open") o.events.open({ id: sock.user?.id ?? "", ...(sock.user?.name ? { name: sock.user.name } : {}), ...(sock.user?.lid ? { lid: jidNormalizedUser(sock.user.lid) } : {}) });
        if (u.receivedPendingNotifications === true && !drained) {
          drained = true;
          o.events.drained();
        }
        if (u.connection === "close" && !closed) {
          closed = true;
          const err = u.lastDisconnect?.error as { output?: { statusCode?: number }; message?: string } | undefined;
          const code = err?.output?.statusCode;
          const reason = closeReason(code);
          // The credentials Baileys just changed (a pairing login) are written before anyone is told the connection ended.
          void saving.finally(() => o.events.close(reason, reason === "other" || reason === "connection_lost" ? (err?.message ?? (code ? `status ${code}` : undefined)) : undefined));
        }
      });

      sock.ev.on("messaging-history.set", ({ chats, contacts, messages, lidPnMappings, syncType }) => {
        const me = myJid();
        o.events.history({
          // The phone's answer to `fetchMessageHistory` is the ON_DEMAND type; the link-time sync is not.
          ...(syncType === proto.HistorySync.HistorySyncType.ON_DEMAND ? { onDemand: true } : {}),
          chats: chats.map(toWaChat).filter(nonNull),
          contacts: contacts.map(toWaContact).filter(nonNull),
          messages: messages.map((m) => toWaMessage(m, me)).filter(nonNull),
          ...(lidPnMappings?.length ? { lidMappings: lidPnMappings.map((p): WaLidPair => ({ lid: p.lid, pn: p.pn })) } : {}),
        });
      });
      sock.ev.on("lid-mapping.update", (p) => o.events.lidMappings([{ lid: p.lid, pn: p.pn }]));
      sock.ev.on("messages.upsert", ({ messages }) => {
        const me = myJid();
        const ms = messages.map((m) => toWaMessage(m, me)).filter(nonNull);
        if (ms.length) o.events.messages(ms, drained ? "live" : "offline");
      });
      sock.ev.on("chats.upsert", (cs) => o.events.chats(cs.map(toWaChat).filter(nonNull)));
      sock.ev.on("chats.update", (cs) => o.events.chats(cs.map(toWaChat).filter(nonNull)));
      sock.ev.on("contacts.upsert", (cs) => o.events.contacts(cs.map(toWaContact).filter(nonNull)));
      sock.ev.on("contacts.update", (cs) => o.events.contacts(cs.map(toWaContact).filter(nonNull)));
      // Groups: a group WhatsApp describes (on joining one, or when its subject changes) and its member changes. No polling: these are
      // pushed. `groups.update` carries only what changed, so a record without participants only renames the group.
      sock.ev.on("groups.upsert", (gs) => o.events.groups(gs.map(toWaGroup).filter(nonNull)));
      sock.ev.on("groups.update", (gs) => o.events.groups(gs.map(toWaGroup).filter(nonNull)));
      sock.ev.on("group-participants.update", (u) => {
        const action = u.action === "add" || u.action === "remove" || u.action === "promote" || u.action === "demote" ? u.action : undefined;
        const members = (u.participants ?? []).map((p) => toWaMember(typeof p === "string" ? ({ id: p } as GroupParticipant) : p)).filter(nonNull);
        if (action && members.length && u.id.endsWith("@g.us")) o.events.groupChange({ jid: norm(u.id), action, members });
      });

      if (o.pairPhone) {
        const timeout = new Promise<never>((_, no) => setTimeout(() => no(new Error("WhatsApp did not become ready for pairing in time.")), PAIR_READY_MS));
        try {
          await Promise.race([readyForPairing, timeout]);
          pairingCode = await sock.requestPairingCode(o.pairPhone);
        } catch (e) {
          pairError = e instanceof Error ? e : new Error(String(e));
          try {
            void sock.end(undefined);
          } catch {
            /* nothing to close */
          }
          throw pairError;
        }
      }

      const connection: WaConnection = {
        ...(pairingCode ? { pairingCode } : {}),
        sendText: async (jid, text) => {
          const sent = await sock.sendMessage(jid, { text });
          if (!sent?.key?.id) throw new Error("WhatsApp did not confirm the message.");
          return { id: sent.key.id };
        },
        fetchHistory: async (count, anchor) => {
          // The request names the chat's oldest stored message; the phone answers over the same connection, as an ON_DEMAND history sync.
          await sock.fetchMessageHistory(count, { remoteJid: anchor.chat, id: anchor.id, fromMe: anchor.fromMe }, anchor.at);
        },
        groupMetadata: async (jid) => toWaGroup(await sock.groupMetadata(jid)) ?? null,
        pnForLid: async (lid) => (await sock.signalRepository.lidMapping.getPNForLID(lid)) ?? null,
        lookup: async (phone) => {
          const r = await sock.onWhatsApp(`${phone}@s.whatsapp.net`);
          const hit = r?.find((x) => x.exists);
          return hit ? hit.jid : null;
        },
        logout: async () => {
          await sock.logout();
        },
        close: () => {
          try {
            void sock.end(undefined);
          } catch {
            /* already closed */
          }
        },
      };
      return connection;
    },
  };
}
