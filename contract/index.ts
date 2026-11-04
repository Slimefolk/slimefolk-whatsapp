// The JSON contract between this program and its caller. The caller vendors a copy of this folder by CONTRACT_VERSION and never
// imports anything else from this repository.
import { SCHEMAS, manifest } from "./schema/index.ts";
import { check, type Schema } from "./validate.ts";
import { WHATSAPP_RPC_METHODS, type WhatsAppRpcMethod } from "./types.ts";

export * from "./types.ts";
export * from "./hook.ts";
export { CONTRACT_VERSION } from "./version.ts";
export { SCHEMAS, manifest } from "./schema/index.ts";
export type { Registry, Schema } from "./validate.ts";

export const isRpcMethod = (name: string): name is WhatsAppRpcMethod => (WHATSAPP_RPC_METHODS as readonly string[]).includes(name);

const entry = (method: WhatsAppRpcMethod) => manifest.actions[method];

/** Why the `args` of a call to `method` are not what the contract allows, or null when they are. Optional arguments may be null or left off. */
export function requestProblem(method: WhatsAppRpcMethod, args: unknown): string | null {
  const file = entry(method).request;
  return check(SCHEMAS, file, SCHEMAS[file] as Schema, args, "args");
}

/** Why `body` is not a valid reply to `method` (a success whose value fits the action's schema, or a refusal), or null. */
export function replyProblem(method: WhatsAppRpcMethod, body: unknown): string | null {
  const envelope = check(SCHEMAS, "reply.json", SCHEMAS["reply.json"] as Schema, body, "reply");
  if (envelope) return envelope;
  const b = body as { ok: boolean; value?: unknown };
  if (!b.ok) return null;
  const file = entry(method).response;
  return check(SCHEMAS, file, SCHEMAS[file] as Schema, b.value, "value");
}

/** Why `body` is not a webhook body, or null. */
export function hookProblem(body: unknown): string | null {
  return check(SCHEMAS, "hook.json", SCHEMAS["hook.json"] as Schema, body, "hook");
}

/** Why `body` is not a health answer, or null. */
export function healthProblem(body: unknown): string | null {
  return check(SCHEMAS, "health.json", SCHEMAS["health.json"] as Schema, body, "health");
}
