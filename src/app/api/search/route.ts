import { NextRequest, NextResponse } from "next/server";
import { ytSearch, type SearchKind } from "@/lib/engine";
import { encodePseudoAlbum } from "@/lib/parser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const VALID_TYPES: SearchKind[] = ["all", "songs", "albums", "artists"];

/** GET /api/search?q={query}&type={all|songs|albums|artists}&limit={n}
 *  YouTube Music powered search (youtubei.js / InnerTube).
 *  Response shape unchanged for the existing client: {songs, albums, artists, items},
 *  plus a flat `results` alias. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const requestedType = (sp.get("type") || "all") as SearchKind;
  const type: SearchKind = VALID_TYPES.includes(requestedType) ? requestedType : "all";
  const limit = Math.min(Number(sp.get("limit")) || 20, 30);

  const empty = { success: true, songs: [], albums: [], artists: [], items: [], results: [] };
  if (!q) return NextResponse.json(empty);

  try {
    const found = await ytSearch(q, type, limit);

    const songs = found.tracks;
    // Album results coming from a song-shaped item still need a usable id.
    const albums = found.albums.map((a) => ({
      ...a,
      id: a.id || encodePseudoAlbum({ q: a.title, t: a.title, a: a.artist }),
    }));
    const artists = found.artists.filter((a) => a.id && a.name);

    return NextResponse.json(
      {
        success: true,
        songs,
        albums,
        artists,
        // spec-compatible flattened list
        items: songs.map((t) => ({
          id: t.videoId,
          videoId: t.videoId,
          title: t.title,
          artist: t.artist,
          thumbnail: t.artwork,
        })),
        results: songs.map((t) => ({
          id: t.videoId,
          videoId: t.videoId,
          title: t.title,
          artist: t.artist,
          album: t.album ?? null,
          duration: Math.round((t.durationMs || 0) / 1000),
          thumbnail: t.artwork,
        })),
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (e) {
    console.error("search error", e);
    return NextResponse.json({ ...empty, success: false, error: "Search failed" }, { status: 502 });
  }
}
