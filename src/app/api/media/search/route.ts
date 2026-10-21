import { NextRequest, NextResponse } from "next/server";
import { MediaProviderError } from "@/lib/media/provider";
import { searchMedia } from "@/lib/media/service";
import type { MediaKind } from "@/lib/media/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/media/search?q=&type=movie|series|all&limit= */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const raw = sp.get("type");
  const kind: MediaKind | "all" = raw === "movie" || raw === "series" ? raw : "all";
  const limit = Math.min(40, Math.max(1, Number(sp.get("limit") || 24)));
  const query = (sp.get("q") || "").slice(0, 120);

  try {
    const data = await searchMedia(query, kind, limit);
    return NextResponse.json(data, {
      headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=600" },
    });
  } catch (error) {
    const status = error instanceof MediaProviderError ? (error.status === 501 ? 503 : error.status) : 502;
    console.error("[api/media/search]", error);
    return NextResponse.json({ error: "Search is unavailable right now." }, { status, headers: { "cache-control": "no-store" } });
  }
}
