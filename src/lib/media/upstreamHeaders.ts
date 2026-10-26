/**
 * Outbound header profiles for upstream calls.
 *
 * Two identities exist, and which one is correct depends on *who* is making the
 * call — not on a preference:
 *
 *   `mobile` (default)
 *     The catalogue's own Android client identity. This is the oracle the
 *     upstream API was reverse-engineered from, and the one its gateway
 *     expects: `x-client-info` claims an Android package, so the User-Agent
 *     has to agree. Mixing a desktop Chrome UA with an Android `x-client-info`
 *     is a *worse* fingerprint than either alone, which is why this is the
 *     default and why `browser` is opt-in.
 *
 *   `browser`
 *     A coherent desktop Chrome fingerprint (UA + `sec-ch-ua*` +
 *     `Accept-Language`). For upstreams that gate on "is this a real browser",
 *     not "is this the mobile app". Only use it when the target actually wants
 *     a browser — see `MEDIA_UPSTREAM_HEADER_PROFILE` in `.env.example`.
 *
 * Nothing here selects *where* the request comes from; that is the transport's
 * job (`exclusiveDirect.ts` for the browser path, `vaultClient.ts` for the
 * server path). A spoofed UA cannot turn a datacenter IP into a residential
 * one; only the direct path can.
 */

export type UpstreamHeaderProfile = "mobile" | "browser";

const CHROME_VERSION = "141";
const CHROME_MAJOR = "141";

/** A current desktop Chrome User-Agent. */
export const BROWSER_USER_AGENT = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_VERSION}.0.0.0 Safari/537.36`;

/** The rest of a coherent Chrome fingerprint, in the order Chrome sends it. */
export const BROWSER_FINGERPRINT_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ["accept-language", "en-US,en;q=0.9,hi;q=0.8"],
  ["sec-ch-ua", `"Chromium";v="${CHROME_MAJOR}", "Not?A_Brand";v="24", "Google Chrome";v="${CHROME_MAJOR}"`],
  ["sec-ch-ua-mobile", "?0"],
  ["sec-ch-ua-platform", '"Windows"'],
  ["sec-fetch-dest", "empty"],
  ["sec-fetch-mode", "cors"],
  ["sec-fetch-site", "same-site"],
];

/** Reads the configured profile. Anything unknown falls back to `mobile`. */
export function resolveHeaderProfile(raw: string | undefined | null): UpstreamHeaderProfile {
  return (raw || "").trim().toLowerCase() === "browser" ? "browser" : "mobile";
}

/** The profile this deployment is configured to use for server-side calls. */
export function configuredHeaderProfile(): UpstreamHeaderProfile {
  return resolveHeaderProfile(process.env.MEDIA_UPSTREAM_HEADER_PROFILE);
}

/**
 * Merges a profile's headers into a base map without overwriting explicit
 * values: an explicit header always wins.
 */
export function applyHeaderProfile(
  headers: Record<string, string>,
  profile: UpstreamHeaderProfile,
  userAgent: string
): Record<string, string> {
  const out: Record<string, string> = { ...headers };
  if (profile === "browser") {
    if (!out["user-agent"]) out["user-agent"] = BROWSER_USER_AGENT;
    for (const [name, value] of BROWSER_FINGERPRINT_HEADERS) {
      if (!out[name]) out[name] = value;
    }
    return out;
  }
  if (!out["user-agent"]) out["user-agent"] = userAgent;
  return out;
}
