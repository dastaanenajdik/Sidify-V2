import { NextResponse } from "next/server";
import { ytSearchCover } from "@/lib/engine";
import { MOODS } from "@/lib/explore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/explore — a cover for every mood / genre tile (the top song for its
 * seed). Fetched concurrently with fast cover-only lookup and stale-while-revalidate.
 */

const TTL = 6 * 60 * 60_000;
const PER_COVER_TIMEOUT_MS = 2_800;

let cache: { at: number; covers: Record<string, string> } | null = null;
let running: Promise<Record<string, string>> | null = null;

async function build(): Promise<Record<string, string>> {
  const covers: Record<string, string> = { ...(cache?.covers || {}) };
  // Tiles with bundled artwork don't need a catalogue lookup.
  const queue = MOODS.filter((m) => {
    if (m.art) covers[m.slug] = m.art;
    return !m.art;
  });
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      try {
        const art = await Promise.race([
          ytSearchCover(m.q),
          new Promise<string>((resolve) => setTimeout(() => resolve(""), PER_COVER_TIMEOUT_MS)),
        ]);
        if (art) covers[m.slug] = art;
      } catch {
        /* leave it without a cover */
      }
    }
  };
  await Promise.all(Array.from({ length: 10 }, worker));
  if (Object.keys(covers).length) cache = { at: Date.now(), covers };
  return covers;
}

export async function GET() {
  if (cache) {
    if (Date.now() - cache.at > TTL && !running) {
      running = build().finally(() => {
        running = null;
      });
    }
    return NextResponse.json(
      { covers: cache.covers },
      { headers: { "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400" } }
    );
  }

  running ??= build().finally(() => {
    running = null;
  });
  const covers = await running;
  if (!Object.keys(covers).length) {
    return NextResponse.json({ covers: {} }, { headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(
    { covers },
    { headers: { "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400" } }
  );
}

