import { NextRequest, NextResponse } from "next/server";
import { ytSearch, ytSearchCoverMeta, ytSearchTracks } from "@/lib/engine";
import { encodePseudoAlbum } from "@/lib/parser";
import { db, hasDatabaseUrl } from "@/db";
import { recentlyPlayed } from "@/db/schema";
import { desc } from "drizzle-orm";
import type { Album, Artist, HomeData, Track } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const HOME_TTL = 10 * 60_000;

const RELEASE_QUERIES: { q: string; t: string }[] = [
  { q: "new songs 2026 official", t: "New Music 2026" },
  { q: "latest bollywood songs 2026", t: "Bollywood Fresh" },
  { q: "new pop releases 2026", t: "Pop Radar" },
  { q: "latest punjabi songs 2026", t: "Punjabi Heat" },
  { q: "new hip hop 2026", t: "Hip-Hop Now" },
  { q: "trending lo-fi 2026", t: "Lo-Fi Corner" },
];

type BaseHome = Omit<HomeData, "recentlyPlayed" | "basedOnArtist">;

const cacheByCountry = new Map<string, { at: number; data: BaseHome }>();
const inflightByCountry = new Map<string, Promise<BaseHome>>();
const recBySeed = new Map<string, { at: number; tracks: Track[] }>();

async function buildBaseHome(country: string): Promise<BaseHome> {
  const [trendingResult, releaseResults, defaultRecommended] = await Promise.all([
    ytSearch("trending songs 2026 official audio", "songs", 22).catch(() => ({
      tracks: [] as Track[],
      albums: [] as Album[],
      artists: [] as Artist[],
    })),
    Promise.all(
      RELEASE_QUERIES.map(async (rq) => {
        const meta = await ytSearchCoverMeta(rq.q);
        return { rq, art: meta.artwork, artist: meta.artist };
      })
    ),
    ytSearchTracks("chill hits 2026", 14).catch(() => [] as Track[]),
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

  const data: BaseHome = {
    trending,
    newReleases,
    topArtists,
    recommended: defaultRecommended,
  };
  if (trending.length || newReleases.length || defaultRecommended.length) {
    cacheByCountry.set(country, { at: Date.now(), data });
  }
  return data;
}

function getBaseHome(country: string): Promise<BaseHome> {
  const hit = cacheByCountry.get(country);
  if (hit) {
    if (Date.now() - hit.at > HOME_TTL && !inflightByCountry.has(country)) {
      const p = buildBaseHome(country).finally(() => {
        inflightByCountry.delete(country);
      });
      inflightByCountry.set(country, p);
    }
    return Promise.resolve(hit.data);
  }
  let p = inflightByCountry.get(country);
  if (!p) {
    p = buildBaseHome(country).finally(() => {
      inflightByCountry.delete(country);
    });
    inflightByCountry.set(country, p);
  }
  return p;
}

async function readRecentFromDb(): Promise<Track[]> {
  if (!hasDatabaseUrl()) return [];
  try {
    const rows = await db.select().from(recentlyPlayed).orderBy(desc(recentlyPlayed.playedAt)).limit(12);
    return rows.map((r) => r.payload as Track);
  } catch {
    return [];
  }
}

async function getSeedRecommended(seedArtist: string, fallback: Track[]): Promise<Track[]> {
  const key = seedArtist.trim().toLowerCase();
  if (!key) return fallback;
  const hit = recBySeed.get(key);
  if (hit && Date.now() - hit.at < HOME_TTL) return hit.tracks;
  try {
    const tracks = await ytSearchTracks(`${seedArtist} songs`, 14);
    if (tracks.length) {
      if (recBySeed.size > 100) {
        const oldest = recBySeed.keys().next().value;
        if (oldest) recBySeed.delete(oldest);
      }
      recBySeed.set(key, { at: Date.now(), tracks });
      return tracks;
    }
  } catch {
    /* keep fallback */
  }
  return fallback;
}

export async function GET(req: NextRequest) {
  const country = req.nextUrl.searchParams.get("country") || "US";

  const [recent, base] = await Promise.all([readRecentFromDb(), getBaseHome(country)]);

  const seedArtist = recent[0]?.artist;
  const rawRecommended = seedArtist ? await getSeedRecommended(seedArtist, base.recommended) : base.recommended;
  const recentIds = new Set(recent.map((t) => t.id));
  const recommended = rawRecommended.filter((t) => !recentIds.has(t.id)).slice(0, 14);

  const payload: HomeData = {
    ...base,
    recommended,
    recentlyPlayed: recent,
    basedOnArtist: seedArtist,
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": hasDatabaseUrl()
        ? "private, max-age=30, stale-while-revalidate=300"
        : "public, s-maxage=180, stale-while-revalidate=900",
    },
  });
}

