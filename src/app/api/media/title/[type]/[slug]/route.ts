import { NextResponse } from "next/server";
import { MediaProviderError } from "@/lib/media/provider";
import { getMediaDetail } from "@/lib/media/service";
import type { MediaKind } from "@/lib/media/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/media/title/movie|series/<slug> — detail, seasons, releases, related, playback. */
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
    const providerError = error instanceof MediaProviderError ? error : null;
    const status = providerError ? (providerError.status === 501 ? 503 : providerError.status) : 502;
    const code = providerError?.code || (status === 504 ? "timeout" : "network_error");
    console.error("[api/media/title]", error);
    return NextResponse.json(
      {
        error: providerError?.message || "Could not load this title.",
        code,
      },
      { status, headers: { "cache-control": "no-store" } }
    );
  }
}
