# Third-party software and licences

Carried over from the legacy licence audit of this program (20 Oct 2026, research, **not legal advice or release clearance**). This is not legal advice; get a lawyer's check of the separation before any paid launch.

This program is licensed **AGPL-3.0-only** ([LICENSE](LICENSE)). It depends on, and ships, the components below. Full licence texts and the per-file notices are in [licences/](licences/): `AGPL-3.0.txt`, `GPL-3.0.txt`, and `notices.json` (the notice bundle, also served by the Worker at `GET /licences`). `licences/source-inputs.json` pins the exact upstream sources and checksums the audit used. Individual files keep the licences they carry; no blanket relicensing is asserted.

## The two dependencies chosen by the maintainer

### baileys 7.0.0-rc14 (MIT)

The WhatsApp Web protocol library, <https://github.com/WhiskeySockets/Baileys> (audited at commit `7e7b0757e3f9f3c7789fb1cfd2f241d5002a199a`). Its MIT licence does not relicense its dependencies. It imports `libsignal` (below) and `whatsapp-rust-bridge`. Only `src/baileys.ts` imports it.

### whatsapp-rust-bridge 0.5.4 (declared MIT; ships AGPL-3.0-only Signal files)

A Rust/WASM helper for Baileys, <https://github.com/jlucaso1/whatsapp-rust-bridge> (commit `a0b265b852a916c35569da1b2046493c3c06c0db`), built from `oxidezap/whatsapp-rust` (commit `95397408f84fda502c3bb2c755fda82a07cab055`, MIT, copyright 2025 João Lucas de Oliveira Lopes).

- **The shipped bridge contains AGPL-3.0-only Signal code.** At that Rust revision, **31 source files carry `SPDX-License-Identifier: AGPL-3.0-only`** (Signal Messenger copyright headers; `session.rs`, `session_cipher.rs`, `group_cipher.rs`, `curve.rs`, `aes_cbc.rs` and others under `wacore/libsignal`), including files identifiable inside both published WASM variants. The root MIT licence and the Cargo `license = "MIT"` declarations conflict with those retained headers; neither grants permission to redistribute Signal's code under MIT. No alternative grant was found.
- This program ships the SIMD WASM module wholesale (`vendor/bridge-simd.wasm`, 721354 bytes, SHA-256 `5cb7b88a01e6e71e8646af35cc301c5be7d07110686b3d90ffc8301daed78ecb`; the non-SIMD module `vendor/bridge-nosimd.wasm`, 738926 bytes, `fff589536bfa14fe1e3c3d18ce4b6d7711d773c0eadb3af49b64f60364c814b2`, is extracted but not imported). Tree-shaking does not remove unused functions inside a WASM module.
- `scripts/prepare-bridge.mjs` modifies the upstream loader so workerd can run it (see the README); the modification is covered by this repository's AGPL-3.0 licence.
- **AGPL-3.0 section 13** adds an offer of corresponding source to remote users of a modified network-interactive version. Set `SOURCE_URL` in `wrangler.jsonc` to the public URL of the source you deploy; the Worker reports it at `/health` and `/licences`.
- Other Rust crates in the bridge's `Cargo.lock` (186 packages; 180 registry crates) are overwhelmingly `MIT OR Apache-2.0`, with BSD, Zlib, Unlicense, 0BSD and similar permissive terms; the audit table is a conservative lockfile superset, not a claim that all are linked into the WASM. The optional audio feature (Symphonia, MPL-2.0) is **not** enabled in the shipped build (`getEnabledFeatures()` returned audio/image/sticker all false); enabling it later would add MPL-2.0 obligations. Rust `std`/`compiler_builtins`/`dlmalloc` terms are in `licences/notices.json`.
- Not verified: a reproducible Rust rebuild, a linker map, or byte-level provenance of every standard-library subcomponent.

### libsignal 6.0.0 (GPL-3.0)

The JavaScript Signal implementation Baileys uses for sessions, <https://github.com/WhiskeySockets/libsignal-node> (commit `bcea72df9ec34d9d9140ab30619cf479c7c144c7`). Declared `GPL-3.0` with the GPL version 3 text; the declaration does not clearly distinguish "only" from "or later", and no upgrade grant is assumed. Its dependencies `curve25519-js` 0.0.4 (MIT) and `protobufjs` 7.6.6 (BSD-3-Clause) are permissive.

## Other JavaScript contributing to the bundle

From the audit's bundle metafile (52 external npm packages contributed emitted JavaScript); versions resolve through `pnpm-lock.yaml`.

| Licence | Packages |
| --- | --- |
| GPL-3.0 | libsignal 6.0.0 |
| Apache-2.0 | detect-libc 2.1.2; long 5.3.2; sharp 0.35.5 (JavaScript wrapper only) |
| BSD-3-Clause | @hapi/boom 9.1.4; @hapi/hoek 9.3.0; @protobufjs/* (aspromise, base64, eventemitter, float, pool, utf8); ieee754 1.2.1; protobufjs 7.6.6 |
| BlueOak-1.0.0 | lru-cache 11.5.3 (licence text or link must reach recipients) |
| ISC | semver 7.8.5 |
| MIT | baileys 7.0.0-rc14; ws 8.22.0; pino 9.14.0; zod 4.6.5; file-type; music-metadata; keyv and @cacheable/*; async-mutex; p-queue; nanoid; eventemitter3; and the other small helpers listed in the audit |

Notes carried from the audit:

- The audit found `agents` 0.27.0 (MIT) in the legacy bundle; this repository does not depend on it.
- Nested notices matter: for example `@img/colour/LICENSE.md` contains four upstream colour-library MIT attributions that must be preserved in full.
- **Native Sharp/libvips is a separate caveat.** `@img/sharp-libvips-*` declare LGPL-3.0-or-later (with other bundled native libraries). No `.node` or libvips library is emitted by the Worker bundle. Shipping an install tree or a native build would need a separate native-library source and notice inventory.
- Optional peers of Baileys (`audio-decode`, `jimp`, `link-preview-js`) are not installed or bundled; no clearance for a build that adds them is implied.

## Notes for anyone distributing or hosting this

- Preserve all copyright and licence notices; include the GPLv3 and AGPLv3 texts; do not relabel all files AGPL or all MIT.
- Distributing object code needs the corresponding source from the same place at no charge (GPLv3 / AGPLv3 sections 4 to 6). A link to an upstream branch, a WASM file or a lockfile alone is not corresponding source.
- Whether a caller and this program are independent works, and which indirect network users must receive the section 13 offer, needs legal review. A process boundary and a JSON interface are evidence of separation, not a legal guarantee.
- Never publish secrets, credentials, account state or user data as part of source delivery.
