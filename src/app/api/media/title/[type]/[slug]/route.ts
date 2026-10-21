import { NextResponse } from "next/server";
import { MediaProviderError } from "@/lib/media/provider";
import { getMediaDetail } from "@/lib/media/service";
import type { MediaKind } from "@/lib/media/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/media/title/movie|series/<slug> — detail, seasons, related, authorized playback. */
export async function GET(_req: Request, { params }: { params: Promise<{ type: string; slug: string }> }) {
  const { type, slug } = await params;
  if (type !== "movie" && type !== "series") {
    return NextResponse.json({ error: "Unknown media type" }, { status: 400 });
  }
  const kind = type as MediaKind;

  try {
    const detail = await getMediaDetail(kind, decodeURIComponent(slug));
    if (!detail) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(detail, {
      headers: { "cache-control": "public, s-maxage=600, stale-while-revalidate=3600" },
    });
  } catch (error) {
    const status = error instanceof MediaProviderError ? (error.status === 501 ? 503 : error.status) : 502;
    console.error("[api/media/title]", error);
    return NextResponse.json({ error: "Could not load this title." }, { status, headers: { "cache-control": "no-store" } });
  }
}
