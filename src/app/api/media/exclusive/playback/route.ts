import { NextRequest, NextResponse } from "next/server";
import { callerKey, TokenBucketLimiter } from "@/lib/media/rateLimit";
import { getVaultProvider, isVaultSlug } from "@/lib/media/vaultProvider";
import { MediaProviderError } from "@/lib/media/provider";
import type { MediaKind, PlaybackSource } from "@/lib/media/types";
import { readJsonBody } from "@/lib/readJsonBody";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/media/exclusive/playback   { slug, type? }
 *
 * Browser-playable sources for one exclusive title.
 *
 * The signed DASH manifest cannot be built in the browser: the CDN authorises it
 * with a signed cookie that only this server can attach, so the manifest URL is
 * wrapped in the same-origin relay token here. The caller supplies **a slug**,
 * never a URL — the upstream address and its headers stay server-side, exactly
 * as on the relay path.
 *
 * This exists so the *direct* transport (browser → upstream) can still play:
 * its metadata comes from the user's own connection, and only this small step
 * needs the server.
 */

const limiter = new TokenBucketLimiter({ capacity: 60, refillPerSecond: 1 });

export async function POST(req: NextRequest) {
  const limited = limiter.take(callerKey(req.headers));
  if (!limited.allowed) {
    return NextResponse.json(
      { error: "Too many playback requests. Try again shortly.", code: "rate_limited" },
      { status: 429, headers: { "cache-control": "no-store", "retry-after": String(Math.ceil(limited.retryAfterMs / 1000)) } }
    );
  }

  const body = await readJsonBody<{ slug?: unknown; type?: unknown }>(req);
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  if (!slug || slug.length > 200 || !isVaultSlug(slug)) {
    return NextResponse.json({ error: "A valid exclusive slug is required.", code: "bad_request" }, { status: 400 });
  }

  const rawType = body?.type;
  const kind: MediaKind = rawType === "series" ? "series" : "movie";

  try {
    const provider = getVaultProvider();
    const sources: PlaybackSource[] = provider.getPlaybackSources
      ? await provider.getPlaybackSources(kind, slug)
      : [];
    return NextResponse.json(
      { sources },
      { headers: { "cache-control": "private, max-age=60, stale-while-revalidate=300" } }
    );
  } catch (error) {
    const providerError = error instanceof MediaProviderError ? error : null;
    const status = providerError ? (providerError.status === 501 ? 503 : providerError.status) : 502;
    console.warn("[api/media/exclusive/playback]", (error as Error)?.message || error);
    // An empty list is a valid answer: the player then uses direct files only.
    return NextResponse.json(
      { sources: [], error: "Playback sources are unavailable right now.", code: providerError?.code || "network_error" },
      { status, headers: { "cache-control": "no-store" } }
    );
  }
}
