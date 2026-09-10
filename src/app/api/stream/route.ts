import { NextRequest, NextResponse } from "next/server";
import { isVideoId, resolveAudio, ytThumbs } from "@/lib/ytdlp";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/stream?video_id={id}
 *   -> JSON: { success, video_id, title, artist, thumbnail, duration, audio_url | null }
 * GET /api/stream?video_id={id}&play=1
 *   -> proxied audio bytes with Range passthrough (same-origin for Web Audio). */
export async function GET(req: NextRequest) {
  const videoId = (req.nextUrl.searchParams.get("video_id") || "").trim();

  if (!isVideoId(videoId)) {
    return NextResponse.json({ success: false, error: "invalid video_id" }, { status: 400 });
  }

  let resolved = await resolveAudio(videoId);

  // ---- JSON contract mode ----
  if (req.nextUrl.searchParams.get("play") !== "1") {
    if (!resolved) {
      return NextResponse.json(
        {
          success: false,
          video_id: videoId,
          title: "",
          artist: "",
          thumbnail: ytThumbs(videoId).hq,
          duration: 0,
          audio_url: null,
          reason: "stream_unavailable",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({
      success: true,
      video_id: videoId,
      title: resolved.title,
      artist: resolved.artist,
      thumbnail: resolved.thumbnail,
      duration: resolved.duration,
      audio_url: `/api/stream?video_id=${videoId}&play=1`,
    });
  }

  // ---- proxy mode (audio bytes) ----
  const makeReq = (url: string) => {
    const headers: Record<string, string> = {};
    const range = req.headers.get("range");
    if (range) headers["range"] = range;
    return fetch(url, { headers, cache: "no-store" });
  };

  if (resolved) {
    let upstream = await makeReq(resolved.url).catch(() => null);
    if (upstream && (upstream.status === 403 || upstream.status === 410)) {
      resolved = await resolveAudio(videoId, true);
      upstream = resolved ? await makeReq(resolved.url).catch(() => null) : null;
    }
    if (upstream && upstream.ok) {
      const out = new Headers();
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = upstream.headers.get(h);
        if (v) out.set(h, v);
      }
      if (!out.has("content-type")) out.set("content-type", "audio/mp4");
      out.set("cache-control", "no-store");
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }
  }

  return NextResponse.json(
    { success: false, error: "stream_unavailable", video_id: videoId },
    { status: 503 }
  );
}
