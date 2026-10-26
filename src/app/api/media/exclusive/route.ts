import { NextRequest, NextResponse } from "next/server";
import { getExclusiveHome, searchExclusiveCatalogue, toPublicSearchPage } from "@/lib/media/exclusive";
import { MediaProviderError } from "@/lib/media/provider";
import type { MediaKind, MediaSort } from "@/lib/media/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SORTS: MediaSort[] = ["trending", "newest", "oldest", "rating", "title"];

/**
 * GET /api/media/exclusive
 *
 *   ?mode=home                          → the landing payload (spotlight, rails,
 *                                         genres, facets). One upstream read.
 *   ?q=&type=&genre=&year=&language=
 *    &sort=&page=&limit=                → a filtered, sorted, paginated page of
 *                                         the collection, with facets.
 *
 * Only the exclusive catalogue answers here: the main catalogue is never
 * imported, merged or consulted. Every item carries the same detail as any
 * other title, so its detail page, player and downloads work unchanged.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const rawType = sp.get("type");
  const kind: MediaKind | "all" = rawType === "movie" || rawType === "series" ? rawType : "all";

  const q = (sp.get("q") || "").slice(0, 120);
  const genre = (sp.get("genre") || "").slice(0, 60) || undefined;
  const year = (sp.get("year") || "").slice(0, 12) || undefined;
  const language = (sp.get("language") || "").slice(0, 24) || undefined;
  const rawSort = sp.get("sort") || "";
  const sort: MediaSort = (SORTS as string[]).includes(rawSort) ? (rawSort as MediaSort) : "trending";
  const rawPage = Number(sp.get("page") || 1);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const rawLimit = Number(sp.get("limit") || 24);
  const limit = Math.min(60, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 24));

  const explicitSearch = sp.get("mode") === "search";
  const hasFilters = Boolean(q || genre || year || language || rawSort || sp.get("page"));
  const wantsSearch = explicitSearch || hasFilters;

  try {
    if (!wantsSearch) {
      const home = await getExclusiveHome(kind);
      return NextResponse.json(home, {
        headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" },
      });
    }

    const result = await searchExclusiveCatalogue({ q, kind, genre, year, language, sort, page, limit });
    return NextResponse.json(toPublicSearchPage(result), {
      headers: {
        "cache-control": result.items.length
          ? "public, s-maxage=120, stale-while-revalidate=600"
          : "no-store",
      },
    });
  } catch (error) {
    const providerError = error instanceof MediaProviderError ? error : null;
    const status = providerError ? (providerError.status === 501 ? 503 : providerError.status) : 502;
    const code = providerError?.code || (status === 504 ? "timeout" : "network_error");
    console.error("[api/media/exclusive]", error);
    return NextResponse.json(
      {
        error:
          code === "timeout"
            ? "The exclusive collection took too long to answer."
            : "The exclusive collection is unavailable right now.",
        code,
      },
      { status, headers: { "cache-control": "no-store" } }
    );
  }
}
