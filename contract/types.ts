// The TypeScript shapes of the JSON contract, written by hand beside the JSON Schema files in ./schema (the schemas are the
// authority; test/contract.test.ts checks real answers against them). No runtime dependencies and no imports from outside
// contract/, so a caller can vendor this folder as it is.

/** Minutes between polls. Polling is the only mode ("stay connected" is future work: Slimefolk #746). */
export const WA_FREQUENCIES = [5, 10, 15, 30, 60] as const;
export type WhatsAppFrequency = (typeof WA_FREQUENCIES)[number];
export const WA_DEFAULT_FREQUENCY: WhatsAppFrequency = 15;

export const isWhatsAppFrequency = (v: unknown): v is WhatsAppFrequency => (WA_FREQUENCIES as readonly unknown[]).includes(v);

/** Milliseconds between polls. */
export const frequencyMs = (f: WhatsAppFrequency): number => f * 60_000;

export type WhatsAppState = "unlinked" | "pairing" | "linked" | "logged_out";

export interface WhatsAppPairing {
  method: "code" | "qr";
  /** The 8-character code to type under WhatsApp, Linked devices, Link with phone number (shown as ABCD-EFGH). */
  code?: string;
  /** The text to draw as a QR code (method "qr"); it changes every ~20 seconds. */
  qr?: string;
  /** The number the code was asked for (digits). */
  phone?: string;
  startedAt: number;
  expiresAt: number;
}

export interface WhatsAppStatus {
  state: WhatsAppState;
  /** The linked number, digits only. */
  number?: string;
  /** The name on the linked account, when known. */
  name?: string;
  /** A connection to WhatsApp is open right now. */
  connected: boolean;
  frequency: WhatsAppFrequency;
  lastPollAt?: number;
  nextPollAt?: number;
  lastError?: string;
  consecutiveFailures?: number;
  pairing?: WhatsAppPairing;
  /** When the phone unlinked this device (state "logged_out"). */
  loggedOutAt?: number;
  linkedAt?: number;
  counts: { chats: number; unread: number; messages: number };
  /** This deployment has the pieces WhatsApp needs (a key to seal the login with, a WhatsApp object). */
  available: boolean;
  /** Where the program reports to (the caller's address), once the caller has said. Never the secret that signs it. */
  hookUrl?: string;
}

export interface WhatsAppChatView {
  /** The chat's id: `15550101@s.whatsapp.net` or `120363000000000001@g.us`. */
  jid: string;
  name: string;
  isGroup: boolean;
  unread: number;
  lastAt: number;
  /** The start of the newest message. Outside text. */
  preview: string;
  lastFromMe: boolean;
  archived?: boolean;
  /** How many messages of this chat are stored (0: only WhatsApp's summary of it arrived). */
  stored?: number;
  /** A group's members, when the query asked (`members`). Names are outside text. */
  members?: WhatsAppMember[];
  /** How many members are stored for the group (may exceed `members`, which is cut). */
  memberCount?: number;
}

/** One member of a group. `savedName` is the one the person saved; `pushName` is chosen by the member and is not trusted. */
export interface WhatsAppMember {
  jid: string;
  savedName?: string;
  pushName?: string;
  admin?: boolean;
}

/** What `chatPage` asks for. `before` is the `next` cursor of an earlier page. */
export interface WhatsAppChatQuery {
  limit?: number;
  unreadOnly?: boolean;
  /** Only chats with activity at or after this time (epoch ms). */
  since?: number;
  before?: string;
  includeArchived?: boolean;
  /** Add each group's members. */
  members?: boolean;
}

/** One page of chats, newest activity first. */
export interface WhatsAppChatPage {
  chats: WhatsAppChatView[];
  /** Chats matching the query (all pages, archived ones excluded when they were). */
  total: number;
  /** More chats follow this page; pass `next` as `before`. */
  more: boolean;
  next?: string;
  /** Archived chats that match but were left out (includeArchived false). */
  archivedHidden: number;
  /** Chats WhatsApp gave no activity time for: they cannot be listed by time. */
  undated: number;
  /** Chats in the page that are archived. */
  archivedShown: number;
}

