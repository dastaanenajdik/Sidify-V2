import { NextRequest, NextResponse } from "next/server";
import { MediaProviderError } from "@/lib/media/provider";
import { browseMedia } from "@/lib/media/service";
import type { MediaKind, MediaQuery, MediaSort } from "@/lib/media/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SORTS: MediaSort[] = ["trending", "newest", "oldest", "rating", "title"];

/**
 * GET /api/media/browse?type=movie|series&q=&genre=&year=&language=&sort=&page=
 *
 * One response carries everything the browse page needs: the filtered page, the
 * featured title, the rails and the filter facets.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind: MediaKind = sp.get("type") === "series" ? "series" : "movie";
  const sort = sp.get("sort");
  const page = Number(sp.get("page") || 1);

  const query: MediaQuery = {
    q: sp.get("q") || undefined,
    genre: sp.get("genre") || undefined,
    year: sp.get("year") || undefined,
    language: sp.get("language") || undefined,
    sort: sort && (SORTS as string[]).includes(sort) ? (sort as MediaSort) : "trending",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };

  try {
    const data = await browseMedia(kind, query);
    return NextResponse.json(data, {
      headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" },
    });
  } catch (error) {
    const providerError = error instanceof MediaProviderError ? error : null;
    const status = providerError ? (providerError.status === 501 ? 503 : providerError.status) : 502;
    const code = providerError?.code || (status === 504 ? "timeout" : "network_error");
    console.error("[api/media/browse]", error);
    return NextResponse.json(
      {
        error:
          code === "timeout"
            ? "Upstream catalogue request timed out."
            : code === "captcha" || code === "access_control"
              ? "Upstream catalogue blocked automated access (challenge/restriction)."
              : providerError
                ? providerError.message
                : "Could not load the media catalogue.",
        code,
        provider: providerError?.provider,
      },
      { status, headers: { "cache-control": "no-store" } }
    );
  }
}
