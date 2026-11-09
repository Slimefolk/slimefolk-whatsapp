// The PBKDF2 patch for pairing by code: workerd refuses PBKDF2 above 100,000 iterations and Baileys asks for 131,072.
import { describe, expect, it } from "vitest";
import { installWorkerdPbkdf2Fix, pbkdf2Sha256 } from "../src/pbkdf2-fix.ts";

const hex = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString("hex");
const enc = (s: string) => new TextEncoder().encode(s);

async function native(password: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>, iterations: number, bytes: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", password, { name: "PBKDF2" }, false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, key, bytes * 8));
}

describe("PBKDF2-HMAC-SHA-256 in JavaScript", () => {
  it("matches the published test vectors", () => {
    expect(hex(pbkdf2Sha256(enc("password"), enc("salt"), 1, 32))).toBe("120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b");
    expect(hex(pbkdf2Sha256(enc("password"), enc("salt"), 2, 32))).toBe("ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43");
    expect(hex(pbkdf2Sha256(enc("password"), enc("salt"), 4096, 32))).toBe("c5e478d59288c841aa530db6845c4c8d962893a001ce4e11a4963873aa98134a");
  });

  it("matches workerd at its limit, for short and long passwords, salts and outputs", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const code = enc("ABCD1234");
    expect(hex(pbkdf2Sha256(code, salt, 100_000, 32))).toBe(await native(code, salt, 100_000, 32));
    const long = crypto.getRandomValues(new Uint8Array(100));
    const odd = crypto.getRandomValues(new Uint8Array(77));
    expect(hex(pbkdf2Sha256(long, odd, 1000, 48))).toBe(await native(long, odd, 1000, 48));
  });

  it("lets Baileys' derivation through once installed, and leaves everything else to workerd", async () => {
    installWorkerdPbkdf2Fix();
    const salt = crypto.getRandomValues(new Uint8Array(32));
    const code = enc("ABCD1234");
    const key = await crypto.subtle.importKey("raw", code, { name: "PBKDF2" }, false, ["deriveBits"]);
    const started = Date.now();
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 2 << 16, hash: "SHA-256" }, key, 256);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(hex(bits)).toBe(hex(pbkdf2Sha256(code, salt, 2 << 16, 32)));
    expect(await native(code, salt, 1000, 32)).toBe(hex(pbkdf2Sha256(code, salt, 1000, 32)));
  });
});
