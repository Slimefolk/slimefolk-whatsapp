# The JSON contract

This folder is the whole interface between this program and whatever calls it. **The calling app vendors a copy of `contract/` by version** (`CONTRACT_VERSION` in `version.ts`, also returned by `GET /health` as `contract`) and never imports anything else from this repository. This repository, in turn, never imports code from its callers. A public repository cannot depend on a private one, so the contract lives here.

To vendor: copy this folder as it is (it has no imports from outside itself and no runtime dependencies), and record the version you copied. Compare it with the running program's `/health` `contract` field: the major version must match.

## Transport

- A Cloudflare **service binding**. The Worker has no public address.
- `POST /rpc/<action>` with header `x-slimefolk-account: <account>` (1 to 64 characters of `A-Za-z0-9._-`; one Durable Object per account) and body `{"args": [ ... ]}`.
- The answer is JSON, always a **reply**: `{"ok": true, "value": ...}` or `{"ok": false, "error": "<words for a person>", "status": <number>}`. A refusal is data; the HTTP status repeats `status`.
- `GET /health` (no account). `GET /licences` returns the notice bundle.
- The Worker **validates `args` against the action's request schema** before the account's object sees them, and refuses with status 400 and a message naming the offending path. Optional arguments may be left off the end or sent as `null` (JSON has no `undefined`).
- A **webhook** goes the other way: the program POSTs `messages`, `notice` and `event` bodies to the `hookUrl` given to `configure`, signed with HMAC-SHA256 over `<timestamp>.<body>` (`signWhatsAppHook` / `verifyWhatsAppHook` in `hook.ts`; headers `x-slimefolk-account`, `x-slimefolk-timestamp`, `x-slimefolk-signature`). Receivers should reject timestamps more than five minutes off.

## Actions

| Group | Action | Arguments | Value |
| --- | --- | --- | --- |
| link | `status` | | `Status` |
| link | `startPairing` | `{method: "code" \| "qr", phone?}` | `Status` |
| link | `cancelPairing` | | `Status` |
| link | `unpair` | | `Status` |
| link | `setFrequency` | `5 \| 10 \| 15 \| 30 \| 60` (minutes) | `Status` |
| link | `refresh` | | `PollResult` |
| read | `chats` | `limit?`, `unreadOnly?` | `ChatView[]` |
| read | `chatPage` | `{limit?, unreadOnly?, since?, before?, includeArchived?, members?}` | `ChatPage` |
| read | `resolve` | `ref` (name, number or id) | `Resolved` |
| read | `messages` | `chat`, `{since?, limit?}` | `MessageView[]` |
| read | `search` | `query`, `{limit?, chat?}` | `MessageView[]` |
| read | `history` | `{after?, before?, order?, limit?, chat?, id?, since?, afterSeq?}` | `HistoryPage` |
| read | `nameOf` | `jid` | `NameOf` |
| read | `fetchVoiceNote` | `chat`, `id` | `VoiceNote` (audio is transient: never store or log it) |
| read | `fetchOlder` | `{chat, count?}` | `OlderResult` |
| write | `send` | `jid`, `text`, `key` | `SendResult` |
| admin | `configure` | `{hookUrl, secret}` | `{ok: true}` |
| admin | `rewrapAll` | | `{ok, rewrapped, failed}` |
| health | `GET /health` | | `Health` |

Not in the contract: a "stay connected" (real-time) frequency (future work, Slimefolk #746) and "message yourself" (sending a file to the linked account's own chat).

## Files

| Path | What |
| --- | --- |
| `schema/defs.json` | Shared definitions (`Status`, `ChatView`, `HistoryPage`, ...). |
| `schema/actions/<action>.request.json` | JSON Schema (2020-12) of the `args` array: positional `prefixItems`. |
| `schema/actions/<action>.response.json` | JSON Schema of the `value` of a successful reply. |
| `schema/reply.json`, `request.json`, `hook.json`, `health.json` | The reply envelope, the request body, the webhook bodies, the health answer. |
| `schema/manifest.json` | Maps each action to its two files; carries the contract version. |
| `types.ts` | The same shapes as TypeScript types (written by hand beside the schemas; the schemas are the authority). |
| `validate.ts`, `index.ts`, `schema/index.ts` | A dependency-free checker for the schema keywords used here, `requestProblem` / `replyProblem` / `hookProblem` / `healthProblem`, and the schema files as modules. |
| `hook.ts` | Webhook signing and verification (WebCrypto). |

`test/contract.test.ts` runs every action against the real Worker and checks each reply against these schemas, so the types, the schemas and the code cannot drift silently.

## Versioning

`CONTRACT_VERSION` is semver. Adding an optional field to a reply, or a new action, is a minor bump. Removing or renaming anything, or tightening a request, is a major bump. Request objects are strict (`additionalProperties: false`) so a typo is refused instead of ignored; replies are open, so a caller should ignore fields it does not know.
