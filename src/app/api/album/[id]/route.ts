import { NextResponse } from "next/server";
import { decodePseudoAlbum, ytSearchTracks } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/album/{ytq-...} — pseudo-album: a grouped YouTube search as a tracklist. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const pseudo = decodePseudoAlbum(id);
  if (!pseudo) {
    return NextResponse.json({ error: "Album not found" }, { status: 404 });
  }
  try {
    // Fallback chain: full query -> just the title -> artist best-of
    const candidates = [pseudo.q, pseudo.t, pseudo.a ? `${pseudo.a} best songs` : ""].filter((x) => x.trim());
    let tracks = await ytSearchTracks(candidates[0], 20);
    for (let k = 1; k < candidates.length && !tracks.length; k++) {
      tracks = await ytSearchTracks(candidates[k], 20);
    }
    if (!tracks.length) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    const album = {
      id,
      title: pseudo.t,
      artist: pseudo.a || tracks[0].artist,
      artistId: tracks[0].artistId,
      artwork: tracks[0].artwork,
      trackCount: tracks.length,
      genre: "Collection",
    };
    return NextResponse.json(
      { success: true, album, tracks },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } }
    );
  } catch (e) {
    console.error("album error", e);
    return NextResponse.json({ error: "Failed to load album" }, { status: 502 });
  }
}
