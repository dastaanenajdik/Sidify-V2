import { NextRequest, NextResponse } from "next/server";
import lyricsFinder from "lyrics-finder";

export const runtime = "nodejs";

/** Remove the metadata YouTube commonly appends to a music title. */
function cleanTitle(value: string): string {
  return value
    .replace(/\[[^\]]*(official|video|audio|lyrics?|visualizer|4k|hd|remaster|live|mv)[^\]]*\]/gi, " ")
    .replace(/\([^)]*(official|video|audio|lyrics?|visualizer|4k|hd|remaster|live|mv|version|edit|mix|feat\.?)[^)]*\)/gi, " ")
    .replace(/\b(?:official\s+)?(?:music\s+)?video\b/gi, " ")
    .replace(/\b(?:official\s+)?audio\b/gi, " ")
    .replace(/\b(?:lyrics?|lyric video|visualizer|4k|8k|hd|hq|remastered|remaster)\b/gi, " ")
    .replace(/\s+feat(?:uring)?\.?\s+[^-–—|]+(?=\s*[-–—|]|$)/gi, " ")
    .replace(/\s*[-–—|]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: NextRequest) {
  const rawTitle = request.nextUrl.searchParams.get("title")?.trim() || "";
  const rawArtist = request.nextUrl.searchParams.get("artist")?.trim() || "";

  if (!rawTitle) {
    return NextResponse.json({ success: false, message: "A title is required" }, { status: 400 });
  }

  const title = cleanTitle(rawTitle);
  const artist = cleanTitle(rawArtist);

  try {
    // lyrics-finder uses Google's lightweight lyrics result and has no browser
    // automation, making it suitable for a short-lived Vercel function.
    const lyrics = await lyricsFinder(title, artist);
    const cleanedLyrics = typeof lyrics === "string" ? lyrics.trim() : "";

    if (!cleanedLyrics || cleanedLyrics.length < 10) {
      return NextResponse.json({ success: false, message: "Lyrics not found" }, { status: 404 });
    }

    return NextResponse.json(
      { success: true, lyrics: cleanedLyrics },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } }
    );
  } catch (error) {
    console.error("Lyrics lookup failed", error);
    return NextResponse.json({ success: false, message: "Lyrics not found" }, { status: 404 });
  }
}
