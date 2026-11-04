// The seam between the WhatsApp logic and the WhatsApp Web protocol library. Everything the object does (pairing
// state, polling, storage, logout handling, the alarm, sends) is written against these types, so it is tested with a fake
// adapter (fake.ts) and the real one (baileys.ts) is only the translation to and from Baileys.

/** The key the login's credentials are kept under in the `AuthKv`; the Signal keys sit under other keys. */
export const AUTH_CREDS_KEY = "creds";

/** The login (credentials and Signal keys) as opaque strings, sealed under the deployment's key-encryption key by the owner. */
export interface AuthKv {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

/** Why a connection ended. */
export type WaCloseReason =
  /** The phone (or WhatsApp) unlinked this device: the login is dead and must be paired again. */
  | "logged_out"
  /** Normal after pairing succeeds: WhatsApp asks for a fresh connection with the new login. */
  | "restart_required"
  /** Another session took over this linked device. */
  | "replaced"
  /** WhatsApp refused the connection (HTTP 403 / "forbidden"): possibly the number is restricted. */
  | "forbidden"
  /** The link dropped or timed out. */
  | "connection_lost"
  | "other";

export interface WaMe {
  /** The linked account's id, `15550100:12@s.whatsapp.net`: the number is the digits before ":" or "@". */
  id: string;
  name?: string;
  /** The account's own hidden-number id, when WhatsApp has given it. */
  lid?: string;
}

export interface WaMessage {
  id: string;
  /** The chat: a person's jid or a group's. May be the phone form or the hidden-number (@lid) form; the store makes it one. */
  chat: string;
  /** The other form of `chat` when WhatsApp sent both (`remoteJidAlt`): lets the store learn that the two are one person. */
  chatAlt?: string;
  /** Who wrote it (a jid; the person's own for a message they sent). */
  sender: string;
  /** The other form of `sender` when WhatsApp sent both (`participantAlt`). */
  senderAlt?: string;
  /** The name the sender gave themselves (WhatsApp's "push name"). Not trustworthy. */
  pushName?: string;
  fromMe: boolean;
  /** Epoch ms. */
  at: number;
  text: string;
  /** "text", or "image", "voice note", "video", "document", "sticker", "location", "contact", "poll", "reaction", "other". */
  kind: string;
  /** The id of the message this one quotes (WhatsApp's `contextInfo.stanzaId`), when it is a reply. */
  quotedId?: string;
  /** The people the message tags (`contextInfo.mentionedJid`): jids, either form. */
  mentions?: string[];
  /** Download/decryption metadata only. Kept with the message, never exported in history. */
  voice?: VoiceMedia;
}

export interface VoiceMedia {
  key: string;
  directPath?: string;
  url?: string;
  seconds: number;
  bytes: number;
  mime: string;
}

export interface WaChat {
  jid: string;
  /** A group's subject, or the name WhatsApp has for the chat. */
  name?: string;
  unread?: number;
  /** Epoch ms of the chat's newest activity. */
  lastAt?: number;
  /** WhatsApp's archived flag, when it said. */
  archived?: boolean;
  /** The chat's other id (phone form for an @lid chat, @lid for a phone chat), when WhatsApp gave both. */
  altJid?: string;
}

export interface WaContact {
  jid: string;
  /** The name in the person's own address book. */
  name?: string;
  /** The name the contact gave themselves. */
  notify?: string;
  /** The contact's other id (`lid` / `phoneNumber`), when WhatsApp gave both. */
  altJid?: string;
}

/** One member of a group: the id WhatsApp lists, its other form when both were given, and the admin flag. */
export interface WaGroupMember {
  jid: string;
  altJid?: string;
  admin?: boolean;
}

/** A group's metadata: its subject and, when WhatsApp sent them, all its members. */
export interface WaGroup {
  jid: string;
  subject?: string;
  members?: WaGroupMember[];
}

/** Members joined, left or changed rank (`group-participants.update`). */
export interface WaGroupChange {
  jid: string;
  action: "add" | "remove" | "promote" | "demote";
  members: WaGroupMember[];
}

/** A hidden-number id and the phone-number id it belongs to. */
export interface WaLidPair {
  lid: string;
  pn: string;
}

export interface WaHistoryBatch {
  chats: WaChat[];
  contacts: WaContact[];
  messages: WaMessage[];
  /** The mappings the history sync carried. */
  lidMappings?: WaLidPair[];
  /** The answer to `fetchHistory` (WhatsApp's ON_DEMAND sync type), not the sync at link time: its chats say nothing about unread. */
  onDemand?: boolean;
}

/** What a connection reports. The owner stores it; the adapter keeps no state of its own. */
export interface WaEvents {
  open(me: WaMe): void;
  close(reason: WaCloseReason, detail?: string): void;
  /** Pairing by QR: the text to draw. Changes every ~20 seconds. */
  qr(qr: string): void;
  /** WhatsApp has sent everything that was queued for this device while it was away. */
  drained(): void;
  /** A batch of the initial history sync: chats, contacts and old messages. */
  history(batch: WaHistoryBatch): void;
  /** WhatsApp told us which phone number a hidden-number id belongs to (`lid-mapping.update`). */
  lidMappings(pairs: WaLidPair[]): void;
  /** New messages: queued while away ("offline") or arriving now ("live"). */
  messages(messages: WaMessage[], how: "offline" | "live"): void;
  chats(chats: WaChat[]): void;
  contacts(contacts: WaContact[]): void;
  /** Groups WhatsApp described (joined, or `groups.upsert`/`groups.update`), with members when it listed them. */
  groups(groups: WaGroup[]): void;
  /** A group's member list changed. */
  groupChange(change: WaGroupChange): void;
}

export interface WaConnection {
  /** The 8-character code to type on the phone (pairing by phone number), once WhatsApp gave it. */
  readonly pairingCode?: string;
  sendText(jid: string, text: string): Promise<{ id: string }>;
  /** The phone number's WhatsApp jid, or null when the number is not on WhatsApp. */
  lookup(phone: string): Promise<string | null>;
  /** The phone-number id WhatsApp's own mapping knows for a hidden-number id, or null. A local lookup; optional. */
  pnForLid?(lid: string): Promise<string | null>;
  /**
   * Asks the phone for `count` messages of a chat from before `anchor` (its oldest stored message). Resolves once the request is
   * sent; the answer arrives later as a `history` event with `onDemand` set, and only when the phone is online.
   */
  fetchHistory?(count: number, anchor: { chat: string; id: string; fromMe: boolean; at: number }): Promise<void>;
  /** A group's subject and member list, fetched once when the group is first seen. Optional; null when WhatsApp has no such group. */
  groupMetadata?(jid: string): Promise<WaGroup | null>;
  /** Unlinks this device on WhatsApp's side (it disappears from the phone's Linked devices). */
  logout(): Promise<void>;
  close(): void;
}

export interface WaConnectOptions {
  auth: AuthKv;
  events: WaEvents;
  /** Pair by phone number: digits with the country code. The connection comes back with `pairingCode` set. */
  pairPhone?: string;
  /** Pair by QR: `events.qr` fires. */
  pairQr?: boolean;
}

export interface WaAdapter {
  fetchVoiceNote?(media: VoiceMedia): Promise<import("../contract/index.ts").WaVoiceNote>;
  /**
   * Opens a connection and returns once the transport is up (and, for `pairPhone`, once WhatsApp gave the code). `events.open`
   * fires later, when the login is accepted. Throws when the transport cannot be opened.
   */
  connect(o: WaConnectOptions): Promise<WaConnection>;
}
