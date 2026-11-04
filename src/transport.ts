// Workerd WebSocket transport for Baileys.
//
// Baileys' makeSocket hard-codes `new WebSocketClient(url, config)` (Socket/Client/websocket.js, built on the
// `ws` package, which cannot open sockets in workerd). Workers open an outbound WebSocket with
// `fetch(httpsUrl, { headers: { Upgrade: "websocket", Origin } })` and `resp.webSocket.accept()`.
//
// WorkerdSocketClient implements the same surface as WebSocketClient (isOpen/isClosed/isClosing/isConnecting,
// connect, close, send(data, cb), and re-emits open/message/close/error), extending Baileys' own
// AbstractSocketClient. installWorkerdTransport() copies its methods onto WebSocketClient.prototype so the
// unmodified makeSocket picks it up. (Production alternative: a 3-line pnpm patch to socket.js.)
import type { SocketConfig } from "baileys";
import { AbstractSocketClient, WebSocketClient } from "baileys/lib/Socket/Client/index.js";

export type WsFetch = (url: string, init: RequestInit) => Promise<Response>;

/** Extra config field read by the transport (makeWASocket passes unknown config keys through). */
export interface WorkerdTransportConfig {
  wsFetch?: WsFetch;
  connectTimeoutMs?: number;
  options?: { headers?: Record<string, string> };
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

export class WorkerdSocketClient extends AbstractSocketClient {
  declare url: URL;
  declare config: SocketConfig & WorkerdTransportConfig;
  socket: WebSocket | null = null;
  // readyState while the fetch-upgrade is in flight (no WebSocket object exists yet)
  pending = false;

  get isOpen() {
    return this.socket?.readyState === OPEN;
  }
  get isClosed() {
    return !this.pending && (this.socket === null || this.socket.readyState === CLOSED);
  }
  get isClosing() {
    return !this.pending && (this.socket === null || this.socket.readyState === CLOSING);
  }
  get isConnecting() {
    return this.pending || this.socket?.readyState === CONNECTING;
  }

  connect() {
    if (this.socket || this.pending) return;
    this.pending = true;
    void this.open().catch((err) => {
      this.pending = false;
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
      this.emit("close", 1006, "upgrade failed");
    });
  }

  private async open() {
    const doFetch: WsFetch = this.config.wsFetch ?? ((u, i) => fetch(u, i));
    const httpUrl = new URL(this.url.toString());
    if (httpUrl.protocol === "wss:") httpUrl.protocol = "https:";
    if (httpUrl.protocol === "ws:") httpUrl.protocol = "http:";
    const timeoutMs = this.config.connectTimeoutMs ?? 20_000;
    const resp = await doFetch(httpUrl.toString(), {
      headers: {
        Upgrade: "websocket",
        Origin: "https://web.whatsapp.com",
        ...(this.config.options?.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ws = resp.webSocket;
    if (!ws) {
      this.emit("unexpected-response", resp);
      throw new Error(`websocket upgrade refused: HTTP ${resp.status}`);
    }
    // With compat date 2026-08-01 workerd delivers binary frames as Blob by default (standard binaryType);
    // Baileys needs bytes synchronously, so ask for ArrayBuffer before accepting.
    ws.binaryType = "arraybuffer";
    ws.accept();
    this.socket = ws;
    this.pending = false;
    ws.addEventListener("message", (ev: MessageEvent) => {
      const d = ev.data;
      // Baileys' onMessageReceived expects a Buffer (it calls noise.decodeFrame(data)).
      const buf = typeof d === "string" ? Buffer.from(d) : Buffer.from(d as ArrayBuffer);
      this.emit("message", buf);
    });
    ws.addEventListener("close", (ev: CloseEvent) => {
      this.emit("close", ev.code, ev.reason);
    });
    ws.addEventListener("error", (ev: Event) => {
      const msg = (ev as ErrorEvent).message ?? "websocket error";
      this.emit("error", new Error(msg));
    });
    // accept() returns with readyState OPEN; Baileys starts the handshake on 'open'.
    this.emit("open");
  }

  async close() {
    const ws = this.socket;
    if (!ws) return;
    if (ws.readyState !== CLOSED) {
      const closed = new Promise<void>((resolve) => {
        ws.addEventListener("close", () => resolve(), { once: true });
        setTimeout(resolve, 2_000); // peer may never answer the close frame
      });
      try {
        ws.close(1000, "bye");
      } catch {
        // already closing
      }
      await closed;
    }
    this.socket = null;
  }

  send(data: Uint8Array | string, cb?: (err?: Error) => void) {
    const ws = this.socket;
    if (!ws) return false;
    try {
      ws.send(data);
      if (cb) queueMicrotask(() => cb());
    } catch (err) {
      if (cb) queueMicrotask(() => cb(err as Error));
    }
    return true;
  }
}

let installed = false;
/** Point Baileys' WebSocketClient at the workerd transport. Idempotent. */
export function installWorkerdTransport() {
  if (installed) return;
  installed = true;
  const target = (WebSocketClient as unknown as { prototype: object }).prototype;
  for (const key of Object.getOwnPropertyNames(WorkerdSocketClient.prototype)) {
    if (key === "constructor") continue;
    Object.defineProperty(target, key, Object.getOwnPropertyDescriptor(WorkerdSocketClient.prototype, key)!);
  }
}
