/**
 * Server-side multi-hop mirror resolver & media playability classifier.
 *
 * Scope & technical boundaries:
 *   1. Inspects public URL encoding (`s('o', '...')` Base64 + ROT13 + JSON wrapper)
 *      and normal public HTTPS links/redirects across allowlisted mirror hosts only.
 *   2. Does NOT bypass CAPTCHA, Turnstile, login walls, paywalls or DRM. Any hop gated
 *      by an access barrier stops immediately with `status: "blocked"` and surfaces a
 *      validated external fallback link if available.
 *   3. Strictly separates browser-playable streams (`mp4`, `webm`, `hls` `.m3u8`) from
 *      non-playable containers (`.mkv`, `.zip`, `.avi` or unverified host links). `.mkv`
 *      and archive downloads are NEVER flagged `playable: true`.
 */

import * as cheerio from "cheerio";
import {
  SafeFetchError,
  assertSafeUrl,
  safeFetchHtml,
  sanitizePublicHttpsUrl,
  type DnsLookupFn,
} from "./safeFetch";
import { detectContainer, extractReleaseTags } from "./hubScraper";
import type { MirrorHop, MirrorResolveResult, ResolvedMirrorLink } from "./types";

export interface ResolveMirrorInput {
  shortUrl: string;
  fileName?: string;
  label?: string;
}

export interface ResolveMirrorDeps {
  fetchImpl?: typeof fetch;
  dnsLookup?: DnsLookupFn;
  timeoutMs?: number;
  disableCache?: boolean;
}

interface CacheEntry {
  value: MirrorResolveResult;
  expiresAt: number;
}

const RESOLVE_CACHE_TTL_MS = 10 * 60 * 1000;
const resolveCache = new Map<string, CacheEntry>();

export function clearMirrorResolveCache(): void {
  resolveCache.clear();
}

/* --------------------- encoding inspection (ROT13/Base64) ---------------- */

export function rot13(input: string): string {
  return String(input || "").replace(/[a-zA-Z]/g, (char) => {
    const base = char <= "Z" ? 90 : 122;
    const code = char.charCodeAt(0) + 13;
    return String.fromCharCode(base >= code ? code : code - 26);
  });
}

