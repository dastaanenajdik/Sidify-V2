import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playlists, playlistTracks } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import type { PlaylistRow, Track } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const pls = await db.select().from(playlists).orderBy(asc(playlists.createdAt)).limit(100);
  const out: PlaylistRow[] = [];
  for (const p of pls) {
    const rows = await db
      .select()
      .from(playlistTracks)
      .where(eq(playlistTracks.playlistId, p.id))
      .orderBy(asc(playlistTracks.position), asc(playlistTracks.addedAt));
    out.push({
      id: p.id,
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      tracks: rows.map((r) => r.payload as Track),
    });
  }
  return NextResponse.json({ playlists: out });
}

export async function POST(req: NextRequest) {
  const { name } = (await req.json()) as { name: string };
  const clean = (name || "").trim().slice(0, 80);
  if (!clean) return NextResponse.json({ error: "name required" }, { status: 400 });
  const [row] = await db.insert(playlists).values({ name: clean }).returning();
  return NextResponse.json({ playlist: { id: row.id, name: row.name, createdAt: row.createdAt.toISOString(), tracks: [] } });
}
