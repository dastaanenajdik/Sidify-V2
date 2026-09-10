import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { downloads, followedArtists, likedSongs } from "@/db/schema";
import type { Artist, Track } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Bulk-restores a backup produced by the Settings > Backup export. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    liked?: Track[];
    followed?: Artist[];
    downloads?: { track: Track; quality?: string; sizeBytes?: number }[];
  };

  let restored = 0;
  for (const t of body.liked || []) {
    if (t?.id) {
      await db.insert(likedSongs).values({ trackId: t.id, payload: t }).onConflictDoNothing();
      restored++;
    }
  }
  for (const a of body.followed || []) {
    if (a?.id) {
      await db.insert(followedArtists).values({ artistId: a.id, payload: a }).onConflictDoNothing();
      restored++;
    }
  }
  for (const d of body.downloads || []) {
    if (d?.track?.id) {
      await db
        .insert(downloads)
        .values({ trackId: d.track.id, payload: d.track, quality: d.quality || "high", sizeBytes: d.sizeBytes || 0 })
        .onConflictDoNothing();
      restored++;
    }
  }
  return NextResponse.json({ ok: true, restored });
}
