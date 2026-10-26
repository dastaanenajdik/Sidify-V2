import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playlists, playlistTracks } from "@/db/schema";
import { asc, inArray } from "drizzle-orm";
import type { PlaylistRow, Track } from "@/lib/types";
import { withDatabase, withDatabaseWrite } from "@/lib/dbResponses";
import { readJsonBody } from "@/lib/readJsonBody";

export const dynamic = "force-dynamic";

export async function GET() {
  return withDatabase({ playlists: [] }, async () => {
    const pls = await db.select().from(playlists).orderBy(asc(playlists.createdAt)).limit(100);
    if (!pls.length) return NextResponse.json({ playlists: [] });

    const allTrackRows = await db
      .select()
      .from(playlistTracks)
      .where(
        inArray(
          playlistTracks.playlistId,
          pls.map((p) => p.id)
        )
      )
      .orderBy(asc(playlistTracks.position), asc(playlistTracks.addedAt));

    const byPlaylist = new Map<number, Track[]>();
    for (const r of allTrackRows) {
      let bucket = byPlaylist.get(r.playlistId);
      if (!bucket) {
        bucket = [];
        byPlaylist.set(r.playlistId, bucket);
      }
      bucket.push(r.payload as Track);
    }

    const out: PlaylistRow[] = pls.map((p) => ({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      tracks: byPlaylist.get(p.id) ?? [],
    }));
    return NextResponse.json({ playlists: out });
  });
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody<{ name: string }>(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const clean = (typeof body.name === "string" ? body.name : "").trim().slice(0, 80);
  if (!clean) return NextResponse.json({ error: "name required" }, { status: 400 });
  return withDatabaseWrite(async () => {
    const [row] = await db.insert(playlists).values({ name: clean }).returning();
    return NextResponse.json({ playlist: { id: row.id, name: row.name, createdAt: row.createdAt.toISOString(), tracks: [] } });
  });
}
