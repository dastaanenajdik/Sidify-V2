import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { likedSongs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import type { Track } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(likedSongs).orderBy(desc(likedSongs.likedAt)).limit(500);
  return NextResponse.json({ tracks: rows.map((r) => r.payload as Track) });
}

export async function POST(req: NextRequest) {
  const { track } = (await req.json()) as { track: Track };
  if (!track?.id) return NextResponse.json({ error: "track required" }, { status: 400 });
  await db
    .insert(likedSongs)
    .values({ trackId: track.id, payload: track })
    .onConflictDoNothing();
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await db.delete(likedSongs).where(eq(likedSongs.trackId, id));
  return NextResponse.json({ ok: true });
}
