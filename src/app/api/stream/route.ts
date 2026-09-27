import { NextRequest, NextResponse } from "next/server";
import { resolveAudio, type ResolvedAudio } from "@/lib/engine";
import { isVideoId, ytThumbs } from "@/lib/parser";
import { contentDisposition, downloadFileName } from "@/lib/downloadName";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// 60 s is accepted on every Vercel plan; higher values fail the build on Hobby projects
// without Fluid compute. Playback and downloads therefore keep every request short: the
// browser fetches media in Range chunks and the client-side downloader does the same.
export const maxDuration = 60;

/** GET /api/stream?video_id={id}
 *   -> JSON: { success, video_id, title, artist, thumbnail, duration, audio_url | null }
 *      (this is the endpoint the client's `probeNative()` hits to decide between the
 *       native Web Audio engine and the YouTube IFrame fallback — it must keep
 *       answering JSON so that probe still works)
 * GET /api/stream?video_id={id}&play=1
 *   -> proxied audio bytes with HTTP Range passthrough so seeking/scrubbing works
 *      on a plain HTML5 <audio> element, same-origin for Web Audio.
 * GET /api/stream?video_id={id}&play=1&download=1[&title=&artist=]
 *   -> same bytes, served as an attachment with a real file name/extension. */
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
      mime_type: resolved.mimeType ?? null,
      content_length: resolved.contentLength ?? null,
      audio_url: `/api/stream?video_id=${videoId}&play=1`,
      download_url: `/api/stream?video_id=${videoId}&play=1&download=1`,
    });
  }

  /* ---- proxy mode (audio bytes) ---- */
  const range = req.headers.get("range");
  const makeReq = (url: string) => {
    const headers: Record<string, string> = {
      accept: "*/*",
      // Media bytes must arrive as-is: a compressed body would break Content-Length,
      // Range arithmetic and the browser's ability to resume mid-file.
      "accept-encoding": "identity",
      "user-agent": req.headers.get("user-agent") || "Mozilla/5.0",
    };
    // Forward Range verbatim so partial requests map 1:1 to the CDN. When absent we
    // deliberately do NOT send `bytes=0-`: a full 200 response carries the real
    // Content-Length, which is how the browser derives `duration` for the seek bar.
    if (range) headers.range = range;
    // When the browser drops the connection (track change, seek, tab closed) the
    // upstream transfer is cancelled too instead of running to the end for nobody.
    return fetch(url, { headers, cache: "no-store", redirect: "follow", signal: req.signal });
  };

  if (resolved) {
    let current: ResolvedAudio = resolved;
    let upstream = await makeReq(current.url).catch(() => null);

    // Deciphered URLs are short-lived and bound to the resolving IP (each serverless
    // instance has its own): 403/410 — or a dead connection — means re-resolve once
    // and retry with a URL minted for *this* instance.
    const stale = !upstream || upstream.status === 403 || upstream.status === 410;
    if (stale && !req.signal.aborted) {
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
      // Only a full-body 200 may borrow the resolver's size; on a 206 the real length
      // is that of the slice, and a wrong Content-Length makes browsers drop the stream.
      if (!out.has("content-length") && upstream.status === 200 && current.contentLength) {
        out.set("content-length", String(current.contentLength));
      }
      out.set("cache-control", "no-store");

      if (req.nextUrl.searchParams.get("download") === "1") {
        const title = req.nextUrl.searchParams.get("title") || current.title || videoId;
        const artist = req.nextUrl.searchParams.get("artist") || current.artist || "";
        out.set(
          "content-disposition",
          contentDisposition(downloadFileName(title, artist, out.get("content-type")))
        );
      }
      return new Response(upstream.body, { status: upstream.status, headers: out });
    }
  }

  return NextResponse.json(
    { success: false, error: "stream_unavailable", video_id: videoId },
    { status: 503 }
  );
}
