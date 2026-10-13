import { NextRequest, NextResponse } from "next/server";
import { ytRadioNext } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/radio?video_id={id}&limit={n}
 *  YouTube Music's own "Up next" queue for a track — the songs YTM itself would play
 *  after this one (song radio / automix), used for next-song autoplay on the client. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const videoId = (sp.get("video_id") || sp.get("videoId") || "").trim();
  const limit = Math.min(Number(sp.get("limit")) || 12, 25);

  if (!videoId) return NextResponse.json({ success: true, tracks: [] });

  try {
    const tracks = await ytRadioNext(videoId, limit);
    return NextResponse.json(
      { success: true, tracks },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=1200" } }
    );
  } catch (e) {
    console.error("radio error", e);
    return NextResponse.json({ success: false, tracks: [], error: "Radio failed" }, { status: 502 });
  }
}
