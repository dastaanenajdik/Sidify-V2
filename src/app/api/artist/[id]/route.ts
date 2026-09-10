import { NextRequest, NextResponse } from "next/server";
import { encodePseudoAlbum, toTrack, ytChannelVideos } from "@/lib/ytdlp";
import type { Album, Track } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/artist/{channelId} — YouTube channel videos as artist profile. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const data = await ytChannelVideos(id, 20);
    if (!data) {
      return NextResponse.json({ error: "Artist not found" }, { status: 404 });
    }

    const songs = data.entries.map(toTrack).filter(Boolean).slice(0, 14) as Track[];
    const art = songs[0]?.artwork || "";

    const artist = {
      id: data.channelId || id,
      name: data.name,
      artwork: art,
    };

    const albums: Album[] = [
      { q: `${data.name} best songs`, t: `${data.name} — Top Tracks` },
      { q: `${data.name} full album`, t: `${data.name} — Albums` },
      { q: `${data.name} live performance`, t: "Live & Performances" },
    ].map((p, i) => ({
      id: encodePseudoAlbum({ q: p.q, t: p.t, a: data.name }),
      title: p.t,
      artist: data.name,
      artistId: data.channelId || id,
      artwork: songs[i]?.artwork || art,
    }));

    return NextResponse.json(
      { success: true, artist, songs, albums },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } }
    );
  } catch (e) {
    console.error("artist error", e);
    return NextResponse.json({ error: "Failed to load artist" }, { status: 502 });
  }
}
