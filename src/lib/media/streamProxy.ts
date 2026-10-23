/**
 * Hardened server-side media Range & redirect streaming proxy for Shaka Player MSE.
 *
 * Security invariants:
 *   1. Never an open proxy: Hop 0 must match `isAllowedStreamEntryHost` (explicit media CDN
 *      & mirror allowlist), and cross-site hotlink requests (`Sec-Fetch-Site: cross-site`)
 *      are rejected with 403.
 *   2. Every hop (Hop 0 and up to `MAX_STREAM_REDIRECTS` manual 3xx hops) enforces `https:`,
 *      port 443, zero URL credentials, hostname safety, and pre-connect DNS resolution blocking
 *      all private, loopback, link-local, CGNAT, multicast, reserved, and cloud-metadata IPs.
 *   3. Never proxies HTML pages (`text/html` / `application/xhtml+xml` -> 415) or unbounded
 *      multi-gigabyte unranged downloads (`MAX_UNRANGED_STREAM_BYTES`), and caps open-ended
 *      `Range: bytes=N-` requests into serverless-friendly 4 MiB chunks.
 *   4. Uses `Accept-Encoding: identity` so upstream `Content-Range` and `Content-Length` byte
 *      counts remain exact for Shaka's `MatroskaParser` and `SidifyProgressiveMp4Parser`.
 */

import dns from "node:dns/promises";
import {
  isBlockedIp,
  isSuspiciousHostname,
  type DnsAddress,
  type DnsLookupFn,
} from "./safeFetch";
import {
  isAllowedStreamEntryHost,
  isUnsafeMediaHostname,
  MEDIA_STREAM_FINAL_URL_HEADER,
} from "./streamProxyUrl";

export const OPEN_ENDED_CHUNK_BYTES = 4 * 1024 * 1024; // 4 MiB chunk for open-ended `bytes=N-`
export const MAX_BOUNDED_RANGE_BYTES = 32 * 1024 * 1024; // 32 MiB ceiling per bounded segment request
export const MAX_UNRANGED_STREAM_BYTES = 48 * 1024 * 1024; // 48 MiB ceiling for unranged HLS/DASH assets
export const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_STREAM_REDIRECTS = 5;

const STREAM_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface StreamProxyDeps {
  fetchImpl?: typeof fetch;
  dnsLookup?: DnsLookupFn;
  extraAllowedHosts?: Iterable<string>;
  connectTimeoutMs?: number;
  maxRedirects?: number;
}

class StreamProxyError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "StreamProxyError";
  }
}

const defaultDnsLookup: DnsLookupFn = async (hostname: string): Promise<DnsAddress[]> => {
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  return records.map((r) => ({ address: r.address, family: r.family }));
};

function collectEnvExtraAllowedHosts(): string[] {
  const hosts = new Set<string>();
  const rawList = process.env.MEDIA_STREAM_ALLOWED_HOSTS || "";
  for (const part of rawList.split(",")) {
    const clean = part.trim().toLowerCase();
    if (clean) hosts.add(clean);
  }

  const rawManifest = process.env.MEDIA_PLAYBACK_MANIFEST || "";
  if (rawManifest.trim()) {
    try {
      const parsed = JSON.parse(rawManifest) as Record<string, Array<{ url?: string }>>;
      for (const entries of Object.values(parsed)) {
        if (!Array.isArray(entries)) continue;
        for (const item of entries) {
          if (!item?.url) continue;
          try {
            const u = new URL(item.url);
            if (u.protocol === "https:" && u.hostname) {
              hosts.add(u.hostname.toLowerCase());
            }
          } catch {
            // Ignore malformed manifest entry
          }
        }
      }
    } catch {
      // Ignore malformed manifest JSON
    }
  }

  return Array.from(hosts);
}

export interface NormalizedRangeResult {
  upstreamRange: string | null;
  invalid: boolean;
}

/**
 * Validates and bounds an incoming HTTP `Range` header:
 * - Bounded `bytes=start-end` (used by Shaka `MatroskaParser` & `SidifyProgressiveMp4Parser`):
 *   preserved verbatim up to `MAX_BOUNDED_RANGE_BYTES` (32 MiB).
 * - Open-ended `bytes=start-` (used by `<video src>`): bounded to `OPEN_ENDED_CHUNK_BYTES` (4 MiB)
 *   so serverless invocations complete quickly and browsers naturally request subsequent chunks.
 * - Suffix `bytes=-suffixLen`: bounded to `MAX_BOUNDED_RANGE_BYTES`.
 */
