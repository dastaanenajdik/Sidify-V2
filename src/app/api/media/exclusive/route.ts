import { NextRequest, NextResponse } from "next/server";
import { MediaProviderError } from "@/lib/media/provider";
import { searchExclusive } from "@/lib/media/service";
import type { MediaKind } from "@/lib/media/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Run this route from Mumbai rather than the default US-East.
 *
 * The upstream is an Indian/South-East-Asian service and its hosts answer
 * `440 ServiceNotAvailable` to callers it will not serve — including the login.
 * A US datacentre address is the likeliest caller it declines, and the client
 * identity we present (`sp_code` 40401, an Indian carrier) is an Indian one, so
 * the request should leave from that region too.
 *
 * Only this route is pinned: the rest of the site has no reason to move, and on
 * a single-region plan this is the smallest change that can be tried.
 */
export const preferredRegion = ["bom1"];

/**
 * GET /api/media/exclusive?q=&type=movie|series|all&limit=
 *
 * The exclusive collection on its own: only the titles of the exclusive catalogue
 * ever appear here — never the main catalogue's.
 *
 * Results carry the same detail as any other title, so the detail pages, the player
 * and the download picker work exactly as they do elsewhere.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const raw = sp.get("type");
  const kind: MediaKind | "all" = raw === "movie" || raw === "series" ? raw : "all";
  const limit = Math.min(40, Math.max(1, Number(sp.get("limit") || 24)));
  const query = (sp.get("q") || "").slice(0, 120);

  try {
    const data = await searchExclusive(query, kind, limit);
    return NextResponse.json(data, {
      headers: { "cache-control": "public, s-maxage=120, stale-while-revalidate=600" },
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
