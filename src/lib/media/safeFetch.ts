/**
 * Hardened server-side fetch guard for upstream HTML scraping & mirror resolution.
 *
 * Security invariants:
 *   1. Never acts as an arbitrary open proxy: every outbound request AND every manual
 *      3xx redirect hop is checked against an explicit stage host allowlist.
 *   2. Enforces `https:` on default port (443), rejects URL credentials (`user:pass@`),
 *      rejects localhost / `.local` / `.internal` names and raw IP literals, and resolves
 *      DNS ahead of every connection to block private, loopback, link-local, CGNAT,
 *      multicast, reserved and cloud-metadata IPs (including IPv4-mapped IPv6).
 *   3. Streams response bytes with a strict ceiling (`maxBytes`), per-hop timeout
 *      (`timeoutMs`), bounded redirect depth (`maxRedirects`) and bounded retries
 *      (`maxRetries`).
 *   4. Never forwards caller cookies, `Authorization`, tokens or session credentials,
 *      and never executes or evaluates untrusted response text.
 *   5. Detects CAPTCHA / JS-challenge / login / 401–403 barriers and surfaces them as
 *      typed non-bypassable failures (`captcha` | `access_control`).
 */

import dns from "node:dns/promises";
import net from "node:net";
import type { MirrorBlockReason } from "./types";

export type FetchPurpose = "catalogue" | "mirror";

