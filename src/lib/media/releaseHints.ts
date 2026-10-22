/**
 * Codec / container *hints* read from a release file name or label.
 *
 * These are guesses from text such as `…2160p WEB-DL DoVi HDR 10bit HEVC [Hindi DDP 5.1]…`.
 * They are NOT verified stream properties: the real tracks are only known once a player
 * opens the file. The UI must present them as "from the file name", never as a promise
 * that something will (or will not) play.
 *
 * Framework-free and browser-safe (no cheerio / node imports) so client components and
 * the Node test runner can both use it.
 */

export type VideoCodecHint = "av1" | "hevc" | "h264" | "vp9";
export type AudioCodecHint = "eac3" | "ac3" | "truehd" | "dts" | "aac" | "opus" | "flac";
export type HdrHint = "dv" | "hdr10+" | "hdr";

export interface ReleaseHints {
  video?: VideoCodecHint;
  tenBit: boolean;
  hdr?: HdrHint;
  /** Unique audio codec hints in order of appearance. */
  audio: AudioCodecHint[];
  atmos: boolean;
  remux: boolean;
  /** Upper-case container extension (`MKV`, `MP4`, `ZIP`, …) when the name has one. */
  container?: string;
}

const AUDIO_PATTERNS: [AudioCodecHint, RegExp][] = [
  // Dolby Digital Plus: DDP5.1, DDP 5.1, DD+5.1, DD+ 5.1, E-AC-3, EAC3, "Dolby Digital Plus"
  ["eac3", /\bDDP(?:\d|\b)|\bDD\+|\bE-?AC-?3\b|Dolby\s*Digital\s*Plus/gi],
  // Dolby Digital: DD5.1, DD 5.1, AC3, AC-3, "Dolby Digital" (but not DDP / DD+ / E-AC-3)
  ["ac3", /\bDD\s?\d\.\d|\bDD(?![+P\w])|(?<![E-])\bAC-?3\b|Dolby\s*Digital(?!\s*Plus)/gi],
  ["truehd", /\bTrue-?HD\b/gi],
  ["dts", /\bDTS(?:-?HD|-?X|:X|-?MA|-?ES)?\b/gi],
  ["aac", /\bAAC/gi],
  ["opus", /\bOpus\b/gi],
  ["flac", /\bFLAC\b/gi],
];

/** Read codec hints from free text (title, label, file name). */
export function parseReleaseHints(...texts: (string | undefined | null)[]): ReleaseHints {
  const text = texts.filter(Boolean).join(" ");

  let video: VideoCodecHint | undefined;
  if (/\bAV1\b/i.test(text)) video = "av1";
  else if (/\bHEVC\b|\bH\.?265\b|\bx265\b/i.test(text)) video = "hevc";
  else if (/\bAVC\b|\bH\.?264\b|\bx264\b/i.test(text)) video = "h264";
  else if (/\bVP9\b/i.test(text)) video = "vp9";

  let hdr: HdrHint | undefined;
  if (/\bDV\b|\bDoVi\b|Dolby\s*Vision/i.test(text)) hdr = "dv";
  else if (/HDR10(?:\+|P(?:lus)?\b)/i.test(text)) hdr = "hdr10+";
  else if (/\bHDR(?:10)?\b/i.test(text)) hdr = "hdr";

  const found: { codec: AudioCodecHint; at: number }[] = [];
  for (const [codec, pattern] of AUDIO_PATTERNS) {
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) found.push({ codec, at: match.index });
  }
  found.sort((a, b) => a.at - b.at);

  return {
    video,
    tenBit: /\b10[-\s]?bit\b/i.test(text),
    hdr,
    audio: found.map((f) => f.codec),
    atmos: /\bAtmos\b/i.test(text),
    remux: /\bREMUX\b/i.test(text),
    container: detectContainerHint(text),
  };
}

