import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { playlists, playlistTracks } from "@/db/schema";
import { and, asc, eq, max } from "drizzle-orm";
import type { Track } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const pid = Number(id);
  const [p] = await db.select().from(playlists).where(eq(playlists.id, pid));
  if (!p) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const rows = await db
    .select()
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, pid))
    .orderBy(asc(playlistTracks.position), asc(playlistTracks.addedAt));
  return NextResponse.json({
    playlist: {
      id: p.id,
      name: p.name,
      createdAt: p.createdAt.toISOString(),
      tracks: rows.map((r) => r.payload as Track),
    },
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const pid = Number(id);
  const { track } = (await req.json()) as { track: Track };
  if (!track?.id) return NextResponse.json({ error: "track required" }, { status: 400 });

  const [agg] = await db
    .select({ maxPos: max(playlistTracks.position) })
    .from(playlistTracks)
    .where(eq(playlistTracks.playlistId, pid));
  await db.insert(playlistTracks).values({
    playlistId: pid,
    trackId: track.id,
    payload: track,
    position: (agg?.maxPos ?? -1) + 1,
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const pid = Number(id);
  const { name } = (await req.json()) as { name: string };
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  await db.update(playlists).set({ name: name.trim().slice(0, 80) }).where(eq(playlists.id, pid));
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  const pid = Number(id);
  const trackId = req.nextUrl.searchParams.get("trackId");
  if (trackId) {
    await db
      .delete(playlistTracks)
      .where(and(eq(playlistTracks.playlistId, pid), eq(playlistTracks.trackId, trackId)));
    return NextResponse.json({ ok: true });
  }
  await db.delete(playlistTracks).where(eq(playlistTracks.playlistId, pid));
  await db.delete(playlists).where(eq(playlists.id, pid));
  return NextResponse.json({ ok: true });
}
