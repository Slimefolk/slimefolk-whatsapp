// Test seams. In production nothing sets these, so every call is a no-op.
import type { WaAdapter } from "./adapter.ts";
import type { WaTiming } from "./core.ts";

export interface WaTestHooks {
  /** A fake in place of the WhatsApp Web client. */
  adapter?: WaAdapter;
  now?(): number;
  /** Where the real client's WebSocket upgrade goes instead of WhatsApp (a fake server in the test worker). */
  wsFetch?(url: string, init: RequestInit): Promise<Response>;
  timing?: Partial<WaTiming>;
  /** Sees the calls the program makes to the caller's webhook (the real fetch is not made when this is set). */
  post?(url: string, init: { headers: Record<string, string>; body: string }): Promise<{ ok: boolean; status: number }>;
}

const KEY = "__slimefolkWaTestHooks";

export function waTestHooks(): WaTestHooks {
  const g = globalThis as unknown as Record<string, WaTestHooks | undefined>;
  return (g[KEY] ??= {});
}

export function resetWaTestHooks(): void {
  (globalThis as unknown as Record<string, WaTestHooks | undefined>)[KEY] = {};
}
