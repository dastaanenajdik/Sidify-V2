import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { followedArtists } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import type { Artist, FollowedArtistRow } from "@/lib/types";
import { withDatabase, withDatabaseWrite } from "@/lib/dbResponses";
import { readJsonBody } from "@/lib/readJsonBody";

export const dynamic = "force-dynamic";

export async function GET() {
  return withDatabase({ artists: [] }, async () => {
    const rows = await db.select().from(followedArtists).orderBy(desc(followedArtists.followedAt)).limit(300);
    const out: FollowedArtistRow[] = rows.map((r) => ({
      artistId: r.artistId,
      artist: r.payload as Artist,
      followedAt: r.followedAt.toISOString(),
    }));
    return NextResponse.json({ artists: out });
  });
}

export async function POST(req: NextRequest) {
  const body = await readJsonBody<{ artist: Artist }>(req);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const { artist } = body;
  if (!artist?.id) return NextResponse.json({ error: "artist required" }, { status: 400 });
  return withDatabaseWrite(async () => {
    await db
      .insert(followedArtists)
      .values({ artistId: artist.id, payload: artist })
      .onConflictDoNothing();
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  return withDatabaseWrite(async () => {
    await db.delete(followedArtists).where(eq(followedArtists.artistId, id));
    return NextResponse.json({ ok: true });
  });
}
