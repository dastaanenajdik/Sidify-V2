import { NextRequest, NextResponse } from "next/server";
import { db, hasDatabaseUrl } from "@/db";
import { likedSongs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import type { Track } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Database not configured", tracks: [] }, { status: 503 });
  try {
    const rows = await db.select().from(likedSongs).orderBy(desc(likedSongs.likedAt)).limit(500);
    return NextResponse.json({ tracks: rows.map((r) => r.payload as Track) });
  } catch {
    return NextResponse.json({ error: "Database unavailable", tracks: [] }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const { track } = (await req.json()) as { track: Track };
  if (!track?.id) return NextResponse.json({ error: "track required" }, { status: 400 });
  try {
    await db
      .insert(likedSongs)
      .values({ trackId: track.id, payload: track })
      .onConflictDoNothing();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await db.delete(likedSongs).where(eq(likedSongs.trackId, id));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

