/**
 * Resolver for Vault mirrors.
 *
 * A Vault mirror is either
 *   - a signed DASH manifest (`.../dash/<id>/index.mpd`) that needs the CDN's signed
 *     cookie, so it is served through this app's relay (the browser cannot send the
 *     cookie cross-origin), or
 *   - a direct file link, which the browser can fetch on its own.
 *
 * Server-only.
 */

import type { MirrorHop, MirrorResolveResult, ResolvedMirrorLink } from "./types";
import { sanitizePublicHttpsUrl } from "./safeFetch";
import { buildVaultStreamUrl, isAllowedVaultUpstreamHost } from "./vaultStream";

/** The CDN's signed-stream hosts. */
function isVaultCdnHost(hostname: string): boolean {
  return isAllowedVaultUpstreamHost(hostname);
}

function containerOf(url: string): string {
  const path = url.split("?")[0].split("#")[0];
  const match = path.match(/\.([a-z0-9]{2,4})$/i);
  return match ? match[1].toUpperCase() : "FILE";
}

/** The directory a manifest lives in — DASH segments sit next to it. */
function directoryOf(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/[^/]*$/, "");
    return `${parsed.origin}${path}`;
  } catch {
    return undefined;
  }
}

/**
 * Builds the resolve result for one Vault mirror.
 *
 * `origin` is the public origin of this app; the relay URL is built against it so the
 * player can load the manifest same-origin.
 */
export function resolveVaultMirror(
  shortUrl: string,
  options: { fileName?: string; label?: string; headers?: Array<[string, string]>; origin?: string } = {}
): MirrorResolveResult {
  const hops: MirrorHop[] = [];
  let parsed: URL;
  try {
    parsed = new URL(shortUrl);
  } catch {
    return {
      status: "error",
      links: [],
      reason: "malformed_response",
      message: "Malformed mirror URL.",
      hops,
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      status: "blocked",
      links: [],
      reason: "insecure_protocol",
      message: "Only https mirrors are supported.",
      hops,
    };
  }

  const container = containerOf(shortUrl);
  const isDash = container === "MPD" || parsed.pathname.includes("/dash/");
  const isDirectFile = container === "MP4" || container === "WEBM" || container === "MKV";

  // Signed manifests are relayed by this app, so their host must be one the relay is
  // allowed to reach. Direct files are fetched by the browser itself and only need a
  // safe public https URL.
  if (isDash && !isVaultCdnHost(parsed.hostname)) {
    return {
      status: "blocked",
      links: [],
      reason: "disallowed_host",
      message: "Mirror host is not on the allowlist.",
      hops,
    };
  }

  if (!isDash) {
    const safeUrl = sanitizePublicHttpsUrl(shortUrl);
    if (!safeUrl) {
      return {
        status: "blocked",
        links: [],
        reason: "disallowed_host",
        message: "Mirror URL is not a safe public https link.",
        hops,
      };
    }
  }

  const links: ResolvedMirrorLink[] = [];

  if (isDash) {
    // Signed manifests are relayed so the cookie and referer travel with every request.
    // The base directory is carried in the token so segment requests (which the player
    // makes relative to the manifest's base) resolve to the right upstream folder.
    const relayUrl = buildVaultStreamUrl(shortUrl, options.headers, options.origin, directoryOf(shortUrl));
    links.push({
      server: "Exclusive CDN",
      url: relayUrl,
      playable: true,
      streamType: "dash",
      delivery: "stream",
      container: "DASH",
      codecNote: "Adaptive stream relayed server-side so the signed CDN authorisation is preserved.",
    });
  } else if (isDirectFile) {
    links.push({
      server: "Exclusive CDN",
      url: shortUrl,
      playable: container === "MP4" || container === "WEBM",
      streamType: container === "WEBM" ? "webm" : container === "MP4" ? "mp4" : undefined,
      delivery: container === "MKV" ? "download" : "stream",
      container,
      unsupportedReason:
        container === "MKV"
          ? "MKV container — download or open in VLC / IINA / MPV."
          : undefined,
    });
  } else {
    links.push({
      server: "Exclusive CDN",
      url: shortUrl,
      playable: false,
      delivery: "download",
      container: container === "FILE" ? undefined : container,
      unsupportedReason: "Direct file link — download or open in an external player.",
    });
  }

  return {
    status: "resolved",
    links,
    hops,
  };
}

/**
 * True when the URL is *definitely* a mirror of the exclusive catalogue.
 *
 * Only the CDN families that serve signed DASH manifests are recognised here — the
 * catalogue's direct files live on a range of hosts, so they are identified by the
 * mirror's own `source` tag instead of by their URL.
 */
export function isVaultMirrorUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;

  const container = containerOf(url);
  const isDash = container === "MPD" || parsed.pathname.includes("/dash/");
  return isDash && isVaultCdnHost(parsed.hostname);
}
