// Where a remote user can get this program's source (AGPL-3.0 section 13), reported by GET /health and GET /licences. The values are
// deployment metadata set in wrangler.jsonc `vars` (or `wrangler secret`-free overrides), not an offer for a different release.
export interface SourceEnv {
  /** The public URL of this repository (or of the fork actually deployed). */
  SOURCE_URL?: string;
  /** Optional JSON `{"url": "https://...", "sha256": "<64 hex>"}`: an immutable source archive of exactly this release. */
  SOURCE_ARCHIVE?: string;
  /** A release label, e.g. a git tag. */
  RELEASE?: string;
  /** Identity of the running build, e.g. a commit hash. */
  BUILD_ID?: string;
}

const httpsOnly = (raw: unknown): string | null => {
  try {
    const url = new URL(String(raw));
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};

export function sourceInfo(env: SourceEnv): { release: string; url: string | null; identity: string; archive: { url: string; sha256: string } | null } {
  let archive: { url: string; sha256: string } | null = null;
  try {
    const value = JSON.parse(env.SOURCE_ARCHIVE ?? "null");
    const url = value && typeof value.url === "string" ? httpsOnly(value.url) : null;
    if (url && /^[a-f0-9]{64}$/.test(value.sha256)) archive = { url, sha256: value.sha256 };
  } catch {
    /* An unconfigured release shows an honest fallback, never a broken download link. */
  }
  const url = env.SOURCE_URL ? httpsOnly(env.SOURCE_URL) : null;
  // The placeholder host in wrangler.jsonc is not a real address.
  return { release: env.RELEASE ?? "unreleased", url: url && !new URL(url).hostname.endsWith(".invalid") ? url : null, identity: env.BUILD_ID ?? "not reported", archive };
}
