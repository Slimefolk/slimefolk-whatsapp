// Rewrites whatsapp-rust-bridge (Baileys v7's WASM helper) so it runs in workerd.
// Upstream inlines the .wasm as base64 and calls `new WebAssembly.Module(bytes)` at import time.
// Workers forbid compiling WASM from bytes at runtime, so we extract the bytes into a .wasm file
// (which wrangler / the vitest pool upload as a precompiled WebAssembly.Module) and init from that.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "..", "node_modules/whatsapp-rust-bridge/dist/index.js"), "utf8");

const cut = src.indexOf("// ts/index.ts");
if (cut < 0) throw new Error("bridge layout changed: no '// ts/index.ts' marker");
const head = src.slice(0, cut);
const tail = src.slice(cut);

const b64s = [...tail.matchAll(/base64ToUint8Array\("([A-Za-z0-9+/=]+)"\)|tryInit\("([A-Za-z0-9+/=]+)"\)/g)].map((m) => m[1] ?? m[2]);
if (b64s.length !== 2) throw new Error(`expected 2 inlined wasm blobs, found ${b64s.length}`);
const [simd, noSimd] = b64s;
const exportBlock = tail.slice(tail.lastIndexOf("export {"));

const out = join(here, "..", "vendor");
mkdirSync(out, { recursive: true });
writeFileSync(join(out, "bridge-simd.wasm"), Buffer.from(simd, "base64"));
writeFileSync(join(out, "bridge-nosimd.wasm"), Buffer.from(noSimd, "base64"));
writeFileSync(
  join(out, "whatsapp-rust-bridge.js"),
  `${head}
// --- workerd patch: precompiled module instead of runtime compile ---
import __bridgeWasm from "./bridge-simd.wasm";
initSync({ module: __bridgeWasm });
var __wasmSimdActive = true;
${exportBlock}`,
);
console.log(
  "bridge: simd wasm",
  Buffer.from(simd, "base64").length,
  "bytes, nosimd",
  Buffer.from(noSimd, "base64").length,
  "bytes, version",
  JSON.parse(readFileSync(join(here, "..", "node_modules/whatsapp-rust-bridge/package.json"), "utf8")).version,
);
