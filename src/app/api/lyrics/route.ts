import { NextRequest, NextResponse } from "next/server";
import { cleanTitle, findLyrics } from "@/lib/lyrics";

export const runtime = "nodejs";
export const maxDuration = 20;

/** Guard against a runaway LRC payload before it reaches the client. */
const MAX_LINES = 1200;
const MAX_LINE_LENGTH = 500;

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const title = params.get("title")?.trim() || "";
  const artist = params.get("artist")?.trim() || "";
  const duration = Number(params.get("duration"));
  if (!cleanTitle(title) || title.length > 500 || artist.length > 300) {
    return NextResponse.json({ success: false, message: "A valid song title is required" }, { status: 400 });
  }
  try {
    const result = await findLyrics({ title, artist, duration: Number.isFinite(duration) && duration > 0 ? duration : undefined });
    if (!result) {
      return NextResponse.json({ success: false, message: "Lyrics not found. Try searching with the song title and singer." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    }
    // `lines` is empty unless the provider supplied usable timestamps, so clients can
    // offer a synced view when possible and silently stay static otherwise.
    const lines = result.lines
      .slice(0, MAX_LINES)
      .map((l) => ({ startMs: Math.max(0, Math.round(l.startMs)), text: l.text.slice(0, MAX_LINE_LENGTH) }));
    return NextResponse.json({ success: true, lyrics: result.lyrics, lines, synced: lines.length > 0, source: result.source, ...(result.instrumental ? { instrumental: true } : {}) }, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch {
    return NextResponse.json({ success: false, message: "Lyrics services are temporarily unavailable. Please retry." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
