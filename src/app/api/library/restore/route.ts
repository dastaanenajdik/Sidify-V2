import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { downloads, followedArtists, likedSongs } from "@/db/schema";
import type { Artist, Track } from "@/lib/types";
import { withDatabaseWrite } from "@/lib/dbResponses";

export const dynamic = "force-dynamic";

/** Bulk-restores a backup produced by the Settings > Backup export. */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    liked?: Track[];
    followed?: Artist[];
    downloads?: { track: Track; quality?: string; sizeBytes?: number }[];
  };

  return withDatabaseWrite(async () => {
    const likedRows = (body.liked || []).filter((t): t is Track => Boolean(t?.id)).map((t) => ({ trackId: t.id, payload: t }));
    const followedRows = (body.followed || []).filter((a): a is Artist => Boolean(a?.id)).map((a) => ({ artistId: a.id, payload: a }));
    const downloadRows = (body.downloads || [])
      .filter((d): d is { track: Track; quality?: string; sizeBytes?: number } => Boolean(d?.track?.id))
      .map((d) => ({ trackId: d.track.id, payload: d.track, quality: d.quality || "high", sizeBytes: d.sizeBytes || 0 }));

    await Promise.all([
      likedRows.length ? db.insert(likedSongs).values(likedRows).onConflictDoNothing() : Promise.resolve(),
      followedRows.length ? db.insert(followedArtists).values(followedRows).onConflictDoNothing() : Promise.resolve(),
      downloadRows.length ? db.insert(downloads).values(downloadRows).onConflictDoNothing() : Promise.resolve(),
    ]);

    return NextResponse.json({ ok: true, restored: likedRows.length + followedRows.length + downloadRows.length });
  });
}
