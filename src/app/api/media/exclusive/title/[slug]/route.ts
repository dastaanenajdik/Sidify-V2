import { NextRequest, NextResponse } from "next/server";
import { getExclusiveTitle } from "@/lib/media/exclusive";
import { MediaProviderError } from "@/lib/media/provider";
import type { MediaKind } from "@/lib/media/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/media/exclusive/title/<slug>?type=movie|series
 *
 * Everything the exclusive player and the title page need in one round trip:
 * metadata, cast, seasons, playback sources and the title's own
 * recommendations. The catalogues' own detail route is not used here because
 * the exclusive page must not depend on the main catalogue's provider.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const decoded = decodeURIComponent(slug || "");
  if (!decoded.trim()) {
    return NextResponse.json({ error: "Missing title slug.", code: "missing_slug" }, { status: 400 });
  }

  const rawType = req.nextUrl.searchParams.get("type");
  const kind: MediaKind | undefined = rawType === "movie" || rawType === "series" ? rawType : undefined;

  try {
    const payload = await getExclusiveTitle(decoded, kind);
    if (!payload) {
      return NextResponse.json({ error: "Title not found in this collection.", code: "not_found" }, { status: 404 });
    }
    return NextResponse.json(payload, {
      headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" },
    });
  } catch (error) {
    const providerError = error instanceof MediaProviderError ? error : null;
    const status = providerError ? (providerError.status === 501 ? 503 : providerError.status) : 502;
    const code = providerError?.code || "network_error";
    console.error("[api/media/exclusive/title]", error);
    return NextResponse.json(
      { error: "Could not load this exclusive title.", code },
      { status, headers: { "cache-control": "no-store" } }
    );
  }
}