export interface WhatsAppMessageView {
  id: string;
  chat: string;
  /** Who wrote it: the sender's number for a chat, `me` for the linked person. */
  sender: string;
  senderName: string;
  fromMe: boolean;
  at: number;
  text: string;
  /** "text", or what the attachment was ("image", "voice note"); attachments are not downloaded. */
  kind: string;
}

/** A message that arrived since the last check and is not the person's own. */
export interface WaNewMessage {
  id: string;
  at: number;
  chat: string;
  chatName: string;
  isGroup: boolean;
  /** Who wrote it (a jid). */
  sender: string;
  /** The name the person saved for the sender; absent when they have none. A name the sender chose is `pushName`, and is not trusted. */
  savedName?: string;
  pushName?: string;
  text: string;
  kind: string;
}

/** What the person is told, once, about something that changed. */
export interface WaNotice {
  kind: "linked" | "logged_out" | "failing" | "recovered" | "refused";
  level: "info" | "warn";
  text: string;
}

export type PollResult = { ok: true; newMessages: number; at: number } | { ok: false; error: string; at: number };
export type SendResult = { ok: true; id: string; at: number; duplicate?: boolean } | { ok: false; error: string };

/** What the program answers: a refusal is data. */
export type WaReply<T> = { ok: true; value: T } | { ok: false; error: string; status: number };

/** Candidates when a name matches several chats; `none` when it matches nothing. */
export type WaResolved = { jid: string } | { candidates: Array<{ jid: string; name: string }> } | { none: true };

/** A place in the stored messages, ordered by `(at, chat, id)` (bytewise on the ids). */
export interface WaHistoryKey {
  at: number;
  chat: string;
  id: string;
}

/**
 * What `history` asks for: a read-only walk over the stored messages. Ascending by default: `after` is the key of the last message
 * the caller has, and the page starts strictly after it. `before` walks the other way (strictly before the key) and implies
 * `order: "desc"`; the first page of a newest-first walk is `order: "desc"` with no key. Give one of `after` and `before`, or neither.
 * `chat` and `id` narrow the walk to one chat or one message; `since` leaves out messages before that time (epoch ms).
 */
export interface WaHistoryQuery {
  after?: WaHistoryKey;
  before?: WaHistoryKey;
  order?: "asc" | "desc";
  limit?: number;
  chat?: string;
  id?: string;
  since?: number;
  /** Walk by the store sequence instead of the time key: the page holds the messages stored after this number, oldest stored first. Not with `after` or `before`. */
  afterSeq?: number;
}

/** One stored message with what a reader needs to name its chat and sender. `chat` is the one id kept for the person. */
export interface WaHistoryMessage {
  id: string;
  chat: string;
  /** The chat's name as the person would recognise it (a group's subject, a saved name, else the number). */
  chatName: string;
  isGroup: boolean;
  at: number;
  /** Who wrote it (a jid; the linked number's own for a message the person sent). */
  sender: string;
  savedName?: string;
  pushName?: string;
  fromMe: boolean;
  text: string;
  /** "text", or what the attachment was ("image", "voice note"), or "reaction"; attachments are not downloaded. */
  kind: string;
  /** The id of the message this one quotes (a reply), in the same chat. */
  quotedId?: string;
  /** The people the message tags, with the names the program has for them. Outside text. */
  mentions?: Array<{ jid: string; savedName?: string; pushName?: string }>;
  /** The store sequence: the order the program stored the message in, which a late delivery does not change. */
  seq?: number;
}

export interface WaHistoryPage {
  items: WaHistoryMessage[];
  /** More messages follow in the direction of the walk. */
  more: boolean;
  /** The first and last stored message times (all chats), null when nothing is stored. */
  oldestAt: number | null;
  newestAt: number | null;
  /** The highest store sequence handed out so far, 0 when nothing was ever stored. */
  newestSeq?: number;
  /** The linked state; a logged-out or unlinked program has nothing new to give. */
  state: WhatsAppState;
  /** What the program keeps: messages older than `days` and the oldest beyond `maxMessages` are dropped. */
  retain: { days: number; maxMessages: number };
}

