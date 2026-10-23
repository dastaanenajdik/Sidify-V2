/**
 * Browser- and server-safe URL helpers for Sidify's same-origin media Range proxy
 * (`/api/media/stream`), allowing Shaka Player's MSE `NetworkingEngine` (`fetch` +
 * HTTP `Range`) to stream cross-origin MKV, DDP 5.1, MP4, HLS, and DASH mirrors
 * that do not emit `Access-Control-Allow-Origin` headers.
 *
 * Intentionally free of Node-only built-ins so client components can import it directly.
 */

export const MEDIA_STREAM_PROXY_PATH = "/api/media/stream";
export const MEDIA_STREAM_FINAL_URL_HEADER = "x-sidify-final-url";

const EXACT_ALLOWED_MEDIA_HOSTS = new Set([
  "archive.org",
  "www.archive.org",
  "pixeldrain.com",
  "www.pixeldrain.com",
  "pixeldrain.dev",
  "www.pixeldrain.dev",
  "drive.usercontent.google.com",
  "dl.dropboxusercontent.com",
  "commondatastorage.googleapis.com",
  "storage.googleapis.com",
]);

const ALLOWED_MEDIA_HOST_PATTERNS: RegExp[] = [
  // Cloudflare R2 & Workers (FSL Server, presigned object storage, CDN workers)
  /(^|\.)r2\.cloudflarestorage\.com$/i,
  /(^|\.)r2\.dev$/i,
  /(^|\.)workers\.dev$/i,
  // 4KHDHub / HubCloud / HubCDN / HubDrive / GPDL / Pixel / GDFlix / FSL mirror hosts
  /(^|\.)(hubcloud|hubdrive|hubcdn|hdstream4u|streamtape|gdflix|filepress|gofile|pixeldrain|fsl-cdn|fslcdn|gamerxyt|techyboy4u|vcloud|fastdl|busycdn|driveleech|driveseed|gdtot|vikingfile|buzzheavier|krakenfiles)\.[a-z0-9-]{2,24}$/i,
  /(^|\.)(gadgetsweb|cryptoinsights|carnewz|techymuthu|taazabull24|desiremovies|10desires|rogmovies|bolly4u|vegamovies|luxmovies|katmoviehd|uhdmovies|modlist|moviesmod|hdhub4u|4khdhub|greenmotors)\.[a-z0-9-]{2,24}$/i,
  // Google Drive / Google Photos / YouTube / GCS direct download CDNs (used by GPDL 10Gbps)
  /(^|\.)googleusercontent\.com$/i,
  /(^|\.)googlevideo\.com$/i,
  /(^|\.)googleapis\.com$/i,
  // Internet Archive public-domain media mirrors (`ia800501.us.archive.org`, etc.)
  /(^|\.)archive\.org$/i,
  // Common object storage & video delivery CDNs used behind mirror redirectors
  /(^|\.)backblazeb2\.com$/i,
  /(^|\.)b-cdn\.net$/i,
  /(^|\.)wasabisys\.com$/i,
  /(^|\.)digitaloceanspaces\.com$/i,
  /(^|\.)cloudfront\.net$/i,
  /(^|\.)akamaized\.net$/i,
  /(^|\.)fastly\.net$/i,
  /(^|\.)cdn77\.org$/i,
  /(^|\.)contabostorage\.com$/i,
  /(^|\.)your-objectstorage\.com$/i,
];

const UNSAFE_MEDIA_HOST_RE =
  /(^|\.)(localhost|local|internal|arpa|onion|invalid|test|example|t\.me|telegram\.org|telegram\.me|doubleclick\.net|googlesyndication\.com|popads\.net|exoclick\.com|adsterra\.com)$/i;

function normalizeHostname(rawHost: string): string {
  return rawHost.trim().toLowerCase().replace(/\.$/, "");
}

export function isUnsafeMediaHostname(rawHost: string): boolean {
  const host = normalizeHostname(rawHost);
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (UNSAFE_MEDIA_HOST_RE.test(host)) return true;
  // Reject raw IPv4 or bracketed IPv6 literals
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  if (host.startsWith("[") || host.includes(":")) return true;
  if (!host.includes(".")) return true;
  return false;
}

/**
 * Checks whether `rawHost` is an explicitly allowlisted media storage / mirror host
 * permitted at Hop 0 of `/api/media/stream`.
 */
export function isAllowedStreamEntryHost(
  rawHost: string,
  extraHosts?: Iterable<string>,
): boolean {
  const host = normalizeHostname(rawHost);
  if (isUnsafeMediaHostname(host)) return false;

  if (EXACT_ALLOWED_MEDIA_HOSTS.has(host)) return true;

  if (extraHosts) {
    for (const candidate of extraHosts) {
      const normalized = normalizeHostname(candidate);
      if (!normalized) continue;
      if (host === normalized || host.endsWith(`.${normalized}`)) {
        return true;
      }
    }
  }

  return ALLOWED_MEDIA_HOST_PATTERNS.some((re) => re.test(host));
}

/**
 * Builds an absolute (when `baseOrigin` is given) or root-relative `/api/media/stream` URL.
 * Shaka's `NetworkingEngine` requires a scheme (`http:` / `https:`) on request URIs, so
 * browser callers pass `window.location.origin` as `baseOrigin`.
 */
export function buildMediaStreamProxyUrl(targetUrl: string, baseOrigin?: string | null): string {
  const encoded = encodeURIComponent(targetUrl);
  const pathWithQuery = `${MEDIA_STREAM_PROXY_PATH}?url=${encoded}`;
  const cleanOrigin = (baseOrigin || "").trim().replace(/\/+$/, "");
  if (!cleanOrigin || cleanOrigin === "null") {
    return pathWithQuery;
  }
  return `${cleanOrigin}${pathWithQuery}`;
}

/**
 * Extracts the upstream `url` query parameter if `maybeProxyUrl` points at `/api/media/stream`.
 */
export function unwrapMediaStreamProxyUrl(maybeProxyUrl: string | null | undefined): string | null {
  if (!maybeProxyUrl) return null;
  try {
    const parsed = new URL(maybeProxyUrl, "https://sidify.local");
    if (parsed.pathname !== MEDIA_STREAM_PROXY_PATH) return null;
    const inner = parsed.searchParams.get("url");
    return inner && /^https:\/\//i.test(inner) ? inner : null;
  } catch {
    return null;
  }
}

/**
 * Determines whether a media request URI should be routed through same-origin `/api/media/stream`
 * when fetched via `fetch()` / Shaka `NetworkingEngine` in a browser with `currentOrigin`.
 */
export function shouldProxyCrossOriginMediaUrl(
  targetUrl: string,
  currentOrigin?: string | null,
  extraHosts?: Iterable<string>,
): boolean {
  if (!targetUrl || !currentOrigin || currentOrigin === "null") return false;
  if (/^(blob:|data:|about:)/i.test(targetUrl)) return false;
  if (unwrapMediaStreamProxyUrl(targetUrl)) return false;

  let parsed: URL;
  try {
    parsed = new URL(targetUrl, currentOrigin);
  } catch {
    return false;
  }

  // Same-origin URLs never need CORS proxying
  if (parsed.origin === currentOrigin) return false;
  if (parsed.protocol !== "https:") return false;
  if (parsed.port !== "" && parsed.port !== "443") return false;
  if (parsed.username || parsed.password) return false;

  // Reject known Telegram redirectors immediately
  if (/\/tg\/go\b/i.test(parsed.pathname)) return false;

  return isAllowedStreamEntryHost(parsed.hostname, extraHosts);
}
