import { NextResponse } from "next/server";
import { ytSearchTracks } from "@/lib/engine";
import { MOODS } from "@/lib/explore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/explore — a cover for every mood / genre tile (the top song for its
 * seed). Fetched a few at a time and kept for six hours.
 */

let cache: { at: number; covers: Record<string, string> } | null = null;
let running: Promise<Record<string, string>> | null = null;

async function build(): Promise<Record<string, string>> {
  const covers: Record<string, string> = {};
  // Tiles with bundled artwork don't need a catalogue lookup.
  const queue = MOODS.filter((m) => {
    if (m.art) covers[m.slug] = m.art;
    return !m.art;
  });
  const worker = async () => {
    for (let m = queue.shift(); m; m = queue.shift()) {
      try {
        const t = await ytSearchTracks(m.q, 1);
        if (t[0]?.artwork) covers[m.slug] = t[0].artwork;
      } catch {
        /* leave it without a cover */
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return covers;
}

export async function GET() {
  if (!cache || Date.now() - cache.at > 6 * 60 * 60_000) {
    running ??= build().finally(() => {
      running = null;
    });
    const covers = await running;
    if (Object.keys(covers).length) cache = { at: Date.now(), covers };
    else if (!cache) return NextResponse.json({ covers: {} }, { headers: { "cache-control": "no-store" } });
  }
  return NextResponse.json(
    { covers: cache!.covers },
    { headers: { "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400" } }
  );
}
