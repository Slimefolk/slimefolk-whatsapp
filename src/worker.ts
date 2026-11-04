// The Worker. It has no public address: `workers_dev` and preview URLs are off and it has no route, so the only caller is another
// Worker, through a service binding. The interface is the JSON contract in ../contract:
//   POST /rpc/<action>   header x-slimefolk-account: <account>   body {"args": [...]}   ->   a WaReply as JSON.
//   GET  /health         no account; says nothing about any account.
//   GET  /licences       the licence and notice bundle (AGPL-3.0 section 13: remote users are told where the source is).
// The request is checked against contract/schema before it reaches the account's Durable Object.
import { CONTRACT_VERSION, isRpcMethod, requestProblem, type WaReply, type WhatsAppHealth } from "../contract/index.ts";
import type { WhatsApp, WaEnv } from "./do.ts";
import { sourceInfo, type SourceEnv } from "./source.ts";
import licences from "../licences/notices.json" with { type: "json" };

export { WhatsApp } from "./do.ts";

export interface Env extends WaEnv, SourceEnv {
  WHATSAPP: DurableObjectNamespace<WhatsApp>;
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refuse = (error: string, status: number): Response => json({ ok: false, error, status } satisfies WaReply<never>, status);

const ACCOUNT = /^[A-Za-z0-9._-]{1,64}$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && (request.method === "GET" || request.method === "HEAD")) {
      const s = sourceInfo(env);
      return json({ ok: true, service: "slimefolk-whatsapp", contract: CONTRACT_VERSION, release: s.release, source: { label: "Source for the WhatsApp program", url: s.url, identity: s.identity, archive: s.archive } } satisfies WhatsAppHealth);
    }
    if (url.pathname === "/licences" && request.method === "GET") return json(licences);
    const m = /^\/rpc\/([A-Za-z]+)$/.exec(url.pathname);
    if (!m || request.method !== "POST") return refuse("Not found", 404);
    const method = m[1]!;
    if (!isRpcMethod(method)) return refuse("Unknown method", 404);
    const account = request.headers.get("x-slimefolk-account") ?? "";
    if (!ACCOUNT.test(account)) return refuse("Missing account", 400);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return refuse('Body must be JSON: {"args": [...]}', 400);
    }
    const sent = (body as { args?: unknown } | null)?.args;
    if (!body || typeof body !== "object" || Array.isArray(body) || (sent !== undefined && !Array.isArray(sent))) return refuse('Body must be JSON: {"args": [...]}', 400);
    const args: unknown[] = sent ?? [];
    const problem = requestProblem(method, args);
    if (problem) return refuse(`Not a valid ${method} request: ${problem}`, 400);
    // JSON has no `undefined`: an optional argument that was left out in the middle arrives as null.
    const call = args.map((a) => (a === null ? undefined : a));
    const stub = env.WHATSAPP.get(env.WHATSAPP.idFromName(account)) as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>;
    try {
      return json(await stub[method]!(...call));
    } catch (e) {
      console.warn("whatsapp: rpc", method, e instanceof Error ? e.message : e);
      return refuse("The WhatsApp program failed on that call.", 500);
    }
  },
} satisfies ExportedHandler<Env>;