export function decodeBase64(input: string): string | null {
  if (!input || typeof input !== "string") return null;
  const cleaned = input.trim().replace(/\s+/g, "");
  if (!cleaned || cleaned.length > 16_384 || !/^[A-Za-z0-9+/=_-]+$/.test(cleaned)) return null;
  const normalized = cleaned.replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Buffer.from(normalized, "base64").toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Inspect the public `s('o', '<encoded>')` redirect token embedded in short-link HTML,
 * or standard `<meta http-equiv="refresh">` fallback. Never executes script code.
 */
export function decodeRedirectHtml(html: string, currentUrl?: string): string | null {
  if (!html || typeof html !== "string") return null;

  const tokenMatch = html.match(/\bs\(\s*['"]o['"]\s*,\s*['"]([A-Za-z0-9+/=_-]{16,})['"]/);
  if (tokenMatch?.[1]) {
    try {
      const step1 = decodeBase64(tokenMatch[1]);
      const step2 = step1 ? decodeBase64(step1) : null;
      const step3 = step2 ? rot13(step2) : null;
      const step4 = step3 ? decodeBase64(step3) : null;
      if (step4) {
        const parsed = JSON.parse(step4) as { o?: unknown };
        if (parsed && typeof parsed.o === "string") {
          const decodedUrl = decodeBase64(parsed.o)?.trim();
          const safe = sanitizePublicHttpsUrl(decodedUrl, currentUrl);
          if (safe) return safe;
        }
      }
    } catch {
      /* fall through to meta refresh check */
    }
  }

  const metaRefresh = html.match(
    /<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^"']*url=([^"'>\s]+)["']/i
  );
  if (metaRefresh?.[1]) {
    return sanitizePublicHttpsUrl(metaRefresh[1], currentUrl);
  }

  return null;
}

/** Helper used in tests to construct realistic encoded short-link HTML fixtures. */
export function encodeRedirectTokenForTest(targetUrl: string): string {
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  const json = JSON.stringify({ o: b64(targetUrl) });
  return b64(b64(rot13(b64(json))));
}

/* --------------------- browser playability classification ---------------- */

export interface SourceClassificationInput {
  url: string;
  server: string;
  fileName?: string;
  label?: string;
  isLandingPage?: boolean;
}

export function classifyResolvedSource(input: SourceClassificationInput): ResolvedMirrorLink | null {
  const safeUrl = sanitizePublicHttpsUrl(input.url);
  if (!safeUrl) return null;

  const metaText = `${input.fileName || ""} ${input.label || ""}`;
  const container = detectContainer(input.fileName || "", safeUrl);
  const tags = extractReleaseTags(metaText);
  const hevcWarning = tags.includes("HEVC") || tags.includes("AV1")
    ? `${tags.filter((t) => t === "HEVC" || t === "AV1" || t === "DV" || t === "HDR10+" || t === "HDR").join(" / ")} codec support depends on device/browser.`
    : undefined;

  if (input.isLandingPage) {
    return {
      server: input.server,
      url: safeUrl,
      playable: false,
      delivery: "external",
      container: container || "PAGE",
      unsupportedReason: "Host landing page — open externally to choose a download server.",
    };
  }

  // Archive packs (.zip, .rar, .7z) are never playable media streams
  if (container === "ZIP" || container === "RAR" || container === "7Z") {
    return {
      server: input.server,
      url: safeUrl,
      playable: false,
      delivery: "download",
      container,
      unsupportedReason: `Season archive (${container}) — download only; cannot play in browser.`,
    };
  }

  // Matroska / AVI / TS containers: never claim browser `<video>` support (even when URL has no extension!)
  if (container === "MKV" || container === "AVI" || container === "TS") {
    return {
      server: input.server,
      url: safeUrl,
      playable: false,
      delivery: "download",
      container,
      codecNote: hevcWarning,
      unsupportedReason: `${container} container with multi-track/Dolby audio is not reliably supported by HTML5 video players — download or open in VLC / IINA / MPV.`,
    };
  }

  // Candidate browser stream types: HLS manifest (.m3u8), MP4 (.mp4), WebM (.webm).
  // Note: `.m3u8` identifies an HLS manifest candidate; actual browser playback requires
  // runtime native Apple HLS or MSE (`hls.js`), permissive CORS on segments, and decodable codecs.
  if (container === "M3U8" || /\.m3u8(?:$|[?#])/i.test(safeUrl)) {
    const hlsNote =
      "HLS manifest candidate — browser playback requires native HLS or MSE (hls.js), permissive CORS on segments, and browser-supported codecs.";
    return {
      server: input.server,
      url: safeUrl,
      playable: true,
      streamType: "hls",
      delivery: "stream",
      container: "HLS",
      codecNote: hevcWarning ? `${hevcWarning} ${hlsNote}` : hlsNote,
    };
  }

  if (container === "MP4" || /\.mp4(?:$|[?#])/i.test(safeUrl)) {
    return {
      server: input.server,
      url: safeUrl,
      playable: true,
      streamType: "mp4",
      delivery: "stream",
      container: "MP4",
      codecNote: hevcWarning,
    };
  }

  if (container === "WEBM" || /\.webm(?:$|[?#])/i.test(safeUrl)) {
    return {
      server: input.server,
      url: safeUrl,
      playable: true,
      streamType: "webm",
      delivery: "stream",
      container: "WEBM",
      codecNote: hevcWarning,
    };
  }

  // Container could not be verified as MP4/WebM/HLS — expose honestly as direct download
  return {
    server: input.server,
    url: safeUrl,
    playable: false,
    delivery: "download",
    container: container || "FILE",
    codecNote: hevcWarning,
    unsupportedReason: "Direct file link (unverified browser container) — use direct download or an external player.",
  };
}

/* --------------------- generator HTML link extraction -------------------- */

export function parseGeneratorLinks(
  html: string,
  context: { fileName?: string; label?: string; baseUrl?: string }
): ResolvedMirrorLink[] {
  if (!html) return [];
  const $ = cheerio.load(html);
  const out: ResolvedMirrorLink[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_idx, el) => {
    const rawHref = $(el).attr("href") || "";
    const text = ($(el).text() || "").replace(/\s+/g, " ").trim();
    const candidate = sanitizePublicHttpsUrl(rawHref, context.baseUrl);
    if (!candidate) return;

    // Skip Telegram links and raw .zip buttons on generator pages unless user opened a pack
    if (/t\.me|telegram/i.test(candidate)) return;
    if (/\.zip(?:$|[?#])/i.test(candidate) && !/\.zip\b/i.test(context.fileName || "")) return;

    let finalUrl = candidate;
    let serverLabel = "";

    const pdMatch = candidate.match(/pixeldrain\.(?:com|dev)\/u\/([A-Za-z0-9_-]+)/i);
    if (pdMatch || /pixelserver|pixeldrain/i.test(text)) {
      if (pdMatch) {
        finalUrl = `https://pixeldrain.com/api/file/${pdMatch[1]}?download`;
      }
      serverLabel = "PixelServer";
    } else if (/\bfsl\b/i.test(text) || /r2\.cloudflarestorage\.com|r2\.dev/i.test(candidate)) {
      serverLabel = "FSL Server";
    } else if (/download|10gbps|direct/i.test(text)) {
      serverLabel = text.slice(0, 48);
    } else {
      return;
    }

    if (seen.has(finalUrl)) return;
    seen.add(finalUrl);

    const classified = classifyResolvedSource({
      url: finalUrl,
      server: serverLabel,
      fileName: context.fileName,
      label: context.label,
    });
    if (classified) out.push(classified);
  });

  return out;
}

/* ----------------------- full multi-hop resolver ------------------------- */

export async function resolveHubMirror(
  input: ResolveMirrorInput,
  deps: ResolveMirrorDeps = {}
): Promise<MirrorResolveResult> {
  const hops: MirrorHop[] = [];
  const cacheKey = `${input.shortUrl}|${input.fileName || ""}|${input.label || ""}`;

  if (!deps.disableCache) {
    const hit = resolveCache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value;
  }

  // Validate initial shortUrl strictly before making any outbound connection
  let validatedEntryUrl: URL;
  try {
    validatedEntryUrl = await assertSafeUrl(input.shortUrl, {
      purpose: "mirror",
      dnsLookup: deps.dnsLookup,
    });
  } catch (err) {
    const sf = err instanceof SafeFetchError ? err : null;
    return {
      status: "blocked",
      links: [],
      reason: sf?.code || "disallowed_host",
      message: sf?.message || "Invalid mirror URL.",
      hops: [
        {
          step: "validate",
          host: safeHost(input.shortUrl),
          status: "blocked",
          reason: sf?.code || "disallowed_host",
          detail: sf?.message,
        },
      ],
    };
  }

  let currentUrl = validatedEntryUrl.toString();
  let lastValidatedExternalUrl = currentUrl;

  const fetchStep = async (step: string, url: string, referer?: string) => {
    const host = safeHost(url);
    const res = await safeFetchHtml(url, {
      purpose: "mirror",
      referer,
      timeoutMs: deps.timeoutMs,
      fetchImpl: deps.fetchImpl,
      dnsLookup: deps.dnsLookup,
    });
    if (res.redirectChain.length > 1) {
      hops.push({
        step: `${step}:http-redirect`,
        host: safeHost(res.url),
        status: "redirect",
        httpStatus: res.status,
        detail: `${host} → ${safeHost(res.url)}`,
      });
    } else {
      hops.push({
        step,
        host: safeHost(res.url),
        status: "ok",
        httpStatus: res.status,
      });
    }
    return res;
  };

  try {
    // Hop 1: Short-link redirect wrapper (e.g. greenmotors.club -> greenmotors.cc)
    if (!/hubdrive\.|hubcloud\.|pixeldrain\./i.test(currentUrl)) {
      const gmRes = await fetchStep("shortlink", currentUrl);
      lastValidatedExternalUrl = gmRes.url;
      const decoded = decodeRedirectHtml(gmRes.text, gmRes.url);
      if (decoded) {
        const verifiedDecoded = await assertSafeUrl(decoded, {
          purpose: "mirror",
          dnsLookup: deps.dnsLookup,
        });
        currentUrl = verifiedDecoded.toString();
        lastValidatedExternalUrl = currentUrl;
      } else {
        currentUrl = gmRes.url;
      }
    }

    // Direct PixelDrain short link shortcut if the shortener resolved straight to PixelDrain
    if (/pixeldrain\.(?:com|dev)\/u\/([A-Za-z0-9_-]+)/i.test(currentUrl)) {
      const id = currentUrl.match(/\/u\/([A-Za-z0-9_-]+)/i)![1];
      const direct = classifyResolvedSource({
        url: `https://pixeldrain.com/api/file/${id}?download`,
        server: "PixelServer",
        fileName: input.fileName,
        label: input.label,
      });
      const result: MirrorResolveResult = {
        status: "resolved",
        links: direct ? [direct] : [],
        externalFallbackUrl: currentUrl,
        hops,
      };
      if (!deps.disableCache) {
        resolveCache.set(cacheKey, { value: result, expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS });
      }
      return result;
    }

    // Hop 2: HubDrive intermediate page -> extract HubCloud URL
    if (/hubdrive\./i.test(currentUrl)) {
      const hdRes = await fetchStep("hubdrive", currentUrl, lastValidatedExternalUrl);
      lastValidatedExternalUrl = hdRes.url;
      const $hd = cheerio.load(hdRes.text);
      let hubCloudCandidate: string | null = null;

      $hd("a[href]").each((_idx, el) => {
        if (hubCloudCandidate) return;
        const href = sanitizePublicHttpsUrl($hd(el).attr("href"), hdRes.url);
        if (href && /hubcloud\./i.test(href)) {
          hubCloudCandidate = href;
        }
      });

      if (!hubCloudCandidate) {
        const rawMatch = hdRes.text.match(/href=["'](https?:\/\/[^"']*hubcloud\.[^"']*)["']/i);
        hubCloudCandidate = sanitizePublicHttpsUrl(rawMatch?.[1], hdRes.url);
      }

      if (!hubCloudCandidate) {
        const fallbackLink = classifyResolvedSource({
          url: hdRes.url,
          server: "HubDrive Page",
          fileName: input.fileName,
          label: input.label,
          isLandingPage: true,
        });
        return {
          status: "partial",
          links: fallbackLink ? [fallbackLink] : [],
          externalFallbackUrl: hdRes.url,
          message: "No nested HubCloud link was found on the HubDrive page; open HubDrive directly.",
          hops,
        };
      }

      const verifiedHc = await assertSafeUrl(hubCloudCandidate, {
        purpose: "mirror",
        dnsLookup: deps.dnsLookup,
      });
      currentUrl = verifiedHc.toString();
      lastValidatedExternalUrl = currentUrl;
    }

    // Hop 3: HubCloud landing page -> generator link
    const hcRes = await fetchStep("hubcloud", currentUrl, lastValidatedExternalUrl);
    lastValidatedExternalUrl = hcRes.url;

    const varUrlMatch = hcRes.text.match(/(?:var|let|const)\s+url\s*=\s*['"]([^'"]+)['"]/i)?.[1];
    const $hc = cheerio.load(hcRes.text);
    const buttonHref = $hc("#download").attr("href") || $hc("a[id='download']").attr("href");
    const rawGenerator = sanitizePublicHttpsUrl(varUrlMatch || buttonHref, hcRes.url);

    if (!rawGenerator) {
      // Check if direct download anchors already sit on the HubCloud page itself
      const inlineLinks = parseGeneratorLinks(hcRes.text, {
        fileName: input.fileName,
        label: input.label,
        baseUrl: hcRes.url,
      });
      if (inlineLinks.length > 0) {
        const result: MirrorResolveResult = {
          status: "resolved",
          links: inlineLinks,
          externalFallbackUrl: hcRes.url,
          hops,
        };
        if (!deps.disableCache) {
          resolveCache.set(cacheKey, { value: result, expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS });
        }
        return result;
      }

      const fallbackLink = classifyResolvedSource({
        url: hcRes.url,
        server: "HubCloud Page",
        fileName: input.fileName,
        label: input.label,
        isLandingPage: true,
      });
      return {
        status: "partial",
        links: fallbackLink ? [fallbackLink] : [],
        externalFallbackUrl: hcRes.url,
        message: "Generator token was not found on HubCloud; open the validated HubCloud page directly.",
        hops,
      };
    }

    // Hop 4: Generator page -> final server links
    const verifiedGen = await assertSafeUrl(rawGenerator, {
      purpose: "mirror",
      dnsLookup: deps.dnsLookup,
    });
    const genRes = await fetchStep("generator", verifiedGen.toString(), hcRes.url);

    const directLinks = parseGeneratorLinks(genRes.text, {
      fileName: input.fileName,
      label: input.label,
      baseUrl: genRes.url,
    });

    if (!directLinks.length) {
      const fallbackLink = classifyResolvedSource({
        url: hcRes.url,
        server: "HubCloud Page",
        fileName: input.fileName,
        label: input.label,
        isLandingPage: true,
      });
      return {
        status: "partial",
        links: fallbackLink ? [fallbackLink] : [],
        externalFallbackUrl: hcRes.url,
        message: "Generator page returned no recognized server links; open the HubCloud page directly.",
        hops,
      };
    }

    const result: MirrorResolveResult = {
      status: "resolved",
      links: directLinks,
      externalFallbackUrl: hcRes.url,
      hops,
    };
    if (!deps.disableCache) {
      resolveCache.set(cacheKey, { value: result, expiresAt: Date.now() + RESOLVE_CACHE_TTL_MS });
    }
    return result;
  } catch (err) {
    const sf = err instanceof SafeFetchError ? err : null;
    const reason = sf?.code || "network_error";
    const isBarrier =
      reason === "captcha" ||
      reason === "access_control" ||
      reason === "disallowed_host" ||
      reason === "blocked_ip" ||
      reason === "insecure_protocol";

    hops.push({
      step: "failed-hop",
      host: sf?.host || safeHost(currentUrl),
      status: isBarrier ? "blocked" : "error",
      reason,
      detail: sf?.message || (err as Error)?.message,
    });

    return {
      status: isBarrier ? "blocked" : "error",
      links: [],
      externalFallbackUrl: lastValidatedExternalUrl,
      reason,
      message: sf?.message || "Mirror resolution failed due to an upstream network error.",
      hops,
    };
  }
}

function safeHost(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "invalid-url";
  }
}