/** Extension-based container hint, e.g. `MKV` for `…x265.mkv`. */
export function detectContainerHint(text: string): string | undefined {
  const match = String(text || "").match(/\.(mkv|mp4|m4v|webm|m3u8|avi|mov|ts|zip|rar|7z)(?=$|[?#\s)"'\]])/i);
  return match ? match[1].toUpperCase() : undefined;
}

const VIDEO_LABEL: Record<VideoCodecHint, string> = { av1: "AV1", hevc: "HEVC", h264: "H.264", vp9: "VP9" };
const AUDIO_LABEL: Record<AudioCodecHint, string> = {
  eac3: "DDP",
  ac3: "DD",
  truehd: "TrueHD",
  dts: "DTS",
  aac: "AAC",
  opus: "Opus",
  flac: "FLAC",
};
const HDR_LABEL: Record<HdrHint, string> = { dv: "DV", "hdr10+": "HDR10+", hdr: "HDR" };

/** Short chips such as `["HEVC", "10-bit", "DV", "DDP", "Atmos"]` for display. */
export function hintChips(hints: ReleaseHints): string[] {
  const chips: string[] = [];
  if (hints.video) chips.push(VIDEO_LABEL[hints.video]);
  if (hints.tenBit) chips.push("10-bit");
  if (hints.hdr) chips.push(HDR_LABEL[hints.hdr]);
  for (const codec of hints.audio) chips.push(AUDIO_LABEL[codec]);
  if (hints.atmos) chips.push("Atmos");
  if (hints.remux) chips.push("REMUX");
  return chips;
}

/** What the current browser *reports* it can decode (`canPlayType`), not a guarantee. */
export interface BrowserCapabilities {
  h264: boolean;
  hevc: boolean;
  av1: boolean;
  vp9: boolean;
  aac: boolean;
  ac3: boolean;
  eac3: boolean;
  opus: boolean;
  /**
   * `true` when `canPlayType("video/x-matroska")` reports support, otherwise `null`
   * (unknown — older Chromium answered "" yet played MKV fine).
   */
  mkv: true | null;
  /**
   * The engine exposes live decoder byte counters (`webkitAudioDecodedByteCount`), so
   * Try Play can check at runtime that a file's sound really decodes. Chromium only.
   */
  audioCounters?: boolean;
}

/** Whether the browser *reports* it can decode an audio codec named in a file name. */
const AUDIO_DECODABLE: Record<AudioCodecHint, (caps: BrowserCapabilities) => boolean> = {
  aac: (caps) => caps.aac,
  opus: (caps) => caps.opus,
  flac: () => true,
  eac3: (caps) => caps.eac3,
  ac3: (caps) => caps.ac3,
  // No mainstream browser decodes these.
  truehd: () => false,
  dts: () => false,
};

/**
 * True when every audio codec the file name mentions is one this browser reports it can't
 * decode (typically `[Hindi DD 5.1 + English DDP 5.1]` in Chrome / Firefox). A guess from
 * text: Try Play only uses it to try such releases after the others — whether a file
 * really has sound is decided by runtime checks, never by this.
 */
export function predictSilentAudio(hints: ReleaseHints, caps: BrowserCapabilities | null): boolean {
  if (!caps || hints.audio.length === 0) return false;
  return hints.audio.every((codec) => !AUDIO_DECODABLE[codec](caps));
}

/**
 * Soft, hedged notes that combine file-name hints with reported browser capabilities.
 * Wording is deliberately "may": neither input is verified. (Where the engine has live
 * decoder counters, Try Play checks the sound at runtime instead; these notes stay hints.)
 */
export function compatibilityNotes(hints: ReleaseHints, caps: BrowserCapabilities | null): string[] {
  if (!caps) return [];
  const notes: string[] = [];

  if (hints.video === "hevc" && !caps.hevc) {
    notes.push("The file name suggests HEVC video, which this browser reports it can't decode — the picture may not play.");
  } else if (hints.video === "av1" && !caps.av1) {
    notes.push("The file name suggests AV1 video, which this browser reports it can't decode — the picture may not play.");
  }

  const dolbyUnsupported = hints.audio.some((a) => (a === "eac3" && !caps.eac3) || (a === "ac3" && !caps.ac3));
  if (dolbyUnsupported) {
    notes.push("The file name mentions Dolby (DD/DDP) audio, which this browser reports it can't decode — there may be no sound.");
  }
  if (hints.audio.some((a) => a === "dts" || a === "truehd")) {
    notes.push("The file name mentions DTS/TrueHD audio, which browsers generally don't decode — there may be no sound.");
  }
  return notes;
}
