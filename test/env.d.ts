// Test-only bindings (the fake WhatsApp server in test/support/worker.ts).
declare namespace Cloudflare {
  interface Env {
    FAKE_WA: DurableObjectNamespace;
  }
}
