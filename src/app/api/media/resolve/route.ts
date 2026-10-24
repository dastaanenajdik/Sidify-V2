import { NextRequest, NextResponse } from "next/server";
import { resolveHubMirror } from "@/lib/media/hubResolver";
import { isVaultMirrorUrl, resolveVaultMirror } from "@/lib/media/vaultResolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BODY_BYTES = 4_096;

/** Only these headers may be relayed upstream, and only as `[name, value]` pairs. */
const RELAYABLE_HEADER_NAMES = new Set(["cookie", "referer", "user-agent"]);

/**
 * Keeps only the headers the relay is allowed to forward. Anything else (a caller's
 * `Authorization`, `x-forwarded-for`, cookies of this app, …) is dropped.
 */
function sanitizeRelayHeaders(raw: unknown): Array<[string, string]> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: Array<[string, string]> = [];
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [name, value] = entry;
    if (typeof name !== "string" || typeof value !== "string") continue;
    if (!RELAYABLE_HEADER_NAMES.has(name.toLowerCase())) continue;
    out.push([name, value.slice(0, 4096)]);
    if (out.length >= 8) break;
  }
  return out.length ? out : undefined;
}

/**
 * POST /api/media/resolve   (JSON: { url, fileName?, label?, refresh? })
 *
 * Resolves a validated mirror short-link across allowlisted hops into structured
 * stream / download / fallback links. Only small HTML pages are fetched here — media
 * files are never proxied or transcoded; the browser loads the resolved URL directly.
 * Never proxies arbitrary hosts, never forwards caller cookies or credentials, and never
 * claims `.mkv` or `.zip` files play in HTML5 video. `refresh: true` asks for one fresh
 * resolution when cached direct links stopped working (rate-limited by cache age).
 */
export async function POST(req: NextRequest) {
  const rawLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(rawLength) && rawLength > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request payload too large.", code: "malformed_response" },
      { status: 413, headers: { "cache-control": "no-store" } }
    );
  }

  let body: { url?: unknown; fileName?: unknown; label?: unknown; headers?: unknown; source?: unknown; refresh?: unknown };
  try {
    const text = await req.text();
    if (text.length > MAX_REQUEST_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request payload too large.", code: "malformed_response" },
        { status: 413, headers: { "cache-control": "no-store" } }
      );
    }
    body = JSON.parse(text) as { url?: unknown; fileName?: unknown; label?: unknown; headers?: unknown; source?: unknown; refresh?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body.", code: "malformed_response" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const shortUrl = typeof body.url === "string" ? body.url.trim().slice(0, 2048) : "";
  const fileName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 512) : undefined;
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 256) : undefined;
  const refresh = body.refresh === true;

  // Only the headers the relay is allowed to forward are accepted, and only in pairs.
  const headers = sanitizeRelayHeaders(body.headers);

  if (!shortUrl) {
    return NextResponse.json(
      { error: "Mirror URL is required.", code: "malformed_response" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  // Mirrors of the exclusive catalogue are resolved by the dedicated resolver: signed
  // manifests are relayed so their authorisation survives the hop to the browser. The
  // mirror says which catalogue it belongs to, so a direct file is never mistaken for
  // a multi-hop mirror of another catalogue.
  const isVault = body.source === "vault" || isVaultMirrorUrl(shortUrl);
  const result = isVault
    ? resolveVaultMirror(shortUrl, { fileName, label, headers, origin: req.nextUrl.origin })
    : await resolveHubMirror({ shortUrl, fileName, label }, { refresh });

  const httpStatus =
    result.status === "resolved" || result.status === "partial"
      ? 200
      : result.reason === "disallowed_host" || result.reason === "blocked_ip" || result.reason === "insecure_protocol"
        ? 403
        : result.reason === "timeout"
          ? 504
          : result.status === "blocked"
            ? 422
            : 502;

  return NextResponse.json(result, {
    status: httpStatus,
    headers: { "cache-control": "no-store" },
  });
}
