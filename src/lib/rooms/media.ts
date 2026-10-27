import type { CallMode } from "./logic";

/**
 * Pure WebRTC media tuning for Listen Together calls.
 *
 * Nothing in here touches the DOM or imports a browser-only module: the room
 * model, the call engine and the Node unit tests can all share these helpers.
 * The engine in `voice.ts` uses them to ask the camera for the highest
 * resolution it can deliver, to keep the encode/decode pipeline low-latency,
 * and to advertise a bitrate high enough for real 4K (not a 4K-labelled 480p).
 */

/** 3840 × 2160 ("4K UHD") at up to 60 fps. */
export const VIDEO_WIDTH = 3840;
export const VIDEO_HEIGHT = 2160;
export const VIDEO_FPS = 60;

/**
 * 24 Mbps is a realistic ceiling for 4K/60 with VP9 or H.264 High. It is
 * deliberately a *ceiling*: `targetBitrate()` scales it down to the measured
 * available bandwidth so a 4K stream never queues up behind a slow link (that
 * queue is what people experience as "video lag").
 */
export const VIDEO_MAX_BITRATE = 24_000_000;
/** Below this, 4K is not worth attempting; the encoder keeps resolution but spends fewer bits. */
export const VIDEO_MIN_BITRATE = 6_000_000;
/** SDP `b=AS` is expressed in kilobits per second. */
export const VIDEO_BANDWIDTH_KBPS = Math.floor(VIDEO_MAX_BITRATE / 1000);

/** Opus: a slightly wider pipe for video calls, still mono and low-latency. */
export const AUDIO_BITRATE_VOICE = 64_000;
export const AUDIO_BITRATE_VIDEO = 96_000;

/**
 * Camera ladder, best first. `ideal` (never `exact`/`min`) means a 1080p
 * webcam still connects — the browser picks the closest mode it actually has.
 * Resolution is listed before frame rate so a camera that can do 4K/30 but
 * only 1080p/60 does not silently drop to 1080p.
 */
export const VIDEO_CONSTRAINTS: MediaTrackConstraints[] = [
  {
    width: { ideal: VIDEO_WIDTH },
    height: { ideal: VIDEO_HEIGHT },
    frameRate: { ideal: VIDEO_FPS, max: VIDEO_FPS },
    aspectRatio: { ideal: 16 / 9 },
  },
  {
    width: { ideal: VIDEO_WIDTH },
    height: { ideal: VIDEO_HEIGHT },
    frameRate: { ideal: 30, max: 30 },
    aspectRatio: { ideal: 16 / 9 },
  },
  { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } },
  { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
  { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
];

/**
 * 4K-friendly codec order. VP9/H.264 have the widest hardware-encode support
 * (a software 4K encoder is the single biggest source of added latency);
 * AV1 and VP8 remain available as fallbacks. A stable sort keeps the browser's
 * own ordering inside each group.
 */
const CODEC_PRIORITY = ["video/vp9", "video/h264", "video/av1", "video/vp8"];

export function orderVideoCodecs<T extends { mimeType: string }>(codecs: T[]): T[] {
  const rank = (c: T) => {
    const i = CODEC_PRIORITY.indexOf(c.mimeType.toLowerCase());
    return i < 0 ? CODEC_PRIORITY.length : i;
  };
  return [...codecs].sort((a, b) => rank(a) - rank(b));
}

/**
 * Rewrites a local SDP before `setLocalDescription`.
 *
 * Audio (both modes): 10 ms Opus frames, no in-band FEC and no stereo
 * padding. FEC buys robustness by delaying playout by a frame, so turning it
 * off removes that frame from the mouth-to-ear path.
 *
 * Video (video calls only): a media-level `b=AS`/`b=TIAS` ceiling high enough
 * for 4K. Browsers that ignore `RTCRtpSender.setParameters()` still honour
 * the SDP bandwidth line, so 4K is not throttled to the browser's default.
 */
export function tuneSdp(sdp: string, mode: CallMode): string {
  if (!sdp) return sdp;
  const eol = sdp.includes("\r\n") ? "\r\n" : "\n";
  const lines = sdp.split(/\r\n|\n/).filter((line) => line.length > 0);
  const preamble: string[] = [];
  const sections: string[][] = [];
  let current: string[] | null = null;
  for (const line of lines) {
    if (line.startsWith("m=")) {
      current = [line];
      sections.push(current);
    } else if (current) {
      current.push(line);
    } else {
      preamble.push(line);
    }
  }

  const tuned = sections.map((section) => {
    const mLine = section[0] ?? "";
    const isAudio = mLine.startsWith("m=audio ");
    const isVideo = mLine.startsWith("m=video ");
    let body = section.slice(1);

    if (isAudio) {
      body = body.filter((line) => !/^a=ptime:/i.test(line));
      const opus = body.find((line) => /^a=rtpmap:\d+\s+opus\/48000\/2/i.test(line));
      const pt = opus?.match(/^a=rtpmap:(\d+)/i)?.[1];
      if (pt) {
        const prefix = `a=fmtp:${pt} `;
        const overrides = ["minptime=10", "useinbandfec=0", "stereo=0", "cbr=0"];
        const overridden = new Set(overrides.map((p) => p.split("=")[0]));
        const at = body.findIndex((line) => line.startsWith(prefix));
        const params = (at >= 0 ? body[at].slice(prefix.length) : "")
          .split(";")
          .filter(Boolean)
          .filter((p) => !overridden.has(p.split("=")[0].trim().toLowerCase()));
        const fmtp = `${prefix}${[...params, ...overrides].join(";")}`;
        if (at >= 0) body[at] = fmtp;
        else body.push(fmtp);
      }
      // SDP orders media lines as m, i, c, b, k, a — so ptime belongs with the
      // attribute block at the end, not immediately after the m= line.
      body.push("a=ptime:10");
      return [mLine, ...body];
    }

    if (isVideo && mode === "video") {
      const clean = body.filter((line) => !/^b=(AS|TIAS):/i.test(line));
      // Bandwidth is a media-level line that must follow the `c=` connection
      // line (RFC 4566 §5); strict SDP parsers reject it before `c=`.
      const at = clean.findIndex((line) => /^c=/i.test(line));
      clean.splice(at >= 0 ? at + 1 : 0, 0, `b=AS:${VIDEO_BANDWIDTH_KBPS}`, `b=TIAS:${VIDEO_MAX_BITRATE}`);
      return [mLine, ...clean];
    }

    return section;
  });

  return [...preamble, ...tuned.flat()].join(eol) + eol;
}

/**
 * Choose the video send bitrate from Chrome's `availableOutgoingBitrate`
 * estimate. Aim for 4K, back off when the link is congested (queued packets =
 * latency), and only move on a meaningful change so `setParameters()` is not
 * thrashed every stats tick.
 */
export function targetBitrate(availableBps: number, current: number): number {
  const ceiling = VIDEO_MAX_BITRATE;
  if (!Number.isFinite(availableBps) || availableBps <= 0) return ceiling;
  const wanted = Math.max(VIDEO_MIN_BITRATE, Math.min(ceiling, Math.floor(availableBps * 0.85)));
  if (Math.abs(wanted - current) < current * 0.12) return current;
  return wanted;
}

/** Human-readable label for the resolution actually arriving from the peer. */
export function qualityLabel(width: number, height: number): string {
  const long = Math.max(width, height);
  if (long >= 3840) return "4K UHD";
  if (long >= 2560) return "QHD";
  if (long >= 1920) return "1080p";
  if (long >= 1280) return "720p";
  if (long >= 640) return "SD";
  return "Connecting";
}
