# slimefolk-whatsapp

A WhatsApp client that runs on Cloudflare: **one Worker plus one Durable Object per account**. It links to a personal WhatsApp account the way WhatsApp Web does (as a "linked device", through the unofficial multi-device protocol, using [Baileys](https://github.com/WhiskeySockets/Baileys)), keeps the chats and messages it pulled in the object's SQLite, and answers a small JSON interface over a Cloudflare **service binding**.

It is a separate, fully open-source program (AGPL-3.0). Whatever calls it talks to it only through the JSON contract in [`contract/`](contract/README.md); this code imports nothing from its callers, and callers must not import this code.

## Read this first: the ban risk

**This is unofficial.** WhatsApp does not offer this kind of access to apps. It may break WhatsApp's terms of service, and WhatsApp can restrict or ban the number that is linked. Use a secondary number if you can.

- Reading messages is low risk. Sending is riskier. The program limits itself to 20 sends an hour and asks the phone for older messages sparingly, because WhatsApp can flag accounts that act in bursts.
- Linked chats are read by whatever you connect to this program. Their text leaves WhatsApp.
- You can unlink at any time (the `unpair` action, or on the phone under WhatsApp, Linked devices).
- The authors accept no responsibility for a banned number. By deploying this you accept that risk.

**This is not legal advice; get a lawyer's check of the separation before any paid launch.** See [THIRD_PARTY.md](THIRD_PARTY.md) for what is shipped and under which licences (the bridge `whatsapp-rust-bridge` ships AGPL-3.0-only Signal files; `libsignal` is GPL-3.0).

## How it works

```
 phone ── WhatsApp servers ── (outbound WebSocket, opened only while polling)
                                   │
 slimefolk-whatsapp (this repo)    │  Durable Object `WhatsApp`, one per account
   src/worker.ts   ◄───────────────┘  core.ts (logic), baileys.ts (the only file that imports Baileys), SQLite store
        ▲   │
        │   └── signed webhook POST (new messages, notices) ──►  your app
        └────── service binding:  POST /rpc/<action>  (JSON, validated against contract/schema)
```

- **Polling is the default and the only mode.** An alarm wakes the object every 5, 10, 15 (default), 30 or 60 minutes; it connects, takes what WhatsApp queued while the device was away, waits until things go quiet, stores, reports new messages to the webhook and disconnects. A "stay connected" mode existed in the legacy code and is left out: it is future work (Slimefolk #746).
- **Pairing** is by an 8-character code typed on the phone (give the number) or by QR. Three minutes, then it cancels.
- **The login** (Baileys credentials and Signal keys) is sealed at rest with envelope encryption under a `KEY_ENCRYPTION_KEY` Worker secret. Messages are kept 90 days, at most 50,000, 8,000 characters each, with no encryption beyond Cloudflare's. `unpair` wipes the login and everything stored.
- **Sending** is text only, deduplicated by a caller-chosen key, at most 4,000 characters.
- "Message yourself" (sending a file to the linked account's own chat) is not included.

### Why it runs in workerd

Baileys runs in the Workers runtime with `nodejs_compat` and five small patches, none inside Baileys' own files:

1. **WASM bridge precompiled.** `whatsapp-rust-bridge` compiles its `.wasm` from bytes at import, which workerd forbids. `scripts/prepare-bridge.mjs` extracts it to `vendor/*.wasm` and writes a loader that imports the precompiled module; `wrangler.jsonc` aliases the package to it.
2. **WebSocket transport.** Baileys uses the `ws` package, which cannot open sockets in workerd. `src/transport.ts` gives it the same surface over `fetch` with `Upgrade: websocket`.
3. `binaryType = "arraybuffer"` on the socket.
4. **`Buffer#utf8Write` wrapper** (`src/buffer-fix.ts`): workerd treats a missing length differently from Node, which breaks protobufjs.
5. **PBKDF2 above 100,000 iterations** (`src/pbkdf2-fix.ts`): workerd refuses them, and Baileys derives the pairing-code key at 131,072. The patch computes that one derivation in plain JavaScript.

Memory (128 MB per object) is the constraint, not CPU. Full history sync is off and media is never downloaded (attachments are named, voice notes can be fetched into memory on request).

## Layout

| Path | What |
| --- | --- |
| `contract/` | The JSON contract: JSON Schema files, TypeScript types, a small validator, the webhook signature. Vendored by callers. |
| `src/worker.ts` | The Worker: `POST /rpc/<action>`, `GET /health`, `GET /licences`. Validates requests against `contract/`. |
| `src/do.ts` | The `WhatsApp` Durable Object: SQLite, sealed store, alarm, webhook. |
| `src/core.ts` | The logic (pairing, polling, storage, sends, older messages). Independent of Cloudflare and Baileys. |
| `src/baileys.ts`, `src/transport.ts`, `src/buffer-fix.ts`, `src/voice.ts` | The protocol library seam and its workerd patches. |
| `src/store.ts`, `src/schema.ts`, `src/sql.ts`, `src/seal.ts`, `src/timer.ts` | SQLite store and migrations, sealed login, the one timer. |
| `src/fake.ts`, `src/testing.ts` | A scripted fake WhatsApp and the test seams (never active in production). |
| `mcp/` | The optional MCP Worker for agents (see below). |
| `test/` | Tests; `test/support/` holds a fake WhatsApp server speaking the Noise handshake. |
| `vendor/`, `scripts/prepare-bridge.mjs` | The precompiled bridge (regenerated from `node_modules` by `pnpm prepare:bridge`). |
| `licences/` | Licence texts, the notice bundle served at `/licences`, and the pinned upstream sources. |

## Develop and test

Requires Node 22+ and pnpm 9.

```sh
pnpm install
pnpm typecheck      # regenerates the Worker types, then tsc
pnpm test           # vitest in a workerd pool; no network, no real WhatsApp
```

Tests run the real Worker and Durable Object against a scripted fake adapter (`src/fake.ts`) and, for the real Baileys client, against a fake WhatsApp server that speaks the Noise handshake in-process (`test/support/fake-wa-server.ts`). `test/contract.test.ts` calls every action over HTTP and checks each reply against its JSON Schema. A fixed test-only `KEY_ENCRYPTION_KEY` is set in `vitest.config.ts`; no deployed secret is ever read.

## Deploy

Nothing here deploys itself. When you decide to:

1. Create a Cloudflare account and log in: `pnpm exec wrangler login`.
2. Set your own values in `wrangler.jsonc` (it ships with none): `SOURCE_URL` (the public URL of the source you deploy, shown by `/health` and `/licences`; AGPL section 13 asks for it), optionally `RELEASE` and `BUILD_ID`.
3. Add the secret that seals the login. It must be 32 random bytes, base64url:
   ```sh
   openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n' | pnpm exec wrangler secret put KEY_ENCRYPTION_KEY
   ```
   (When rotating, put the old key in `KEY_ENCRYPTION_KEY_PREVIOUS`, deploy, call `rewrapAll`, then drop it.)
4. `pnpm run deploy` (prepares the bridge, then `wrangler deploy`). The Worker has no route and `workers_dev` is off: it is reachable only by a service binding.
5. In the calling Worker's config, bind it: `"services": [{ "binding": "WHATSAPP", "service": "slimefolk-whatsapp" }]`, call `POST https://whatsapp.internal/rpc/<action>` on the binding with the header `x-slimefolk-account: <account>`, and use `configure` to tell the program where to post its webhook.

Changes take effect only after a redeploy. The first deploy runs the `v1-whatsapp` migration (SQLite-backed `WhatsApp` class).

## MCP server for agents

`mcp/` is a second, optional Worker: a remote MCP server (Streamable HTTP, stateless) that lets AI agents read and send WhatsApp messages. It is the only public surface; it reaches the program above through a service binding, so the program itself keeps no address.

- **Auth, two ways.** *OAuth* for clients that sign in (claude.ai, Claude Desktop and mobile connectors): the Worker is its own authorization server (`@cloudflare/workers-oauth-provider`, dynamic registration and client metadata documents), and approving a client asks for the `OAUTH_PASSPHRASE` secret. OAuth always gets the `agent` scope. *Static bearer tokens* for clients that can send a header (Claude Code, Amp, Codex): one per agent, from the `MCP_TOKENS` secret: `{"<name>": {"token": "<32+ chars>", "scope": "agent" | "admin", "account": "<optional>"}}`. Tokens shorter than 32 characters are ignored.
- **Scopes:** `agent` gets `whatsapp_status`, `whatsapp_list_chats`, `whatsapp_find_chat`, `whatsapp_read_chat`, `whatsapp_search`, `whatsapp_history`, `whatsapp_contact`, `whatsapp_refresh`, `whatsapp_fetch_older` and `whatsapp_send`. `admin` adds `whatsapp_start_pairing`, `whatsapp_cancel_pairing`, `whatsapp_set_frequency` and `whatsapp_unpair`. `configure`, `rewrapAll` and voice notes are never exposed.
- **Account:** each token uses its own `account` or the `ACCOUNT` var (one Durable Object, one linked phone, per account).
- Tools accept a chat id or a name or number, which is resolved first; a name that matches several chats is refused with the candidates.

Deploy it after the program:

```sh
pnpm run deploy:mcp            # creates the OAUTH_KV namespace on the first deploy
pnpm exec wrangler secret put MCP_TOKENS --config mcp/wrangler.jsonc
pnpm exec wrangler secret put OAUTH_PASSPHRASE --config mcp/wrangler.jsonc   # 20+ characters; leave unset to turn OAuth off
```

Then point an MCP client at `https://slimefolk-whatsapp-mcp.<your-subdomain>.workers.dev/mcp`: as a custom connector in claude.ai (it signs in by OAuth), or with the header `Authorization: Bearer <token>`. To link a phone, call `whatsapp_start_pairing` with an admin token and type the code on the phone under WhatsApp, Linked devices, Link with phone number.

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE) and [THIRD_PARTY.md](THIRD_PARTY.md).
