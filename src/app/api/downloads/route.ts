import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { downloads } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import type { DownloadRow, Track } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const rows = await db.select().from(downloads).orderBy(desc(downloads.downloadedAt)).limit(1000);
  const out: DownloadRow[] = rows.map((r) => ({
    trackId: r.trackId,
    track: r.payload as Track,
    quality: r.quality,
    sizeBytes: r.sizeBytes,
    downloadedAt: r.downloadedAt.toISOString(),
  }));
  return NextResponse.json({ downloads: out });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { track: Track; quality?: string; sizeBytes?: number };
  if (!body.track?.id) return NextResponse.json({ error: "track required" }, { status: 400 });
  await db
    .insert(downloads)
    .values({
      trackId: body.track.id,
      payload: body.track,
      quality: body.quality || "high",
      sizeBytes: body.sizeBytes || 0,
    })
    .onConflictDoUpdate({
      target: downloads.trackId,
      set: { payload: body.track, quality: body.quality || "high", sizeBytes: body.sizeBytes || 0, downloadedAt: new Date() },
    });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    await db.delete(downloads).where(eq(downloads.trackId, id));
  } else {
    await db.delete(downloads);
  }
  return NextResponse.json({ ok: true });
}
