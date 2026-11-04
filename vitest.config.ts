import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const bridge = fileURLToPath(new URL("./vendor/whatsapp-rust-bridge.js", import.meta.url));

// KEY_ENCRYPTION_KEY is a fixed TEST value (32 bytes of 0x42); no deployed secret is ever read here.
export default defineConfig({
  plugins: [
    cloudflareTest({
      // The tests run the real Worker plus a fake WhatsApp server (test/support/worker.ts).
      main: "./test/support/worker.ts",
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { KEY_ENCRYPTION_KEY: "QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI" },
        durableObjects: { FAKE_WA: { className: "FakeWA", useSQLite: true } },
      },
    }),
  ],
  resolve: { alias: { "whatsapp-rust-bridge": bridge } },
  test: { testTimeout: 30_000 },
});
