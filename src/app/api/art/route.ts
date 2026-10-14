import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/art?u={image url}
 *
 * Same-origin copy of a (small) artwork rendition, so the browser can read its
 * pixels for the colour palette without tripping canvas CORS rules. Only the
 * image CDNs the catalogue actually uses are allowed through.
 */

export const runtime = "nodejs";

const ALLOWED = [
  /^i\d?\.ytimg\.com$/,
  /^lh\d\.googleusercontent\.com$/,
  /^yt\d\.ggpht\.com$/,
  /^yt\d\.googleusercontent\.com$/,
  /^is\d-ssl\.mzstatic\.com$/,
];

const MAX_BYTES = 2_000_000;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("u") || "";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return NextResponse.json({ error: "bad url" }, { status: 400 });
  }
  if (url.protocol !== "https:" || !ALLOWED.some((re) => re.test(url.hostname))) {
    return NextResponse.json({ error: "host not allowed" }, { status: 400 });
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const upstream = await fetch(url, { signal: ctrl.signal, headers: { "user-agent": "Mozilla/5.0" } });
    const type = upstream.headers.get("content-type") || "";
    if (!upstream.ok || !type.startsWith("image/")) {
      return NextResponse.json({ error: "upstream" }, { status: 502 });
    }
    const buf = await upstream.arrayBuffer();
    if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "too large" }, { status: 413 });
    return new NextResponse(buf, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=604800",
        "access-control-allow-origin": "*",
      },
    });
  } catch {
    return NextResponse.json({ error: "fetch failed" }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}
