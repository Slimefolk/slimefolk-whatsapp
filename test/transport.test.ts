// The workerd WebSocket transport: the connect timeout must cover only the upgrade. In workerd the fetch's signal stays tied to
// the socket it returned, so a signal that fires later cuts a live connection (seen in production: 1006 at exactly 20 s).
import { describe, expect, it } from "vitest";
import { WorkerdSocketClient } from "../src/transport.ts";

describe("the workerd transport", () => {
  it("leaves the upgrade's abort signal alone once the socket is open", async () => {
    let signal: AbortSignal | undefined;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server!.accept();
    const wsFetch = async (_url: string, init: RequestInit) => {
      signal = init.signal ?? undefined;
      return new Response(null, { status: 101, webSocket: client });
    };
    const sock = new WorkerdSocketClient(new URL("wss://web.whatsapp.test/ws/chat"), { wsFetch, connectTimeoutMs: 30 } as never);
    const opened = new Promise<void>((r) => sock.on("open", () => r()));
    sock.connect();
    await opened;
    await new Promise((r) => setTimeout(r, 120));
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);
    expect(sock.isOpen).toBe(true);
    await sock.close();
  });
});