/** What `fetchOlder` asks for: more messages of one chat from before the oldest one stored. */
export interface WaOlderQuery {
  /** The chat's id (a person's jid or a group's); either form of a person works. */
  chat: string;
  /** How many to ask the phone for (10 to 100; default 50). WhatsApp may send fewer. */
  count?: number;
}

/** How asking the phone for older messages of a chat went. A phone that is off or never answers is `no_answer`, which a later call may retry; `complete` is remembered for the chat. */
export interface WaOlderResult {
  status: "loaded" | "complete" | "no_answer" | "rate_limited" | "no_anchor" | "unavailable";
  chat: string;
  chatName: string;
  /** Messages newly stored by this call. */
  added: number;
  /** Messages now stored for the chat. */
  stored: number;
  /** The oldest stored message of the chat after the call (epoch ms), null when nothing is stored. */
  oldestAt: number | null;
  /** The oldest stored message before the call (`loaded` only). */
  anchor?: WaHistoryKey;
  /** `rate_limited`: how long until the chat may be asked again. */
  retryInMs?: number;
  /** In plain words. */
  message: string;
}

/** Transient audio only: never write this result to storage or logs. */
export type WaVoiceNote = { status: "ok"; audio: string; mime: string; seconds: number } | { status: "too long" | "failed" | "unavailable" };

export interface WaNameOf {
  name: string;
  number: string;
  /** The one chat id for this person. */
  jid?: string;
  /** Messages stored for it. */
  stored?: number;
  /** WhatsApp told the program of this chat. */
  known?: boolean;
  lastAt?: number;
  archived?: boolean;
  /** The phone said there is nothing older: `fetchOlder` answers `complete` without asking it. */
  olderComplete?: boolean;
}

/** `POST /rpc/<action>` on the program, body `{ "args": [...] }`, header `x-slimefolk-account`; the answer is a `WaReply` of the value below. */
export interface WhatsAppRpc {
  status(): WhatsAppStatus;
  startPairing(o: { method: "code" | "qr"; phone?: string }): WhatsAppStatus;
  cancelPairing(): WhatsAppStatus;
  unpair(): WhatsAppStatus;
  setFrequency(f: WhatsAppFrequency): WhatsAppStatus;
  refresh(): PollResult;
  chats(limit?: number, unreadOnly?: boolean): WhatsAppChatView[];
  chatPage(q: WhatsAppChatQuery): WhatsAppChatPage;
  resolve(ref: string): WaResolved;
  messages(chat: string, o: { since?: number; limit?: number }): WhatsAppMessageView[];
  search(query: string, o: { limit?: number; chat?: string }): WhatsAppMessageView[];
  history(q: WaHistoryQuery): WaHistoryPage;
  fetchVoiceNote(chat: string, id: string): WaVoiceNote;
  fetchOlder(q: WaOlderQuery): WaOlderResult;
  nameOf(jid: string): WaNameOf;
  send(jid: string, text: string, key: string): SendResult;
  /** Where to post webhooks and the secret that signs them. */
  configure(o: { hookUrl: string; secret: string }): { ok: true };
  /** Moves the sealed login to the current key-encryption key. */
  rewrapAll(): { ok: boolean; rewrapped: number; failed: number };
}
export type WhatsAppRpcMethod = keyof WhatsAppRpc;
export const WHATSAPP_RPC_METHODS: readonly WhatsAppRpcMethod[] = ["status", "startPairing", "cancelPairing", "unpair", "setFrequency", "refresh", "chats", "chatPage", "resolve", "messages", "search", "history", "fetchVoiceNote", "fetchOlder", "nameOf", "send", "configure", "rewrapAll"];

/** What the program posts to the caller's signed webhook. */
export type WhatsAppHook = { type: "messages"; items: WaNewMessage[] } | { type: "notice"; notice: WaNotice } | { type: "event"; name: string; data: Record<string, unknown> };

/** GET /health */
export interface WhatsAppHealth {
  ok: true;
  service: "slimefolk-whatsapp";
  contract: string;
  release: string;
  source: { label: string; url: string | null; identity: string; archive: { url: string; sha256: string } | null };
}