export function normalizeStreamRangeHeader(rawRange: string | null): NormalizedRangeResult {
  if (!rawRange || !rawRange.trim()) {
    return { upstreamRange: null, invalid: false };
  }

  const trimmed = rawRange.trim();
  // Reject multi-range requests (`bytes=0-10, 20-30`) and non-byte units
  if (trimmed.includes(",") || !/^bytes=/i.test(trimmed)) {
    return { upstreamRange: null, invalid: true };
  }

  const spec = trimmed.slice(6).trim();
  const suffixMatch = spec.match(/^-(\d+)$/);
  if (suffixMatch) {
    const suffixLen = Number(suffixMatch[1]);
    if (!Number.isSafeInteger(suffixLen) || suffixLen <= 0) {
      return { upstreamRange: null, invalid: true };
    }
    const capped = Math.min(suffixLen, MAX_BOUNDED_RANGE_BYTES);
    return { upstreamRange: `bytes=-${capped}`, invalid: false };
  }

  const rangeMatch = spec.match(/^(\d+)-(\d*)$/);
  if (!rangeMatch) {
    return { upstreamRange: null, invalid: true };
  }

  const start = Number(rangeMatch[1]);
  if (!Number.isSafeInteger(start) || start < 0) {
    return { upstreamRange: null, invalid: true };
  }

  if (rangeMatch[2] === "") {
    const end = start + OPEN_ENDED_CHUNK_BYTES - 1;
    return { upstreamRange: `bytes=${start}-${end}`, invalid: false };
  }

  const end = Number(rangeMatch[2]);
  if (!Number.isSafeInteger(end) || end < start) {
    return { upstreamRange: null, invalid: true };
  }

  const cappedEnd = Math.min(end, start + MAX_BOUNDED_RANGE_BYTES - 1);
  return { upstreamRange: `bytes=${start}-${cappedEnd}`, invalid: false };
}

async function assertSafeStreamHopUrl(
  rawUrl: string,
  opts: {
    isEntryHop: boolean;
    dnsLookup: DnsLookupFn;
    extraAllowedHosts: Set<string>;
  },
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new StreamProxyError("Malformed media stream URL.", "invalid_url", 400);
  }

  if (parsed.protocol !== "https:") {
    throw new StreamProxyError("Only HTTPS media URLs are permitted.", "insecure_protocol", 403);
  }

  if (parsed.username || parsed.password) {
    throw new StreamProxyError("Credentials in media URLs are forbidden.", "invalid_url", 400);
  }

  if (parsed.port !== "" && parsed.port !== "443") {
    throw new StreamProxyError("Non-standard ports are forbidden.", "disallowed_port", 403);
  }

  if (/\/tg\/go\b/i.test(parsed.pathname)) {
    throw new StreamProxyError("Telegram redirect links are not playable media.", "disallowed_host", 403);
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (isSuspiciousHostname(host) || isUnsafeMediaHostname(host)) {
    throw new StreamProxyError(`Blocked unsafe media hostname: ${host}`, "disallowed_host", 403);
  }

  if (opts.isEntryHop && !isAllowedStreamEntryHost(host, opts.extraAllowedHosts)) {
    throw new StreamProxyError(`Host is not in the media stream allowlist: ${host}`, "disallowed_host", 403);
  }

  let records: DnsAddress[];
  try {
    records = await opts.dnsLookup(host);
  } catch {
    throw new StreamProxyError(`DNS lookup failed for ${host}`, "dns_failure", 502);
  }

  if (!records || records.length === 0) {
    throw new StreamProxyError(`Host resolved to no addresses: ${host}`, "dns_failure", 502);
  }

  for (const rec of records) {
    if (isBlockedIp(rec.address)) {
      throw new StreamProxyError("Blocked non-public IP address on media host.", "blocked_ip", 403);
    }
  }

  parsed.hash = "";
  return parsed;
}

