import { NextRequest, NextResponse } from "next/server";
import { db, hasDatabaseUrl } from "@/db";
import { recentlyPlayed } from "@/db/schema";
import { desc, eq, notInArray } from "drizzle-orm";
import type { Track } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Database not configured", tracks: [] }, { status: 503 });
  try {
    const rows = await db.select().from(recentlyPlayed).orderBy(desc(recentlyPlayed.playedAt)).limit(50);
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
      .insert(recentlyPlayed)
      .values({ trackId: track.id, payload: track })
      .onConflictDoUpdate({ target: recentlyPlayed.trackId, set: { playedAt: new Date(), payload: track } });

    // Trim history to latest 50
    const keep = await db
      .select({ id: recentlyPlayed.trackId })
      .from(recentlyPlayed)
      .orderBy(desc(recentlyPlayed.playedAt))
      .limit(50);
    const keepIds = keep.map((k) => k.id);
    if (keepIds.length) {
      await db.delete(recentlyPlayed).where(notInArray(recentlyPlayed.trackId, keepIds));
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const id = req.nextUrl.searchParams.get("id");
  try {
    if (id) {
      await db.delete(recentlyPlayed).where(eq(recentlyPlayed.trackId, id));
    } else {
      await db.delete(recentlyPlayed);
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

