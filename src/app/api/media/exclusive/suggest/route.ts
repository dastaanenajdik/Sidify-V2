import { NextRequest, NextResponse } from "next/server";
import { suggestExclusive } from "@/lib/media/exclusive";
import { MediaProviderError } from "@/lib/media/provider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/media/exclusive/suggest?q=&limit=
 *
 * Typeahead for the exclusive search field. Answers from the cached collection
 * listing first, so the common case costs no upstream round trip.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").slice(0, 120);
  const rawLimit = Number(sp.get("limit") || 8);
  const limit = Math.min(12, Math.max(1, Number.isFinite(rawLimit) ? Math.floor(rawLimit) : 8));

  if (q.trim().length < 2) {
    return NextResponse.json(
      { query: q.trim(), items: [], tookMs: 0 },
      { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=1800" } }
    );
  }

  try {
    const payload = await suggestExclusive(q, limit);
    return NextResponse.json(payload, {
      headers: { "cache-control": "public, s-maxage=60, stale-while-revalidate=300" },
    });
  } catch (error) {
    const providerError = error instanceof MediaProviderError ? error : null;
    const status = providerError ? (providerError.status === 501 ? 503 : providerError.status) : 502;
    console.error("[api/media/exclusive/suggest]", error);
    return NextResponse.json(
      { error: "Suggestions are unavailable right now.", code: providerError?.code || "network_error" },
      { status, headers: { "cache-control": "no-store" } }
    );
  }
}
