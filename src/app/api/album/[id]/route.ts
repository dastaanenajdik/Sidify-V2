import { NextResponse } from "next/server";
import { ytAlbumTracks } from "@/lib/engine";
import { isPseudoAlbumId } from "@/lib/parser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/album/{id}
 *  Real YouTube Music album ids (`MPR…`, `OLAK5uy…`, `MPREb…`) resolve to their true
 *  tracklist; legacy `ytq-…` pseudo albums (home shelves, artist shelves and older
 *  links) still resolve to a grouped search, exactly as before. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  if (!id) return NextResponse.json({ error: "Album not found" }, { status: 404 });

  try {
    const data = await ytAlbumTracks(id, 20);
    if (!data || !data.tracks.length) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }

    const album = {
      id,
      title: data.album.title,
      artist: data.album.artist,
      artistId: data.album.artistId,
      artwork: data.album.artwork || data.tracks[0]?.artwork || "",
      trackCount: data.tracks.length,
      releaseDate: data.album.releaseDate,
      genre: isPseudoAlbumId(id) ? "Collection" : "Album",
    };

    return NextResponse.json(
      { success: true, album, tracks: data.tracks },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } }
    );
  } catch (e) {
    console.error("album error", e);
    return NextResponse.json({ error: "Failed to load album" }, { status: 502 });
  }
}
