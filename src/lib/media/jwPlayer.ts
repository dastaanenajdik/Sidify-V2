/**
 * JW Player integration for the movies/series "Try Play" route.
 *
 * JW Player is a commercial player: its library is *not* bundled or copied
 * here. This module is only Sidify's own adapter code — it loads the
 * deployer's own JW Player library at runtime, from the URL configured in
 * `NEXT_PUBLIC_JWPLAYER_LIBRARY_URL` (JW Dashboard → Players → your player's
 * library URL, e.g. `https://cdn.jwplayer.com/libraries/<id>.js`), and maps
 * Sidify's resolved candidates onto JW's public `setup()` playlist API.
 *
 * When no library URL is configured, `isJwConfigured()` is false and the
 * Try Play sheet keeps using the built-in Shaka engine, so playback keeps
 * working without a JW account. Nothing about link resolution changes either
 * way — both engines receive the exact same resolved URLs.
 *
 * Why JW helps with "video chalti hai, audio nahi aata": for HLS, JW keeps
 * every `#EXT-X-MEDIA:TYPE=AUDIO` rendition selectable in its own control
 * bar and never starts a variant without its audio group, and for
 * progressive MP4 it surfaces the file's audio tracks the same way. The
 * sheet still verifies sound (decoder counters / JW audio-track list)
 * before accepting a link, so a genuinely silent encode (e.g. an MKV with
 * only E-AC-3 audio, which no browser player — JW included — can decode)
 * still falls through to the next quality, VLC and Download.
 *
 * Framework-free apart from DOM access inside functions, so the pure
 * helpers run in the Node test suite.
 */

/* ------------------------------ configuration ----------------------------- */

/** Hosted JW libraries are only ever served from these hosts. */
const JW_LIBRARY_HOSTS = ["cdn.jwplayer.com", "ssl.p.jwpcdn.com", "content.jwplatform.com"];

/**
 * Validate a configured JW library URL: HTTPS only, no credentials, and on a
 * real JW host. Returns the normalised URL or `null` when the value is
 * missing or not a JW library — an env typo must never turn into loading an
 * arbitrary third-party script on the movie pages.
 */
export function resolveJwLibraryUrl(raw: string | undefined | null): string | null {
  const value = (raw || "").trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase();
  const onJwHost = JW_LIBRARY_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  if (!onJwHost) return null;
  if (!parsed.pathname.toLowerCase().endsWith(".js")) return null;
  return parsed.toString();
}

/** The configured JW library URL for this deployment, or `null`. */
export function getJwLibraryUrl(): string | null {
  if (typeof process === "undefined") return null;
  return resolveJwLibraryUrl(process.env.NEXT_PUBLIC_JWPLAYER_LIBRARY_URL);
}

/** True when the operator has wired up their own JW Player library. */
export function isJwConfigured(): boolean {
  return getJwLibraryUrl() !== null;
}

/* ------------------------- candidate → JW source ------------------------ */

export type JwSourceType = "hls" | "dash" | "mp4" | "webm";

export interface JwCandidateLike {
  url: string;
  streamType?: "hls" | "dash" | "mp4" | "webm" | null;
  container?: string | null;
  fileName?: string | null;
  kind?: "hls" | "file" | null;
}

const JW_CONTAINER_TYPES: Record<string, JwSourceType> = {
  M3U8: "hls",
  HLS: "hls",
  MPD: "dash",
  DASH: "dash",
  MP4: "mp4",
  M4V: "mp4",
  WEBM: "webm",
};

/** Containers no browser player (JW included) can open — never hand these to JW. */
const JW_UNSUPPORTED_CONTAINERS = new Set(["MKV", "AVI", "TS", "ZIP", "RAR", "7Z"]);

