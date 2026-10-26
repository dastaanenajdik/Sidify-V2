import { NextResponse } from "next/server";

/**
 * JSON 404 for API paths that do not exist.
 *
 * Without this catch-all, an unknown `/api/...` URL (a typo'd endpoint, a
 * trailing-slash variant like `/api/album/`, a stale client) fell through to
 * the app shell's HTML 404 page — ~45 KB of HTML that API consumers cannot
 * parse and that looks, to `fetchJson`-style clients, like a corrupt backend.
 *
 * Next routes more specific segments first, so every real route under
 * `/api/...` (including nested catch-alls such as
 * `/api/media/vault-stream/[...path]`) keeps winning over this one; only
 * genuinely unmatched paths land here.
 */

export const dynamic = "force-dynamic";

function notFound() {
  return NextResponse.json({ error: "Not found" }, { status: 404, headers: { "cache-control": "no-store" } });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
export const HEAD = notFound;
export const OPTIONS = notFound;
