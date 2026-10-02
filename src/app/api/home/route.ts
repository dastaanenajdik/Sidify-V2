import { NextRequest, NextResponse } from "next/server";
import { ytSearch, ytSearchTracks } from "@/lib/engine";
import { encodePseudoAlbum } from "@/lib/parser";
import type { Album, Artist, HomeData, Track } from "@/lib/types";
import { curateListeningRecommendations, rankListeningArtists } from "@/lib/recommendations";

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

type HomeCatalog = Pick<HomeData, "trending" | "newReleases">;
let cache: { at: number; country: string; data: HomeCatalog } | null = null;

function safeCountry(value: unknown): string {
  return typeof value === "string" && /^[A-Za-z]{2}$/.test(value) ? value.toUpperCase() : "US";
}

function safeString(value: unknown, limit: number): string {
  return typeof value === "string" ? value.replace(/[\x00-\x1f]/g, " ").trim().slice(0, limit) : "";
}

/** The home page sends only this browser's own recent listening history. */
function sanitizeHistory(value: unknown): Track[] {
  if (!Array.isArray(value)) return [];
  const tracks: Track[] = [];
  const seen = new Set<string>();

  for (const item of value.slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const id = safeString(raw.id, 160);
    const title = safeString(raw.title, 240);
    const artist = safeString(raw.artist, 200);
    if (!id || !title || !artist || seen.has(id)) continue;
    seen.add(id);

    const artwork = safeString(raw.artwork, 1000);
    tracks.push({
      id,
      videoId: safeString(raw.videoId, 32) || undefined,
      title,
      artist,
      artistId: safeString(raw.artistId, 160) || undefined,
      album: safeString(raw.album, 240) || undefined,
      albumId: safeString(raw.albumId, 160) || undefined,
      artwork: /^https?:\/\//i.test(artwork) || artwork.startsWith("/") ? artwork : "",
      previewUrl: "",
      durationMs: typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) ? Math.max(0, raw.durationMs) : 0,
      genre: safeString(raw.genre, 100) || undefined,
      explicit: typeof raw.explicit === "boolean" ? raw.explicit : undefined,
    });
  }

  return tracks;
}

async function getCatalog(country: string): Promise<HomeCatalog> {
  if (cache && Date.now() - cache.at < 10 * 60_000 && cache.country === country) return cache.data;

  const [trendingResult, releaseResults] = await Promise.all([
    ytSearch("trending songs 2026 official audio", "songs", 22).catch(() => ({
      tracks: [] as Track[],
      albums: [] as Album[],
      artists: [] as Artist[],
    })),
    Promise.all(
      RELEASE_QUERIES.map(async (rq) => {
        const tracks = await ytSearchTracks(rq.q, 1).catch(() => [] as Track[]);
        return { rq, artwork: tracks[0]?.artwork || "", artist: tracks[0]?.artist || "Various Artists" };
      })
    ),
  ]);

  const newReleases: Album[] = releaseResults
    .filter((result) => result.artwork)
    .map(({ rq, artwork, artist }) => ({
      id: encodePseudoAlbum({ q: rq.q, t: rq.t, a: artist }),
      title: rq.t,
      artist,
      artwork,
      genre: "New",
    }));

  const data = { trending: trendingResult.tracks, newReleases };
  cache = { at: Date.now(), country, data };
  return data;
}

async function buildHome(country: string, history: Track[]) {
  const catalog = await getCatalog(country);
  const preferredArtists = rankListeningArtists(history);
  const recommendationArtists = preferredArtists.slice(0, 4);

  // Search only for artists already present in the listener's own history. No generic
  // fallback query is used, so a new listener never gets an unrelated/random mix.
  const candidatesByArtist = await Promise.all(
    recommendationArtists.map(({ name }) => ytSearchTracks(`${name} songs`, 14).catch(() => [] as Track[]))
  );
  const recommended = curateListeningRecommendations(history, recommendationArtists, candidatesByArtist, 14);

  const topArtists: Artist[] = preferredArtists.slice(0, 10).map((artist) => ({
    // A name is a valid fallback for the artist route's search-based resolver when the
    // original track did not include a YouTube channel id.
    id: artist.id || artist.name,
    name: artist.name,
    artwork: artist.artwork,
    genre: artist.genre,
  }));

  const payload: HomeData = {
    ...catalog,
    topArtists,
    recommended,
    recentlyPlayed: history,
    basedOnArtist: preferredArtists[0]?.name,
  };

  return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  const country = safeCountry(req.nextUrl.searchParams.get("country"));
  // Legacy requests have no browser-specific listening data, so return no personal mix
  // rather than leaking another visitor's history into this anonymous endpoint.
  return buildHome(country, []);
}

export async function POST(req: NextRequest) {
  let body: { country?: unknown; history?: unknown } | null = null;
  try {
    body = (await req.json()) as { country?: unknown; history?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const country = safeCountry(body?.country);
  const history = sanitizeHistory(body?.history);
  return buildHome(country, history);
}