function extensionOf(text?: string | null): string | undefined {
  const match = String(text || "").split(/[?#]/)[0].match(/\.(m3u8|mpd|mp4|m4v|webm|mkv|avi|ts|zip|rar|7z)$/i);
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Which JW source `type` a candidate should be declared with, or `null` when
 * JW cannot play it at all (MKV/AVI/archive). Extension beats labels; an
 * extension-less file URL falls back to the release's container, then to MP4
 * (the catalogue's extension-less direct files are MP4-family serves).
 */
export function jwSourceType(candidate: JwCandidateLike): JwSourceType | null {
  const containerHint = String(candidate.container || "").toUpperCase();
  const urlExt = extensionOf(candidate.url);
  const nameExt = extensionOf(candidate.fileName);

  if (urlExt && JW_UNSUPPORTED_CONTAINERS.has(urlExt)) return null;
  if (nameExt && JW_UNSUPPORTED_CONTAINERS.has(nameExt) && !urlExt) return null;
  if (containerHint && JW_UNSUPPORTED_CONTAINERS.has(containerHint) && !urlExt) return null;

  if (candidate.streamType && candidate.streamType in { hls: 1, dash: 1, mp4: 1, webm: 1 }) {
    return candidate.streamType as JwSourceType;
  }
  if (candidate.kind === "hls") return "hls";
  if (urlExt && JW_CONTAINER_TYPES[urlExt]) return JW_CONTAINER_TYPES[urlExt];
  if (containerHint && JW_CONTAINER_TYPES[containerHint]) return JW_CONTAINER_TYPES[containerHint];
  if (nameExt && JW_CONTAINER_TYPES[nameExt]) return JW_CONTAINER_TYPES[nameExt];
  return "mp4";
}

/** True when JW Player can be asked to attempt this candidate. */
export function isJwPlayableCandidate(candidate: JwCandidateLike): boolean {
  return jwSourceType(candidate) !== null;
}

export interface JwPlaylistItem {
  title?: string;
  image?: string;
  sources: Array<{ file: string; type: JwSourceType; label?: string; default?: boolean }>;
}

/** One resolved candidate as a JW `setup()` playlist item (JW Player format). */
export function buildJwPlaylistItem(input: {
  candidate: JwCandidateLike;
  title?: string;
  poster?: string;
  qualityLabel?: string;
}): JwPlaylistItem | null {
  const type = jwSourceType(input.candidate);
  if (!type) return null;
  return {
    title: input.title || undefined,
    image: input.poster || undefined,
    sources: [{ file: input.candidate.url, type, label: input.qualityLabel || undefined, default: true }],
  };
}

/* ------------------------------ track mapping ----------------------------- */

export interface JwTrackOption {
  /** Index in JW's own track list (`setCurrentAudioTrack` / `setCurrentCaptions`). */
  index: number;
  label: string;
  language?: string;
  active: boolean;
}

type JwRawTrack = { label?: string; name?: string; language?: string } | null | undefined;

/** JW `getAudioTracks()` entries → sheet chip options. */
export function mapJwAudioTracks(raw: readonly JwRawTrack[] | null | undefined, currentIndex: number): JwTrackOption[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((track, index) => ({
    index,
    label: track?.label || track?.name || track?.language || `Audio ${index + 1}`,
    language: track?.language,
    active: index === currentIndex,
  }));
}

/** JW `getCaptionsList()` entries → sheet chip options (entry 0 is "Off"). */
export function mapJwCaptionTracks(raw: readonly JwRawTrack[] | null | undefined, currentIndex: number): JwTrackOption[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((track, index) => ({
      index,
      label: track?.label || track?.language || (index === 0 ? "Off" : `Subtitles ${index}`),
      language: track?.language,
      active: index === currentIndex,
    }))
    .filter((track) => track.index !== 0);
}

/** Classify a JW error message the way the fallback loop expects. */
export function classifyJwError(message?: string | null): "network" | "decode" {
  const text = String(message || "").toLowerCase();
  if (/network|load|404|403|401|cors|cross|manifest|hls.*(?:error|fail)|playlist/.test(text)) return "network";
  return "decode";
}

/* ------------------------------ library loader ---------------------------- */

export interface JwPlayerInstance {
  setup: (options: Record<string, unknown>) => JwPlayerInstance;
  on: (event: string, callback: (event: Record<string, unknown>) => void) => JwPlayerInstance;
  once?: (event: string, callback: (event: Record<string, unknown>) => void) => JwPlayerInstance;
  play: (toggle?: boolean) => void;
  pause: (toggle?: boolean) => void;
  seek: (seconds: number) => void;
  getPosition: () => number;
  getDuration: () => number;
  getState: () => string;
  getAudioTracks?: () => Array<Record<string, unknown>>;
  getCurrentAudioTrack?: () => number;
  setCurrentAudioTrack?: (index: number) => void;
  getCaptionsList?: () => Array<Record<string, unknown>>;
  getCurrentCaptions?: () => number;
  setCurrentCaptions?: (index: number) => void;
  getContainer?: () => HTMLElement;
  remove: () => void;
}

export type JwPlayerFactory = (id: string) => JwPlayerInstance;

declare global {
  interface Window {
    jwplayer?: JwPlayerFactory;
  }
}

let libraryPromise: Promise<JwPlayerFactory> | null = null;

/**
 * Load the operator's JW library once and hand back `window.jwplayer`.
 * Rejects when the URL is unset/invalid or the script fails, so the sheet
 * can fall back to the built-in engine instead of stranding the viewer.
 */
export function loadJwPlayerLibrary(libraryUrl: string | null = getJwLibraryUrl()): Promise<JwPlayerFactory> {
  if (typeof window !== "undefined" && typeof window.jwplayer === "function") {
    return Promise.resolve(window.jwplayer);
  }
  if (!libraryUrl) return Promise.reject(new Error("JW Player is not configured"));
  if (libraryPromise) return libraryPromise;

  libraryPromise = new Promise<JwPlayerFactory>((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("JW Player can only load in a browser"));
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[data-jwplayer-library="1"]`);
    const script = existing ?? document.createElement("script");
    const done = () => {
      if (typeof window !== "undefined" && typeof window.jwplayer === "function") resolve(window.jwplayer);
      else reject(new Error("JW Player library did not initialise"));
    };
    script.addEventListener("load", done, { once: true });
    script.addEventListener(
      "error",
      () => {
        libraryPromise = null;
        reject(new Error("JW Player library failed to load"));
      },
      { once: true }
    );
    if (!existing) {
      script.dataset.jwplayerLibrary = "1";
      script.async = true;
      script.src = libraryUrl;
      document.head.appendChild(script);
    }
  });
  return libraryPromise;
}

/** Test seam: forget a failed/loaded library so a new URL can be tried. */
export function resetJwLibraryForTests(): void {
  libraryPromise = null;
}