function inferMediaContentType(upstreamType: string | null, finalUrl: string): string {
  const raw = (upstreamType || "").trim();
  const lower = raw.split(";")[0].trim().toLowerCase();

  if (raw && lower !== "application/octet-stream" && lower !== "binary/octet-stream") {
    return raw;
  }

  const pathPart = finalUrl.split(/[?#]/)[0].toLowerCase();
  if (pathPart.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (pathPart.endsWith(".mpd")) return "application/dash+xml";
  if (pathPart.endsWith(".mkv")) return "video/x-matroska";
  if (pathPart.endsWith(".webm")) return "video/webm";
  if (pathPart.endsWith(".mp4") || pathPart.endsWith(".m4v")) return "video/mp4";
  if (pathPart.endsWith(".vtt")) return "text/vtt; charset=utf-8";
  if (pathPart.endsWith(".srt")) return "text/plain; charset=utf-8";
  return raw || "application/octet-stream";
}

function jsonError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function cancelBodyQuietly(res: Response | null | undefined): void {
  try {
    void res?.body?.cancel()?.catch(() => {});
  } catch {
    // Ignore stream cancel errors
  }
}

export async function proxyMediaStreamRequest(
  request: Request,
  deps: StreamProxyDeps = {},
): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return jsonError(405, "method_not_allowed", "Only GET and HEAD are supported.");
  }

  // Prevent third-party websites from hotlinking Sidify's media stream proxy
  const secFetchSite = (request.headers.get("sec-fetch-site") || "").trim().toLowerCase();
  if (secFetchSite === "cross-site") {
    return jsonError(403, "cross_site_forbidden", "Cross-site media proxy requests are forbidden.");
  }

  let reqUrl: URL;
  try {
    reqUrl = new URL(request.url);
  } catch {
    return jsonError(400, "invalid_request", "Invalid request URL.");
  }

  const rawTarget = (reqUrl.searchParams.get("url") || "").trim();
  if (!rawTarget) {
    return jsonError(400, "missing_url", "Missing required `url` query parameter.");
  }
  if (rawTarget.length > 4096) {
    return jsonError(400, "invalid_url", "Target URL exceeds maximum length.");
  }

  const incomingRange = request.headers.get("range");
  const { upstreamRange, invalid: invalidRange } = normalizeStreamRangeHeader(incomingRange);
  if (invalidRange) {
    return jsonError(416, "invalid_range", "Malformed or unsupported HTTP Range header.");
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const dnsLookup = deps.dnsLookup ?? defaultDnsLookup;
  const connectTimeoutMs = deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
  const maxRedirects = deps.maxRedirects ?? DEFAULT_MAX_STREAM_REDIRECTS;

  const extraAllowedHosts = new Set<string>(collectEnvExtraAllowedHosts());
  if (deps.extraAllowedHosts) {
    for (const h of deps.extraAllowedHosts) {
      if (h) extraAllowedHosts.add(h.trim().toLowerCase());
    }
  }

  const abortCtrl = new AbortController();
  const onClientAbort = () => abortCtrl.abort();
  request.signal?.addEventListener("abort", onClientAbort, { once: true });

  try {
    let verifiedUrl = await assertSafeStreamHopUrl(rawTarget, {
      isEntryHop: true,
      dnsLookup,
      extraAllowedHosts,
    });

    let upstreamRes: Response | null = null;

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const upstreamHeaders: Record<string, string> = {
        "User-Agent": STREAM_USER_AGENT,
        Accept: "*/*",
        "Accept-Encoding": "identity",
      };
      if (upstreamRange) {
        upstreamHeaders.Range = upstreamRange;
      }

      const connectTimer = setTimeout(() => abortCtrl.abort(), connectTimeoutMs);
      try {
        upstreamRes = await fetchImpl(verifiedUrl.toString(), {
          method,
          headers: upstreamHeaders,
          redirect: "manual",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          cache: "no-store",
          signal: abortCtrl.signal,
        });
      } catch (err) {
        if (request.signal?.aborted) {
          return new Response(null, { status: 499 });
        }
        const isAbort = (err as Error)?.name === "AbortError";
        throw new StreamProxyError(
          isAbort ? "Timed out connecting to media host." : "Upstream media connection failed.",
          isAbort ? "timeout" : "upstream_network_error",
          isAbort ? 504 : 502,
        );
      } finally {
        clearTimeout(connectTimer);
      }

      if (REDIRECT_STATUSES.has(upstreamRes.status)) {
        const location = upstreamRes.headers.get("location");
        cancelBodyQuietly(upstreamRes);

        if (!location) {
          throw new StreamProxyError(
            "Upstream media redirect did not include a Location header.",
            "invalid_redirect",
            502,
          );
        }
        if (hop === maxRedirects) {
          throw new StreamProxyError(
            "Upstream media exceeded maximum redirect hops.",
            "too_many_redirects",
            502,
          );
        }

        let resolvedNext: string;
        try {
          resolvedNext = new URL(location, verifiedUrl).toString();
        } catch {
          throw new StreamProxyError("Malformed redirect Location URL.", "invalid_redirect", 502);
        }

        verifiedUrl = await assertSafeStreamHopUrl(resolvedNext, {
          isEntryHop: false,
          dnsLookup,
          extraAllowedHosts,
        });
        continue;
      }

      break;
    }

    if (!upstreamRes) {
      throw new StreamProxyError("No upstream response received.", "upstream_network_error", 502);
    }

    if (upstreamRes.status >= 400) {
      const status = upstreamRes.status;
      cancelBodyQuietly(upstreamRes);
      const mappedStatus =
        status === 401 || status === 403 || status === 404 || status === 410 || status === 416 || status === 429
          ? status
          : 502;
      return jsonError(mappedStatus, "upstream_http_error", `Upstream media host returned HTTP ${status}.`);
    }

    const rawContentType = upstreamRes.headers.get("content-type");
    const baseContentType = (rawContentType || "").split(";")[0].trim().toLowerCase();
    if (baseContentType === "text/html" || baseContentType === "application/xhtml+xml") {
      cancelBodyQuietly(upstreamRes);
      return jsonError(
        415,
        "not_media",
        "Upstream returned an HTML page instead of a playable media stream.",
      );
    }

    const contentLengthHeader = upstreamRes.headers.get("content-length");
    const parsedLength = contentLengthHeader ? Number(contentLengthHeader) : NaN;
    if (
      !upstreamRange &&
      upstreamRes.status === 200 &&
      Number.isFinite(parsedLength) &&
      parsedLength > MAX_UNRANGED_STREAM_BYTES
    ) {
      cancelBodyQuietly(upstreamRes);
      return jsonError(
        416,
        "range_required",
        "HTTP Range header is required when streaming large media files.",
      );
    }

    const finalUrl = verifiedUrl.toString();
    const responseHeaders = new Headers();
    responseHeaders.set("Content-Type", inferMediaContentType(rawContentType, finalUrl));

    if (contentLengthHeader) {
      responseHeaders.set("Content-Length", contentLengthHeader);
    }

    const contentRangeHeader = upstreamRes.headers.get("content-range");
    if (contentRangeHeader) {
      responseHeaders.set("Content-Range", contentRangeHeader);
    }

    const acceptRangesHeader = upstreamRes.headers.get("accept-ranges");
    if (acceptRangesHeader) {
      responseHeaders.set("Accept-Ranges", acceptRangesHeader);
    } else if (upstreamRes.status === 206 || contentRangeHeader) {
      responseHeaders.set("Accept-Ranges", "bytes");
    }

    responseHeaders.set("Cache-Control", "private, no-store");
    responseHeaders.set("Vary", "Range");
    responseHeaders.set("X-Content-Type-Options", "nosniff");
    responseHeaders.set(MEDIA_STREAM_FINAL_URL_HEADER, finalUrl);

    request.signal?.removeEventListener("abort", onClientAbort);

    if (method === "HEAD") {
      cancelBodyQuietly(upstreamRes);
      return new Response(null, {
        status: upstreamRes.status,
        headers: responseHeaders,
      });
    }

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    });
  } catch (err) {
    request.signal?.removeEventListener("abort", onClientAbort);
    if (err instanceof StreamProxyError) {
      return jsonError(err.status, err.code, err.message);
    }
    return jsonError(502, "stream_proxy_error", "Media stream proxy encountered an unexpected error.");
  }
}
