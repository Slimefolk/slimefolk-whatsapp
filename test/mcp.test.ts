// The MCP Worker (mcp/src/worker.ts) in front of the real WhatsApp program: its WHATSAPP service binding is the program under test
// (SELF), which talks to the scripted fake WhatsApp. Checks the token gate, the scopes, and that tools reach the right actions.
import { SELF, env, runInDurableObject } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import mcp, { TOOLS, type McpEnv } from "../mcp/src/worker.ts";
import { FakeWhatsApp, waMsg } from "../src/fake.ts";
import { resetWaTestHooks, waTestHooks } from "../src/testing.ts";

const AGENT = "agent-token-0123456789abcdef0123456789";
const ADMIN = "admin-token-0123456789abcdef0123456789";
const CAROL = "15550101@s.whatsapp.net";
let n = 0;

let fake: FakeWhatsApp;
let account: string;
let mcpEnv: McpEnv;

beforeEach(() => {
  fake = new FakeWhatsApp();
  const hooks = waTestHooks();
  hooks.adapter = fake;
  hooks.timing = { connectMs: 1500, pollMaxMs: 1500, quietMs: 30, quietMaxMs: 150, firstSyncMs: 1500, firstQuietMs: 30, firstQuietMaxMs: 150, sendLingerMs: 30, pairMs: 60_000, olderWaitMs: 1500, olderQuietMs: 30, olderQuietMaxMs: 150, olderGapMs: 0, olderChatCooldownMs: 0 };
  hooks.post = async () => ({ ok: true, status: 200 });
  account = `mcp-${Date.now().toString(36)}-${++n}`;
  mcpEnv = {
    WHATSAPP: SELF as unknown as Fetcher,
    ACCOUNT: account,
    MCP_TOKENS: JSON.stringify({ claude: { token: AGENT, scope: "agent" }, me: { token: ADMIN, scope: "admin" }, weak: { token: "short", scope: "admin" } }),
  };
});
afterEach(() => resetWaTestHooks());

let rid = 0;
async function post(body: unknown, token?: string): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (token) headers.authorization = `Bearer ${token}`;
  return mcp.fetch(new Request("https://mcp.example.test/mcp", { method: "POST", headers, body: JSON.stringify(body) }), mcpEnv);
}
async function rpc(method: string, params: unknown, token = AGENT): Promise<any> {
  const r = await post({ jsonrpc: "2.0", id: ++rid, method, params }, token);
  expect(r.status).toBe(200);
  return r.json();
}
async function tool(name: string, args: Record<string, unknown> = {}, token = AGENT): Promise<{ isError?: boolean; value: any }> {
  const r = await rpc("tools/call", { name, arguments: args }, token);
  expect(r.error, JSON.stringify(r.error)).toBeUndefined();
  const text = r.result.content[0].text as string;
  return { isError: r.result.isError, value: r.result.isError ? text : JSON.parse(text) };
}
const until = async (cond: () => Promise<boolean>, what: string, ms = 3000): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timed out waiting for ${what}`);
};

describe("the MCP Worker", () => {
  it("refuses without a known token, and ignores tokens shorter than 32 characters", async () => {
    const init = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } };
    expect((await post(init)).status).toBe(401);
    expect((await post(init, "not-a-token-0123456789abcdef0123456789")).status).toBe(401);
    expect((await post(init, "short")).status).toBe(401);
    expect((await mcp.fetch(new Request("https://mcp.example.test/mcp", { method: "POST", headers: { authorization: `Bearer ${AGENT}` }, body: "{}" }), { ...mcpEnv, MCP_TOKENS: undefined })).status).toBe(401);
    expect((await post(init, AGENT)).status).toBe(200);
  });

  it("answers initialize, ping and notifications; GET has no stream", async () => {
    const r = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } });
    expect(r.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "slimefolk-whatsapp-mcp" } });
    expect((await rpc("initialize", { protocolVersion: "1999-01-01" })).result.protocolVersion).toBe("2025-11-25");
    expect((await rpc("ping", {})).result).toEqual({});
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" }, AGENT)).status).toBe(202);
    expect((await rpc("nope", {})).error.code).toBe(-32601);
    expect((await mcp.fetch(new Request("https://mcp.example.test/mcp", { headers: { authorization: `Bearer ${AGENT}` } }), mcpEnv)).status).toBe(405);
    expect((await mcp.fetch(new Request("https://mcp.example.test/health"), mcpEnv)).status).toBe(200);
  });

  it("gives an agent token the read and send tools only; admin adds the rest", async () => {
    const agent = (await rpc("tools/list", {})).result.tools.map((t: { name: string }) => t.name);
    const admin = (await rpc("tools/list", {}, ADMIN)).result.tools.map((t: { name: string }) => t.name);
    expect(agent).toContain("whatsapp_send");
    expect(agent).not.toContain("whatsapp_unpair");
    expect(agent).not.toContain("whatsapp_start_pairing");
    expect(admin.sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect((await rpc("tools/call", { name: "whatsapp_unpair", arguments: { confirm: "unlink" } })).error.code).toBe(-32602);
  });

  it("pairs with an admin token, then reads and sends with an agent token", async () => {
    expect((await tool("whatsapp_status")).value).toMatchObject({ state: "unlinked" });
    expect((await tool("whatsapp_start_pairing", { method: "code", phone: "15550100" }, ADMIN)).value).toMatchObject({ state: "pairing", pairing: { code: "ABCD1234" } });
    await runInDurableObject(env.WHATSAPP.get(env.WHATSAPP.idFromName(account)), async () => fake.enterCode("Alice"));
    await until(async () => (await tool("whatsapp_status")).value.state === "linked", "the link");
    await until(async () => fake.openConnections === 0, "the first sync");

    const t = Date.now() - 60_000;
    fake.history = { chats: [{ jid: CAROL, name: "Carol", unread: 1, lastAt: t }], contacts: [{ jid: CAROL, name: "Carol" }], messages: [waMsg({ id: "H1", chat: CAROL, sender: CAROL, at: t, text: "lunch at one?" })], lidMappings: [] };
    expect((await tool("whatsapp_refresh")).value).toMatchObject({ ok: true });

    expect((await tool("whatsapp_list_chats")).value.chats[0]).toMatchObject({ jid: CAROL, name: "Carol" });
    expect((await tool("whatsapp_find_chat", { query: "Carol" })).value).toEqual({ jid: CAROL });
    expect((await tool("whatsapp_read_chat", { chat: "Carol" })).value.map((m: { id: string }) => m.id)).toContain("H1");
    expect((await tool("whatsapp_search", { query: "lunch" })).value).toHaveLength(1);
    expect((await tool("whatsapp_history", { order: "desc", limit: 5 })).value.items.length).toBeGreaterThan(0);
    expect((await tool("whatsapp_contact", { chat: CAROL })).value).toMatchObject({ name: "Carol" });
    expect(await tool("whatsapp_read_chat", { chat: "Nobody Here" })).toMatchObject({ isError: true });

    expect((await tool("whatsapp_send", { chat: "Carol", text: "on my way", key: "k1" })).value).toMatchObject({ ok: true });
    expect((await tool("whatsapp_send", { chat: "Carol", text: "on my way", key: "k1" })).value).toMatchObject({ duplicate: true });
    expect(fake.sent).toEqual([{ jid: CAROL, text: "on my way" }]);

    expect(await tool("whatsapp_unpair", { confirm: "yes" }, ADMIN)).toMatchObject({ isError: true });
    expect((await tool("whatsapp_unpair", { confirm: "unlink" }, ADMIN)).value).toMatchObject({ state: "unlinked" });
  });
});
