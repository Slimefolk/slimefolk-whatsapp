// The Worker the tests run: the real one, plus a fake WhatsApp server (a Durable Object that accepts the same WebSocket upgrade a
// real outbound connection makes and speaks WhatsApp's Noise handshake with Baileys' own primitives). Never deployed.
import { DurableObject } from "cloudflare:workers";
import { makeFakeWaServer, type Scenario, type ServerLog } from "./fake-wa-server.ts";

export { default, WhatsApp } from "../../src/worker.ts";

export class FakeWA extends DurableObject {
  server?: ServerLog;
  headers: Record<string, string> = {};

  override async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/log") return Response.json({ server: this.server, headers: this.headers });
    if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    this.headers = { origin: req.headers.get("Origin") ?? "", path: url.pathname };
    const mode = (url.searchParams.get("mode") ?? "login-offline-drained") as Scenario;
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server!.binaryType = "arraybuffer";
    server!.accept();
    const fake = makeFakeWaServer(
      (b) => server!.send(b),
      () => server!.close(1000, "fake done"),
      mode,
    );
    this.server = fake.log;
    server!.addEventListener("message", (ev) => {
      fake.onMessage(new Uint8Array(ev.data as ArrayBuffer)).catch((e) => {
        fake.log.received.push(`server error: ${(e as Error).message}`);
        server!.close(1011, "fake server error");
      });
    });
    server!.addEventListener("close", () => {
      try {
        server!.close(1000, "bye");
      } catch {
        /* already closed */
      }
    });
    return new Response(null, { status: 101, webSocket: client! });
  }
}
