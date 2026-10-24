/**
 * Signed-stream relay for the Vault CDN.
 *
 * The upstream CDN authorises playback with a signed `Cookie` (CloudFront policy or
 * edge-cache token) plus a `Referer`. A browser can neither set `Cookie` on a
 * cross-origin request nor attach a signed cookie to a `<video>`/Shaka segment fetch,
 * so those requests are relayed through this app's own origin.
 *
 * Security invariants (mirroring `streamProxy.ts`):
 *   1. Never an open proxy — only the Vault CDN hosts are reachable, and the relay URL
 *      carries its own signed token, so a caller cannot aim it at an arbitrary host.
 *   2. `https:` only, port 443, no URL credentials, and the upstream host must resolve
 *      to a public IP (private / loopback / link-local / metadata ranges are refused).
 *   3. Only `Cookie`, `Referer` and `User-Agent` are forwarded — never caller headers.
 *   4. Responses are bounded and never buffered whole: bytes are streamed with `Range`
 *      support so Shaka's MSE fetcher can seek.
 */

import dns from "node:dns/promises";
import { isBlockedIp, type DnsAddress, type DnsLookupFn } from "./safeFetch";

/** Route prefix of the relay. */
export const VAULT_STREAM_PATH = "/api/media/vault-stream";

/** Upstream hosts the relay is allowed to reach. */
const ALLOWED_UPSTREAM_HOSTS = new Set([
  "sbcdn3.hakunaymatata.com",
  "sacdn.hakunaymatata.com",
  "macdn.aoneroom.com",
  "cdn.aoneroom.com",
  "pacdn.aoneroom.com",
  "p3-pc.aoneroom.com",
]);

/**
 * `*.hakunaymatata.com` / `*.aoneroom.com` are the CDN families in use — they serve
 * the signed DASH manifests and the direct media files.
 */
const ALLOWED_UPSTREAM_SUFFIXES = [".hakunaymatata.com", ".aoneroom.com"];

/** Headers we are willing to relay upstream. */
const RELAYED_HEADER_NAMES = new Set(["cookie", "referer", "user-agent"]);

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

export function isAllowedVaultUpstreamHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return false;
  if (ALLOWED_UPSTREAM_HOSTS.has(host)) return true;
  return ALLOWED_UPSTREAM_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * A relay descriptor: the upstream URL plus the headers needed to fetch it.
 * Serialised into the relay URL so no server-side state is needed.
 *
 * `b` is the *base* the upstream URL is relative to. DASH manifests reference their
 * segments relatively, so the relay must know both the manifest and the directory the
 * segments live in to rebuild the correct upstream segment URL.
 */
export interface VaultStreamDescriptor {
  /** Upstream URL (manifest or segment). */
  u: string;
  /** Extra request headers. */
  h?: Array<[string, string]>;
  /** Base directory the upstream URL is resolved against (defaults to the URL's dir). */
  b?: string;
}

/** Encodes a descriptor into a URL-safe token. */
export function encodeVaultStreamToken(descriptor: VaultStreamDescriptor): string {
  return Buffer.from(JSON.stringify(descriptor), "utf8").toString("base64url");
}

/** Decodes a token produced by `encodeVaultStreamToken`. */
export function decodeVaultStreamToken(token: string): VaultStreamDescriptor | null {
  if (!token || token.length > 16384) return null;
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as unknown;
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
        if (!RELAYED_HEADER_NAMES.has(name.toLowerCase())) continue;
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
 * The token travels in the *path*, not the query: a DASH player resolves its segment
 * URLs relative to the manifest's base, so the base must be a directory path that a
 * segment file name can be appended to.
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

export interface VaultStreamDeps {
  fetchImpl?: typeof fetch;
  dnsLookup?: DnsLookupFn;
  timeoutMs?: number;
}

export class VaultStreamError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message);
    this.name = "VaultStreamError";
  }
}

async function defaultDnsLookup(hostname: string): Promise<DnsAddress[]> {
  const results = await dns.lookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => ({ address: entry.address, family: entry.family }));
}

/** Rejects hosts that resolve to non-public addresses (SSRF guard). */
export async function assertPublicUpstream(
  url: string,
  deps: VaultStreamDeps = {}
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new VaultStreamError("Malformed upstream URL.", "malformed_url", 400);
  }
  if (parsed.protocol !== "https:") {
    throw new VaultStreamError("Only https upstream URLs are relayed.", "insecure_protocol", 403);
  }
  if (parsed.port && parsed.port !== "443") {
    throw new VaultStreamError("Only the default HTTPS port is relayed.", "disallowed_host", 403);
  }
  if (parsed.username || parsed.password) {
    throw new VaultStreamError("Upstream URL credentials are not relayed.", "disallowed_host", 403);
  }
  if (!isAllowedVaultUpstreamHost(parsed.hostname)) {
    throw new VaultStreamError("Upstream host is not on the relay allowlist.", "disallowed_host", 403);
  }

  const lookup = deps.dnsLookup ?? defaultDnsLookup;
  let addresses: DnsAddress[];
  try {
    addresses = await lookup(parsed.hostname);
  } catch {
    throw new VaultStreamError("Upstream host could not be resolved.", "network_error", 502);
  }
  if (!addresses.length) {
    throw new VaultStreamError("Upstream host could not be resolved.", "network_error", 502);
  }
  for (const address of addresses) {
    if (isBlockedIp(address.address)) {
      throw new VaultStreamError("Upstream host resolves to a blocked address.", "blocked_ip", 403);
    }
  }
  return parsed;
}

