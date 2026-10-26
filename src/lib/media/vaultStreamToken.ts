/**
 * The Vault stream-relay token — **isomorphic**.
 *
 * A signed DASH manifest is authorised by a `Cookie` header, and a browser can
 * never set `Cookie` on a cross-origin request. Those bytes therefore have to
 * leave through this app's own origin (`/api/media/vault-stream/<token>`), which
 * re-attaches the cookie. The *token* itself is just base64url JSON — no
 * signature, no secret — so the browser can build the relay URL itself from the
 * play-info payload it already fetched. That is what keeps playback resolution
 * 100% client-side while only the protected bytes take the relay.
 *
 * The token is not a credential: the server validates the upstream host against
 * an allowlist and refuses private/loopback addresses, so a forged token can
 * only reach the CDN hosts it already names.
 *
 * Deliberately free of Node built-ins (`Buffer`), because
 * `exclusiveDirect.ts` imports this in the browser.
 */

/** Route prefix of the relay. */
export const VAULT_STREAM_PATH = "/api/media/vault-stream";

/**
 * A relay descriptor: the upstream URL plus the headers needed to fetch it.
 *
 * `b` is the *base* the upstream URL is relative to. DASH manifests reference
 * their segments relatively, so the relay must know both the manifest and the
 * directory the segments live in to rebuild the correct upstream segment URL.
 */
export interface VaultStreamDescriptor {
  /** Upstream URL (manifest or segment). */
  u: string;
  /** Extra request headers. */
  h?: Array<[string, string]>;
  /** Base directory the upstream URL is resolved against (defaults to the URL's dir). */
  b?: string;
}

/** UTF-8 → base64url, without `Buffer`. */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  // Chunked so a large descriptor cannot blow the argument limit.
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** base64url → UTF-8, or `null` when the input is not one. */
function fromBase64Url(token: string): string | null {
  try {
    const normalized = token.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return null;
  }
}

/** Encodes a descriptor into a URL-safe token. */
export function encodeVaultStreamToken(descriptor: VaultStreamDescriptor): string {
  return toBase64Url(JSON.stringify(descriptor));
}

/** Decodes a token produced by `encodeVaultStreamToken`. */
export function decodeVaultStreamToken(token: string): VaultStreamDescriptor | null {
  if (!token || token.length > 16384) return null;
  const json = fromBase64Url(token);
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const url = typeof record.u === "string" ? record.u : null;
    if (!url || !/^https:\/\//i.test(url)) return null;

    const headers: Array<[string, string]> = [];
    if (Array.isArray(record.h)) {
      for (const entry of record.h) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [name, value] = entry;
        if (typeof name !== "string" || typeof value !== "string") continue;
        // Only the three headers the CDN actually needs are relayed.
        if (!["cookie", "referer", "user-agent"].includes(name.toLowerCase())) continue;
        headers.push([name, value.slice(0, 4096)]);
        if (headers.length >= 8) break;
      }
    }

    const base = typeof record.b === "string" ? record.b : undefined;
    if (base !== undefined && !/^https:\/\//i.test(base)) return null;

    return { u: url, h: headers.length ? headers : undefined, b: base };
  } catch {
    return null;
  }
}

/**
 * Builds the same-origin relay URL for an upstream URL + headers.
 *
 * The token travels in the *path*, not the query: a DASH player resolves its
 * segment URLs relative to the manifest's base, so the base must be a directory
 * path that a segment file name can be appended to.
 *
 * `origin` makes the URL absolute (Shaka needs a scheme); omit it for a relative URL.
 */
export function buildVaultStreamUrl(
  upstreamUrl: string,
  headers?: Array<[string, string]>,
  origin?: string | null,
  base?: string
): string {
  const token = encodeVaultStreamToken({
    u: upstreamUrl,
    h: headers?.length ? headers : undefined,
    b: base,
  });
  const path = `${VAULT_STREAM_PATH}/${token}`;
  const cleanOrigin = (origin || "").trim().replace(/\/+$/, "");
  if (!cleanOrigin || cleanOrigin === "null") return path;
  return `${cleanOrigin}${path}`;
}

/** Reads the upstream URL out of a relay URL, if it is one. */
export function unwrapVaultStreamUrl(maybeUrl: string | null | undefined): string | null {
  if (!maybeUrl) return null;
  try {
    const parsed = new URL(maybeUrl, "https://sidify.local");
    if (!parsed.pathname.startsWith(VAULT_STREAM_PATH)) return null;
    const token = parsed.pathname.slice(VAULT_STREAM_PATH.length).split("/").filter(Boolean)[0];
    if (!token) return null;
    return decodeVaultStreamToken(token)?.u ?? null;
  } catch {
    return null;
  }
}
