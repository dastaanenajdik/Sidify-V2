import { NextRequest, NextResponse } from "next/server";
import { db, hasDatabaseUrl } from "@/db";
import { followedArtists } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import type { Artist, FollowedArtistRow } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Database not configured", artists: [] }, { status: 503 });
  try {
    const rows = await db.select().from(followedArtists).orderBy(desc(followedArtists.followedAt)).limit(300);
    const out: FollowedArtistRow[] = rows.map((r) => ({
      artistId: r.artistId,
      artist: r.payload as Artist,
      followedAt: r.followedAt.toISOString(),
    }));
    return NextResponse.json({ artists: out });
  } catch {
    return NextResponse.json({ error: "Database unavailable", artists: [] }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!hasDatabaseUrl()) return NextResponse.json({ error: "Database not configured" }, { status: 503 });
  const { artist } = (await req.json()) as { artist: Artist };
  if (!artist?.id) return NextResponse.json({ error: "artist required" }, { status: 400 });
  try {
    await db
      .insert(followedArtists)
      .values({ artistId: artist.id, payload: artist })
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
    await db.delete(followedArtists).where(eq(followedArtists.artistId, id));
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

