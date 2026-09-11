import { NextRequest, NextResponse } from "next/server";
import { resolveAudio, type ResolvedAudio } from "@/lib/engine";
import { isVideoId, ytThumbs } from "@/lib/parser";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** GET /api/stream?video_id={id}
 *   -> JSON: { success, video_id, title, artist, thumbnail, duration, audio_url | null }
 *      (this is the endpoint the client's `probeNative()` hits to decide between the
 *       native Web Audio engine and the YouTube IFrame fallback — it must keep
 *       answering JSON so that probe still works)
 * GET /api/stream?video_id={id}&play=1
 *   -> proxied audio bytes with HTTP Range passthrough so seeking/scrubbing works
 *      on a plain HTML5 <audio> element, same-origin for Web Audio. */
export async function GET(req: NextRequest) {
  const videoId = (req.nextUrl.searchParams.get("video_id") || "").trim();

  if (!isVideoId(videoId)) {
    return NextResponse.json({ success: false, error: "invalid video_id" }, { status: 400 });
  }

  const resolved = await resolveAudio(videoId);

  /* ---- JSON contract mode ---- */
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

  /* ---- proxy mode (audio bytes) ---- */
  const makeReq = (url: string) => {
    const headers: Record<string, string> = {};
    // Forward Range verbatim so partial requests map 1:1 to the CDN. When absent we
    // deliberately do NOT send `bytes=0-`: a full 200 response carries the real
    // Content-Length, which is how the browser derives `duration` for the seek bar.
    const range = req.headers.get("range");
    if (range) headers.range = range;
    headers["user-agent"] = req.headers.get("user-agent") || "Mozilla/5.0";
    return fetch(url, { headers, cache: "no-store" });
  };

  if (resolved) {
    let current: ResolvedAudio = resolved;
    let upstream = await makeReq(current.url).catch(() => null);

    // Deciphered URLs are short-lived / IP-bound: 403/410 means re-resolve and retry.
    if (upstream && (upstream.status === 403 || upstream.status === 410)) {
      const fresh = await resolveAudio(videoId, true);
      if (fresh) {
        current = fresh;
        upstream = await makeReq(current.url).catch(() => null);
      } else {
        upstream = null;
      }
    }

    if (upstream && upstream.ok) {
      const out = new Headers();
      for (const h of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = upstream.headers.get(h);
        if (v) out.set(h, v);
      }
      if (!out.has("content-type")) out.set("content-type", current.mimeType || "audio/mp4");
      if (!out.has("accept-ranges")) out.set("accept-ranges", "bytes");
      if (!out.has("content-length") && current.contentLength) {
        out.set("content-length", String(current.contentLength));
      }
      out.set("cache-control", "no-store");
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }
  }

  return NextResponse.json(
    { success: false, error: "stream_unavailable", video_id: videoId },
    { status: 503 }
  );
}
