import { NextRequest, NextResponse } from "next/server";
import { resolveHubMirror } from "@/lib/media/hubResolver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BODY_BYTES = 4_096;

/**
 * POST /api/media/resolve
 *
 * Resolves a validated mirror short-link across allowlisted hops into structured
 * stream / download / fallback links. Never proxies arbitrary hosts, never forwards
 * caller cookies or credentials, and never claims `.mkv` or `.zip` files play in HTML5 video.
 */
export async function POST(req: NextRequest) {
  const rawLength = Number(req.headers.get("content-length") || 0);
  if (Number.isFinite(rawLength) && rawLength > MAX_REQUEST_BODY_BYTES) {
    return NextResponse.json(
      { error: "Request payload too large.", code: "malformed_response" },
      { status: 413, headers: { "cache-control": "no-store" } }
    );
  }

  let body: { url?: unknown; fileName?: unknown; label?: unknown };
  try {
    const text = await req.text();
    if (text.length > MAX_REQUEST_BODY_BYTES) {
      return NextResponse.json(
        { error: "Request payload too large.", code: "malformed_response" },
        { status: 413, headers: { "cache-control": "no-store" } }
      );
    }
    body = JSON.parse(text) as { url?: unknown; fileName?: unknown; label?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body.", code: "malformed_response" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const shortUrl = typeof body.url === "string" ? body.url.trim().slice(0, 2048) : "";
  const fileName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 512) : undefined;
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 256) : undefined;

  if (!shortUrl) {
    return NextResponse.json(
      { error: "Mirror URL is required.", code: "malformed_response" },
      { status: 400, headers: { "cache-control": "no-store" } }
    );
  }

  const result = await resolveHubMirror({ shortUrl, fileName, label });

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