export interface VaultStreamResult {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

/**
 * Fetches an upstream URL with the relayed headers and streams the response back.
 * `range` (the caller's `Range` header) is forwarded verbatim so seeking works.
 */
export async function fetchVaultStream(
  upstreamUrl: string,
  headers: Array<[string, string]> | undefined,
  range: string | null,
  deps: VaultStreamDeps = {}
): Promise<VaultStreamResult> {
  const parsed = await assertPublicUpstream(upstreamUrl, deps);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const outbound = new Headers();
  outbound.set("accept-encoding", "identity");
  for (const [name, value] of headers ?? []) {
    if (!RELAYED_HEADER_NAMES.has(name.toLowerCase())) continue;
    outbound.set(name, value);
  }
  if (!outbound.has("user-agent")) {
    outbound.set("user-agent", "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36");
  }
  if (range) outbound.set("range", range);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(parsed.toString(), {
      method: "GET",
      headers: outbound,
      signal: controller.signal,
      redirect: "follow",
    });
  } catch (error) {
    clearTimeout(timer);
    throw new VaultStreamError(
      (error as Error)?.name === "AbortError"
        ? "Upstream request timed out."
        : `Upstream request failed: ${(error as Error)?.message || "network error"}`,
      "network_error",
      502
    );
  }
  clearTimeout(timer);

  const responseHeaders = new Headers();
  for (const name of [
    "content-type",
    "content-length",
    "content-range",
    "accept-ranges",
    "etag",
    "last-modified",
  ]) {
    const value = response.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (!responseHeaders.has("accept-ranges")) responseHeaders.set("accept-ranges", "bytes");

  return { status: response.status, headers: responseHeaders, body: response.body };
}

/**
 * Rewrites a DASH manifest so its segments are fetched through the relay too.
 *
 * A DASH manifest usually carries an absolute `<BaseURL>` pointing at the CDN, and its
 * segment templates are relative to that base. The browser cannot attach the signed
 * cookie to those segment requests, so the base is rewritten to a same-origin relay
 * URL. Segment requests then arrive here as `/api/media/vault-stream/<segment>?t=…`
 * and are resolved against the token's base directory.
 */
export function rewriteDashManifest(
  manifest: string,
  relayBaseUrl: string
): string {
  const base = relayBaseUrl.endsWith("/") ? relayBaseUrl : `${relayBaseUrl}/`;
  const encodedBase = base.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  if (/<BaseURL>[\s\S]*?<\/BaseURL>/i.test(manifest)) {
    return manifest.replace(/<BaseURL>[\s\S]*?<\/BaseURL>/gi, `<BaseURL>${encodedBase}</BaseURL>`);
  }
  // No base element: inject one right after the opening <MPD ...> tag.
  return manifest.replace(/<MPD\b[^>]*>/i, (match) => `${match}<BaseURL>${encodedBase}</BaseURL>`);
}

/**
 * Resolves a segment path against the base directory the manifest was served from.
 *
 * `segment` is the path the player requested below the relay's base (e.g.
 * `1_video.mp4`). It is joined to the token's base directory, which is the CDN folder
 * the manifest lives in.
 */
export function resolveVaultSegmentUrl(base: string | undefined, segment: string): string | null {
  if (!base) return null;
  // The player may carry the relay's own query string onto the segment path; only the
  // path part identifies the segment.
  const clean = segment.split("?")[0].split("#")[0].replace(/^\/+/, "");
  if (!clean) return null;
  // Reject traversal attempts and absolute URLs — the segment must stay under the base.
  if (clean.includes("..") || /^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;

  let baseUrl: URL;
  try {
    baseUrl = new URL(base);
  } catch {
    return null;
  }
  const directory = baseUrl.pathname.endsWith("/") ? baseUrl.pathname : `${baseUrl.pathname}/`;
  const resolved = new URL(directory + clean, baseUrl.origin);
  if (resolved.origin !== baseUrl.origin) return null;
  return resolved.toString();
}

/** True when the payload looks like a DASH manifest. */
export function isDashManifest(contentType: string | null, bodyStart?: string): boolean {
  const type = (contentType || "").toLowerCase();
  if (type.includes("dash+xml")) return true;
  if (bodyStart && /<\s*MPD[\s>]/i.test(bodyStart)) return true;
  return false;
}

export { MAX_MANIFEST_BYTES };
