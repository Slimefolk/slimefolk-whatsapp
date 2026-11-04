// The webhook signature. Both sides use it: the program signs, the receiver checks. WebCrypto only.

const hex = (b: ArrayBuffer): string => Array.from(new Uint8Array(b), (x) => x.toString(16).padStart(2, "0")).join("");

/** HMAC-SHA256 over `<timestamp>.<body>`, hex. */
export async function signWhatsAppHook(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
}

/** A signature that matches, from a timestamp within five minutes. Compared without an early exit. */
export async function verifyWhatsAppHook(secret: string, timestamp: number, body: string, signature: string, now: number): Promise<boolean> {
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 5 * 60_000) return false;
  const want = await signWhatsAppHook(secret, timestamp, body);
  if (want.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}
