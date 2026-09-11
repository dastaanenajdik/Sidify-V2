import { NextRequest, NextResponse } from "next/server";
import { ytSearch, ytSearchTracks } from "@/lib/engine";
import { encodePseudoAlbum } from "@/lib/parser";
import { db } from "@/db";
import { recentlyPlayed } from "@/db/schema";
import { desc } from "drizzle-orm";
import type { Album, Artist, HomeData, Track } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const RELEASE_QUERIES: { q: string; t: string }[] = [
  { q: "new songs 2026 official", t: "New Music 2026" },
  { q: "latest bollywood songs 2026", t: "Bollywood Fresh" },
  { q: "new pop releases 2026", t: "Pop Radar" },
  { q: "latest punjabi songs 2026", t: "Punjabi Heat" },
  { q: "new hip hop 2026", t: "Hip-Hop Now" },
  { q: "trending lo-fi 2026", t: "Lo-Fi Corner" },
];

let cache: { at: number; country: string; data: Omit<HomeData, "recentlyPlayed"> } | null = null;

export async function GET(req: NextRequest) {
  const country = req.nextUrl.searchParams.get("country") || "US";

  let recent: Track[] = [];
  try {
    const rows = await db.select().from(recentlyPlayed).orderBy(desc(recentlyPlayed.playedAt)).limit(12);
    recent = rows.map((r) => r.payload as Track);
  } catch (e) {
    console.error("recent read error", e);
  }

  if (!cache || Date.now() - cache.at > 10 * 60_000 || cache.country !== country) {
    const [trendingResult, releaseResults] = await Promise.all([
      ytSearch("trending songs 2026 official audio", "songs", 22).catch(() => ({
        tracks: [] as Track[],
        albums: [] as Album[],
        artists: [] as Artist[],
      })),
      Promise.all(
        RELEASE_QUERIES.map(async (rq) => {
          const t = await ytSearchTracks(rq.q, 1).catch(() => [] as Track[]);
          return { rq, art: t[0]?.artwork || "", artist: t[0]?.artist || "Various Artists" };
        })
      ),
    ]);

    const trending = trendingResult.tracks;

    // Unique artists behind the trending tracks (same derivation as before).
    const seen = new Set<string>();
    const topArtists: Artist[] = [];
    for (const t of trending) {
      if (t.artistId && t.artist && !seen.has(t.artistId)) {
        seen.add(t.artistId);
        topArtists.push({ id: t.artistId, name: t.artist, artwork: t.artwork });
      }
      if (topArtists.length >= 10) break;
    }

    const newReleases: Album[] = releaseResults
      .filter((r) => r.art)
      .map(({ rq, art, artist }) => ({
        id: encodePseudoAlbum({ q: rq.q, t: rq.t, a: artist }),
        title: rq.t,
        artist,
        artwork: art,
        genre: "New",
      }));

    cache = { at: Date.now(), country, data: { trending, newReleases, topArtists, recommended: [] } };
  }

  const seedArtist = recent[0]?.artist;
  let recommended: Track[] = [];
  try {
    recommended = await ytSearchTracks(seedArtist ? `${seedArtist} songs` : "chill hits 2026", 14);
    const recentIds = new Set(recent.map((t) => t.id));
    recommended = recommended.filter((t) => !recentIds.has(t.id)).slice(0, 14);
  } catch {
    /* keep empty */
  }

  const payload: HomeData = {
    ...cache.data,
    recommended,
    recentlyPlayed: recent,
    basedOnArtist: seedArtist,
  };

  return NextResponse.json(payload);
}