export class SafeFetchError extends Error {
  constructor(
    message: string,
    readonly code: MirrorBlockReason,
    readonly status: number = 502,
    readonly host?: string
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface DnsAddress {
  address: string;
  family: number;
}

export type DnsLookupFn = (hostname: string) => Promise<DnsAddress[]>;

export interface SafeFetchOptions {
  purpose: FetchPurpose;
  referer?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  maxRetries?: number;
  /** Dependency injection hooks for deterministic offline tests. */
  fetchImpl?: typeof fetch;
  dnsLookup?: DnsLookupFn;
  extraAllowedHosts?: string[];
}

export interface SafeFetchResult {
  url: string;
  status: number;
  contentType: string;
  text: string;
  redirectChain: string[];
}

export const DEFAULT_TIMEOUT_MS = 8_000;
export const DEFAULT_MAX_BYTES = 2 * 1024 * 1024; // 2 MiB max HTML payload
export const DEFAULT_MAX_REDIRECTS = 5;
export const DEFAULT_MAX_RETRIES = 1;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const EXACT_CATALOGUE_HOSTS = new Set([
  "4khdhub.one",
  "www.4khdhub.one",
  "4khdhub.fans",
  "www.4khdhub.fans",
  "4khdhub.click",
  "www.4khdhub.click",
  "4khdhub.dad",
  "www.4khdhub.dad",
  "4khdhub.lol",
  "www.4khdhub.lol",
  "4khdhub.com",
  "www.4khdhub.com",
]);

const EXACT_MIRROR_HOSTS = new Set([
  "greenmotors.club",
  "www.greenmotors.club",
  "greenmotors.cc",
  "www.greenmotors.cc",
  "greenmotors.pro",
  "greenmotors.shop",
  "greenmotors.online",
  "greenmountmotors.com",
  "www.greenmountmotors.com",
  "gadgetsweb.xyz",
  "www.gadgetsweb.xyz",
  "hblinks.co",
  "www.hblinks.co",
  "gamerxyt.com",
  "www.gamerxyt.com",
  "carnewz.site",
  "www.carnewz.site",
  "cryptoinsights.site",
  "www.cryptoinsights.site",
  "hubcdn.biz",
  "www.hubcdn.biz",
  "pixeldrain.com",
  "www.pixeldrain.com",
  "pixeldrain.dev",
  "www.pixeldrain.dev",
]);

const CATALOGUE_HOST_PATTERN = /^(?:www\.)?4khdhub\.[a-z]{2,10}$/i;
const MIRROR_HOST_PATTERN = /^(?:[a-z0-9-]+\.)?(?:greenmotors|hubdrive|hubcloud)\.[a-z]{2,10}$/i;

const AD_OR_UNSAFE_HOST_RE =
  /(?:^|\.)(?:t\.me|telegram\.me|telegram\.org|tinyurl\.com|winexch\.[a-z]+|adsboosters\.[a-z]+|doubleclick\.net|googletagmanager\.com|google-analytics\.com|cloudflareinsights\.com|1xbet\.[a-z]+)$/i;

/* --------------------------- IP / SSRF checks ---------------------------- */

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return nums as [number, number, number, number];
}

function isBlockedIpv4Octets([a, b, c]: [number, number, number, number]): boolean {
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8 RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local & cloud IMDS
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 RFC1918
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 benchmark
  if (a === 198 && b === 51 && c === 100) return true; // 198.51.100.0/24 TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // 203.0.113.0/24 TEST-NET-3
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved/broadcast
  return false;
}

/** Expand an IPv6 string into 8 16-bit groups (`0..0xffff`). */
function parseIpv6Groups(raw: string): number[] | null {
  const clean = raw.split("%")[0].toLowerCase();
  if (net.isIP(clean) !== 6) return null;

  // Handle dotted-quad tail, e.g. `::ffff:127.0.0.1`
  const lastColon = clean.lastIndexOf(":");
  let normalized = clean;
  if (lastColon !== -1 && clean.slice(lastColon + 1).includes(".")) {
    const octets = parseIpv4Octets(clean.slice(lastColon + 1));
    if (!octets) return null;
    const hi = ((octets[0] << 8) | octets[1]).toString(16);
    const lo = ((octets[2] << 8) | octets[3]).toString(16);
    normalized = `${clean.slice(0, lastColon)}:${hi}:${lo}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = halves.length === 2 ? 8 - (left.length + right.length) : 0;
  if (missing < 0) return null;
  const full = halves.length === 2 ? [...left, ...Array<string>(missing).fill("0"), ...right] : left;
  if (full.length !== 8) return null;

  const groups = full.map((g) => (/^[0-9a-f]{1,4}$/.test(g) ? parseInt(g, 16) : NaN));
  return groups.some((n) => Number.isNaN(n)) ? null : groups;
}

/** True when `ip` is private, loopback, link-local, CGNAT, multicast, reserved or invalid. */
export function isBlockedIp(rawIp: string): boolean {
  const ip = rawIp.trim().replace(/^\[|\]$/g, "");
  const version = net.isIP(ip);
  if (version === 4) {
    const octets = parseIpv4Octets(ip);
    return octets ? isBlockedIpv4Octets(octets) : true;
  }
  if (version === 6) {
    const g = parseIpv6Groups(ip);
    if (!g) return true;
    const allZero = g.slice(0, 7).every((x) => x === 0);
    if (allZero && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
    // IPv4-mapped `::ffff:w.x.y.z`, IPv4-compatible `::w.x.y.z`, NAT64 `64:ff9b::w.x.y.z`
    const isMappedV4 =
      (g[0] === 0 && g[1] === 0 && g[2] === 0 && g[3] === 0 && g[4] === 0 && (g[5] === 0xffff || g[5] === 0)) ||
      (g[0] === 0x0064 && g[1] === 0xff9b && g[2] === 0 && g[3] === 0 && g[4] === 0 && g[5] === 0);
    if (isMappedV4) {
      const octets: [number, number, number, number] = [
        (g[6] >> 8) & 0xff,
        g[6] & 0xff,
        (g[7] >> 8) & 0xff,
        g[7] & 0xff,
      ];
      return isBlockedIpv4Octets(octets);
    }
    if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // 2001:db8::/32 documentation
    return false;
  }
  return true;
}

export function isSuspiciousHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host.length > 253) return true;
  if (net.isIP(host) !== 0) return true;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    !host.includes(".")
  ) {
    return true;
  }
  return false;
}

function configuredExtraHosts(): Set<string> {
  const set = new Set<string>();
  const raw = process.env.FOURKHDHUB_EXTRA_HOSTS || "";
  for (const part of raw.split(",")) {
    const cleaned = part.trim().toLowerCase();
    if (cleaned && !isSuspiciousHostname(cleaned)) set.add(cleaned);
  }
  const customBase = process.env.FOURKHDHUB_BASE_URL;
  if (customBase) {
    try {
      const parsed = new URL(customBase);
      if (parsed.protocol === "https:" && !isSuspiciousHostname(parsed.hostname)) {
        set.add(parsed.hostname.toLowerCase());
      }
    } catch {
      /* ignore malformed env override */
    }
  }
  return set;
}

export function isHostAllowed(hostname: string, purpose: FetchPurpose, extraAllowedHosts?: Iterable<string>): boolean {
  const host = hostname.trim().toLowerCase();
  if (isSuspiciousHostname(host)) return false;
  if (AD_OR_UNSAFE_HOST_RE.test(host)) return false;

  const extra = configuredExtraHosts();
  if (extraAllowedHosts) {
    for (const entry of extraAllowedHosts) extra.add(entry.toLowerCase());
  }
  if (extra.has(host)) return true;

  if (purpose === "catalogue") {
    return EXACT_CATALOGUE_HOSTS.has(host) || CATALOGUE_HOST_PATTERN.test(host);
  }
  return (
    EXACT_MIRROR_HOSTS.has(host) ||
    MIRROR_HOST_PATTERN.test(host) ||
    EXACT_CATALOGUE_HOSTS.has(host) ||
    CATALOGUE_HOST_PATTERN.test(host)
  );
}

/**
 * Validate a candidate public HTTPS URL to display/return to the browser (e.g. poster,
 * resolved CDN download link, or external fallback link) without making a network call.
 */
export function sanitizePublicHttpsUrl(rawUrl: string | undefined | null, baseUrl?: string): string | null {
  if (!rawUrl || typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || /^(?:data:|blob:|javascript:|vbscript:|mailto:|file:)/i.test(trimmed)) return null;

  let parsed: URL;
  try {
    parsed = baseUrl ? new URL(trimmed, baseUrl) : new URL(trimmed);
  } catch {
    return null;
  }

  if (parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.port !== "" && parsed.port !== "443") return null;
  if (isSuspiciousHostname(parsed.hostname)) return null;
  if (AD_OR_UNSAFE_HOST_RE.test(parsed.hostname)) return null;

  parsed.hash = "";
  return parsed.toString();
}

const defaultDnsLookup: DnsLookupFn = async (hostname: string) => {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family }));
};

export async function assertSafeUrl(
  rawUrl: string,
  options: Pick<SafeFetchOptions, "purpose" | "dnsLookup" | "extraAllowedHosts">
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new SafeFetchError("Malformed upstream URL", "malformed_response", 400);
  }

  if (parsed.protocol !== "https:") {
    throw new SafeFetchError(`Blocked non-HTTPS protocol (${parsed.protocol})`, "insecure_protocol", 403, parsed.hostname);
  }
  if (parsed.username || parsed.password) {
    throw new SafeFetchError("Blocked credentials in URL", "insecure_protocol", 403, parsed.hostname);
  }
  if (parsed.port !== "" && parsed.port !== "443") {
    throw new SafeFetchError(`Blocked non-standard HTTPS port (${parsed.port})`, "disallowed_host", 403, parsed.hostname);
  }

  if (net.isIP(parsed.hostname.replace(/^\[|\]$/g, "")) !== 0) {
    throw new SafeFetchError("Blocked raw IP literal URL", "blocked_ip", 403, parsed.hostname);
  }
  if (isSuspiciousHostname(parsed.hostname)) {
    throw new SafeFetchError(`Blocked internal/local hostname (${parsed.hostname})`, "blocked_ip", 403, parsed.hostname);
  }
  if (!isHostAllowed(parsed.hostname, options.purpose, options.extraAllowedHosts)) {
    throw new SafeFetchError(
      `Host "${parsed.hostname}" is not in the ${options.purpose} allowlist`,
      "disallowed_host",
      403,
      parsed.hostname
    );
  }

  const lookup = options.dnsLookup ?? defaultDnsLookup;
  let records: DnsAddress[];
  try {
    records = await lookup(parsed.hostname);
  } catch (err) {
    throw new SafeFetchError(
      `DNS lookup failed for ${parsed.hostname}: ${(err as Error)?.message || "unreachable"}`,
      "network_error",
      503,
      parsed.hostname
    );
  }

  if (!records.length || records.some((r) => isBlockedIp(r.address))) {
    throw new SafeFetchError(
      `Blocked private or reserved IP resolution for ${parsed.hostname}`,
      "blocked_ip",
      403,
      parsed.hostname
    );
  }

  parsed.hash = "";
  return parsed;
}

/* --------------------- access-barrier / challenge check ------------------ */

export function detectAccessBarrier(
  status: number,
  headers: Headers,
  body: string
): { reason: "captcha" | "access_control"; detail: string } | null {
  const cfMitigated = headers.get("cf-mitigated") || "";
  if (/challenge/i.test(cfMitigated)) {
    return { reason: "captcha", detail: "Upstream host presented an automated challenge page." };
  }

  const snippet = body.slice(0, 12_000);
  if (
    (/<title>\s*Just a moment\.{0,3}\s*<\/title>/i.test(snippet) && /__cf_chl_opt|challenge-platform/i.test(snippet)) ||
    /class=["'][^"']*(?:cf-turnstile|g-recaptcha|h-captcha)[^"']*["']/i.test(snippet)
  ) {
    return { reason: "captcha", detail: "Interactive CAPTCHA verification is required on this mirror hop." };
  }

  if (status === 401 || status === 402 || status === 403) {
    return { reason: "access_control", detail: `Upstream host refused public access (HTTP ${status}).` };
  }

  if (
    /<input[^>]+type=["']password["']/i.test(snippet) &&
    /(?:sign\s*in|log\s*in|subscription|paywall|members\s*only)/i.test(snippet) &&
    snippet.length < 25_000
  ) {
    return { reason: "access_control", detail: "Upstream page requires authentication or subscription access." };
  }

  return null;
}

/* ------------------------ bounded streaming reader ----------------------- */

async function readBoundedText(res: Response, maxBytes: number, host: string): Promise<string> {
  const contentLength = Number(res.headers.get("content-length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    try {
      await res.body?.cancel();
    } catch {
      /* ignore cancel error */
    }
    throw new SafeFetchError(`Response exceeded ${maxBytes} byte limit`, "response_too_large", 502, host);
  }

  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const chunks: string[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new SafeFetchError(`Streamed body exceeded ${maxBytes} byte limit`, "response_too_large", 502, host);
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }
    chunks.push(decoder.decode());
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

/* ----------------------------- main transport ---------------------------- */

export async function safeFetchHtml(targetUrl: string, options: SafeFetchOptions): Promise<SafeFetchResult> {
  const fetchFn = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const maxRetries = Math.max(0, Math.min(options.maxRetries ?? DEFAULT_MAX_RETRIES, 3));

  let currentUrl = (await assertSafeUrl(targetUrl, options)).toString();
  const redirectChain: string[] = [currentUrl];
  const visited = new Set<string>([currentUrl]);
  let referer = sanitizePublicHttpsUrl(options.referer);

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const host = new URL(currentUrl).hostname;
    let res: Response | null = null;
    let lastError: unknown;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const headers: Record<string, string> = {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
        };
        if (referer) headers.referer = referer;

        res = await fetchFn(currentUrl, {
          method: "GET",
          headers,
          redirect: "manual",
          credentials: "omit",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (isRetryableStatus(res.status) && attempt < maxRetries) {
          try {
            await res.body?.cancel();
          } catch {
            /* ignore */
          }
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
          res = null;
          continue;
        }
        break;
      } catch (err) {
        lastError = err;
        const name = (err as Error)?.name || "";
        const message = (err as Error)?.message || "";
        const timedOut = name === "TimeoutError" || name === "AbortError" || /timed?\s*out/i.test(message);
        if (attempt < maxRetries && !timedOut) {
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
          continue;
        }
        throw new SafeFetchError(
          timedOut
            ? `Upstream request timed out after ${timeoutMs}ms (${host})`
            : `Upstream connection failed for ${host}: ${message || "network unreachable"}`,
          timedOut ? "timeout" : "network_error",
          timedOut ? 504 : 503,
          host
        );
      }
    }

    if (!res) {
      throw new SafeFetchError(
        `Upstream request failed for ${host}: ${(lastError as Error)?.message || "unknown error"}`,
        "network_error",
        503,
        host
      );
    }

    if (isRedirectStatus(res.status)) {
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
      if (hop === maxRedirects) {
        throw new SafeFetchError(`Too many redirects (> ${maxRedirects})`, "malformed_response", 502, host);
      }
      const location = res.headers.get("location");
      if (!location) {
        throw new SafeFetchError("Redirect response missing Location header", "malformed_response", 502, host);
      }
      let nextCandidate: string;
      try {
        nextCandidate = new URL(location, currentUrl).toString();
      } catch {
        throw new SafeFetchError("Malformed redirect Location header", "malformed_response", 502, host);
      }
      const validatedNext = (await assertSafeUrl(nextCandidate, options)).toString();
      if (visited.has(validatedNext)) {
        throw new SafeFetchError("Redirect loop detected", "malformed_response", 502, validatedNext);
      }
      visited.add(validatedNext);
      redirectChain.push(validatedNext);
      referer = currentUrl;
      currentUrl = validatedNext;
      continue;
    }

    const contentType = res.headers.get("content-type") || "";
    const text = await readBoundedText(res, maxBytes, host);

    const barrier = detectAccessBarrier(res.status, res.headers, text);
    if (barrier) {
      throw new SafeFetchError(barrier.detail, barrier.reason, res.status === 401 || res.status === 403 ? res.status : 502, host);
    }

    if (res.status >= 500) {
      throw new SafeFetchError(`Upstream server error (HTTP ${res.status}) on ${host}`, "network_error", 502, host);
    }

    return {
      url: currentUrl,
      status: res.status,
      contentType,
      text,
      redirectChain,
    };
  }

  throw new SafeFetchError("Redirect limit exceeded", "malformed_response", 502);
}
