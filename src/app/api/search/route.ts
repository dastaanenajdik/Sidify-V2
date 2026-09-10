import { NextRequest, NextResponse } from "next/server";
import { encodePseudoAlbum, toTrack, ytSearch } from "@/lib/ytdlp";
import type { Album, Artist, Track } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/search?q={query}&type={all|songs|albums|artists}&limit={n}
 *  YouTube-powered search (yt-dlp). Response shape unchanged: {songs, albums, artists}. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = (sp.get("q") || "").trim();
  const type = sp.get("type") || "all";
  const limit = Math.min(Number(sp.get("limit")) || 20, 30);

  if (!q) return NextResponse.json({ success: true, songs: [], albums: [], artists: [], items: [] });

  try {
    let songs: Track[] = [];
    let albums: Album[] = [];
    let artists: Artist[] = [];

    if (type === "all") {
      const [videoEntries, albumEntries] = await Promise.all([
        ytSearch(q, Math.max(8, Math.floor(limit / 2))).catch(() => []),
        ytSearch(`${q} full album`, 6).catch(() => []),
      ]);
      songs = videoEntries.map(toTrack).filter(Boolean) as Track[];
      const seenCh = new Set<string>();
      for (const e of videoEntries) {
        const cid = e?.channel_id;
        const name = e?.channel;
        if (cid && name && !seenCh.has(cid)) {
          seenCh.add(cid);
          const tr = toTrack(e);
          artists.push({ id: String(cid), name: String(name), artwork: tr?.artwork });
        }
        if (artists.length >= 6) break;
      }
      albums = albumEntries
        .map(toTrack)
        .filter(Boolean)
        .map((t) => ({
          id: encodePseudoAlbum({ q: t!.title, t: t!.title, a: t!.artist }),
          title: t!.title,
          artist: t!.artist,
          artistId: t!.artistId,
          artwork: t!.artwork,
        })) as Album[];
    } else if (type === "songs") {
      songs = (await ytSearch(q, limit).catch(() => [])).map(toTrack).filter(Boolean) as Track[];
    } else if (type === "albums") {
      const entries = await ytSearch(`${q} album`, limit).catch(() => []);
      albums = entries
        .map(toTrack)
        .filter(Boolean)
        .map((t) => ({
          id: encodePseudoAlbum({ q: t!.title, t: t!.title, a: t!.artist }),
          title: t!.title,
          artist: t!.artist,
          artistId: t!.artistId,
          artwork: t!.artwork,
        })) as Album[];
    } else if (type === "artists") {
      const entries = await ytSearch(q, Math.min(limit + 6, 30)).catch(() => []);
      const seen = new Set<string>();
      for (const e of entries) {
        if (e?.channel_id && e?.channel && !seen.has(e.channel_id)) {
          seen.add(e.channel_id);
          const tr = toTrack(e);
          artists.push({ id: String(e.channel_id), name: String(e.channel), artwork: tr?.artwork });
        }
        if (artists.length >= limit) break;
      }
    }

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
      },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } }
    );
  } catch (e) {
    console.error("search error", e);
    return NextResponse.json({ success: false, songs: [], albums: [], artists: [], items: [], error: "Search failed" }, { status: 502 });
  }
}
