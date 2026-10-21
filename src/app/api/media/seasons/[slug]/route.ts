import { NextRequest, NextResponse } from "next/server";
import { MediaProviderError } from "@/lib/media/provider";
import { getSeasons } from "@/lib/media/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/media/seasons/<slug>?season=2
 *
 * Season metadata with that season's episodes. Real providers fetch this lazily so a
 * detail page never downloads every episode of a long-running series.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const seasonParam = req.nextUrl.searchParams.get("season");
  const seasonNumber = seasonParam === null ? undefined : Number(seasonParam);
  if (seasonNumber !== undefined && (!Number.isFinite(seasonNumber) || seasonNumber < 0)) {
    return NextResponse.json({ error: "Invalid season" }, { status: 400 });
  }

  try {
    const seasons = await getSeasons("series", decodeURIComponent(slug), seasonNumber);
    return NextResponse.json(
      { seasons },
      { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (error) {
    const status = error instanceof MediaProviderError ? (error.status === 501 ? 503 : error.status) : 502;
    console.error("[api/media/seasons]", error);
    return NextResponse.json({ error: "Could not load episodes." }, { status, headers: { "cache-control": "no-store" } });
  }
}
