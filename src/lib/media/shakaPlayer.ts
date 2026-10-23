import type { shaka as ShakaNamespace } from "shaka-player/dist/shaka-player.experimental.js";
import { hasLiveDecoderCounters, probeBrowserCapabilities, type CanPlayTypeProbe } from "./browserCaps";
import { loadEac3DecoderModule } from "./dolbyFlacTranscoder";
import { parseReleaseHints, type BrowserCapabilities } from "./releaseHints";
import {
  isFlacInMp4MseSupported,
  isMseMimeSupported,
  registerShakaDolbyTransmuxers,
} from "./shakaDolbyTransmuxer";
import {
  registerShakaMp4MseParser,
  SIDIFY_MP4_MSE_MIME,
} from "./shakaMp4Parser";
import {
  buildMediaStreamProxyUrl,
  isAllowedStreamEntryHost,
  MEDIA_STREAM_FINAL_URL_HEADER,
  shouldProxyCrossOriginMediaUrl,
  unwrapMediaStreamProxyUrl,
} from "./streamProxyUrl";
import type { PlaybackSource } from "./types";

type PlaybackStreamType = PlaybackSource["type"];

export type ShakaRuntime = typeof ShakaNamespace;
export type ShakaLoader = () => Promise<{ default?: ShakaRuntime; shaka?: ShakaRuntime } | ShakaRuntime>;

export interface ShakaAudioTrackOption {
  id: number;
  audioId: number | null;
  language: string;
  label: string;
  codec: string | null;
  channelsCount: number | null;
  active: boolean;
}

export interface ShakaTextTrackOption {
  id: number;
  language: string;
  label: string;
  active: boolean;
}

export type ShakaFailureKind = "network" | "decode";

export interface ShakaErrorEvent {
  kind: ShakaFailureKind;
  category: number | null;
  code: number | null;
  detail: string;
}

export interface AttachShakaOptions {
  url: string;
  streamType?: PlaybackStreamType | string | null;
  container?: string | null;
  fileName?: string | null;
  startAt?: number | null;
  preferredAudioLanguages?: string[];
  /** Explicit browser origin override (defaults to `window.location.origin` in browsers). */
  proxyOrigin?: string | null;
  signal?: AbortSignal;
  loader?: ShakaLoader;
  onTracksChanged?: (tracks: {
    audio: ShakaAudioTrackOption[];
    text: ShakaTextTrackOption[];
  }) => void;
  onFatalError?: (err: ShakaErrorEvent) => void;
}

export interface ShakaPlaybackHandle {
  mode: "shaka-mse" | "shaka-src" | "unsupported";
  mimeType: string;
  player: ShakaNamespace.Player | null;
  hasAudioTrack: () => boolean;
  getAudioTracks: () => ShakaAudioTrackOption[];
  selectAudioTrack: (variantTrackId: number) => void;
  getTextTracks: () => ShakaTextTrackOption[];
  selectTextTrack: (textTrackId: number | null) => Promise<void>;
  upgradeProgressiveMp4ToMse: (resumeAt?: number) => Promise<boolean>;
  destroy: () => Promise<void>;
}

const LANGUAGE_LABELS: Record<string, string> = {
  hi: "Hindi",
  hin: "Hindi",
  en: "English",
  eng: "English",
  ta: "Tamil",
  tam: "Tamil",
  te: "Telugu",
  tel: "Telugu",
  ml: "Malayalam",
  mal: "Malayalam",
  kn: "Kannada",
  kan: "Kannada",
  bn: "Bengali",
  ben: "Bengali",
  mr: "Marathi",
  mar: "Marathi",
  pa: "Punjabi",
  pan: "Punjabi",
  gu: "Gujarati",
  guj: "Gujarati",
  ur: "Urdu",
  urd: "Urdu",
  ja: "Japanese",
  jpn: "Japanese",
  ko: "Korean",
  kor: "Korean",
  es: "Spanish",
  spa: "Spanish",
  fr: "French",
  fra: "French",
  de: "German",
  deu: "German",
  it: "Italian",
  ita: "Italian",
  pt: "Portuguese",
  por: "Portuguese",
  ru: "Russian",
  rus: "Russian",
  zh: "Chinese",
  zho: "Chinese",
  und: "Default Audio",
};

function formatLanguageName(code: string | null | undefined, fallbackIndex?: number): string {
  const clean = (code || "").trim().toLowerCase();
  if (!clean || clean === "und") {
    return fallbackIndex !== undefined ? `Track ${fallbackIndex + 1}` : "Default";
  }
  const base = clean.split("-")[0];
  if (LANGUAGE_LABELS[clean]) return LANGUAGE_LABELS[clean];
  if (LANGUAGE_LABELS[base]) return LANGUAGE_LABELS[base];
  return clean.toUpperCase();
}

function formatChannelBadge(channels: number | null | undefined): string {
  if (!channels || channels <= 0) return "";
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return `${channels}ch`;
}

const defaultShakaLoader: ShakaLoader = () =>
  import("shaka-player/dist/shaka-player.experimental.js");

let cachedDefaultShakaPromise: Promise<ShakaRuntime | null> | null = null;
const initializedRuntimes = new WeakSet<object>();
let mediaCapabilitiesPatched = false;

/**
 * Ensures `navigator.mediaCapabilities.decodingInfo` accepts multi-channel (`channels > 2`)
 * FLAC-in-MP4 configurations by falling back to `channels: 2` when our Dolby-to-FLAC
 * transcoder downmixes 5.1/7.1 surround streams to stereo.
 */
function installFlacMediaCapabilitiesGuard(): void {
  if (mediaCapabilitiesPatched || typeof navigator === "undefined") return;
  const mc = navigator.mediaCapabilities;
  if (!mc || typeof mc.decodingInfo !== "function") return;
  mediaCapabilitiesPatched = true;

  const originalDecodingInfo = mc.decodingInfo.bind(mc);
  try {
    mc.decodingInfo = async (configuration: MediaDecodingConfiguration) => {
      const result = await originalDecodingInfo(configuration);
      if (result.supported) return result;

      const audioCfg = configuration?.audio;
      if (
        audioCfg &&
        typeof audioCfg.contentType === "string" &&
        audioCfg.contentType.toLowerCase().includes("flac") &&
        audioCfg.channels &&
        Number(audioCfg.channels) > 2
      ) {
        return originalDecodingInfo({
          ...configuration,
          audio: {
            ...audioCfg,
            channels: "2",
          },
        });
      }
      return result;
    };
  } catch {
    // Some locked-down environments make navigator.mediaCapabilities.decodingInfo read-only
  }
}

function unwrapShakaModule(mod: unknown): ShakaRuntime | null {
  if (!mod || typeof mod !== "object") return null;
  const record = mod as Record<string, unknown>;
  if (record.Player && typeof record.Player === "function") {
    return mod as ShakaRuntime;
  }
  if (record.shaka && typeof record.shaka === "object") {
    return record.shaka as ShakaRuntime;
  }
  if (record.default && typeof record.default === "object") {
    return unwrapShakaModule(record.default);
  }
  return null;
}

/**
 * Loads and initializes the Shaka Player runtime once on the client:
 * - Installs browser polyfills (`shaka.polyfill.installAll()`)
 * - Registers Dolby (`ec-3` / `ac-3`) WASM -> FLAC-in-fMP4 transmuxers
 * - Registers progressive MP4-over-MSE fallback parser
 * - Pre-warms `@audio/decode-eac3` WASM binary
 */
export async function ensureShakaInitialized(
  customLoader?: ShakaLoader,
): Promise<ShakaRuntime | null> {
  if (!customLoader && typeof window === "undefined") {
    return null;
  }

  let shaka: ShakaRuntime | null = null;
  if (customLoader) {
    try {
      const loaded = await customLoader();
      shaka = unwrapShakaModule(loaded);
    } catch {
      return null;
    }
  } else {
    if (!cachedDefaultShakaPromise) {
      cachedDefaultShakaPromise = defaultShakaLoader()
        .then((loaded) => unwrapShakaModule(loaded))
        .catch(() => {
          cachedDefaultShakaPromise = null;
          return null;
        });
    }
    shaka = await cachedDefaultShakaPromise;
  }

  if (!shaka) return null;

  if (!initializedRuntimes.has(shaka)) {
    initializedRuntimes.add(shaka);
    try {
      shaka.polyfill?.installAll?.();
    } catch {
      // Ignore polyfill warning on restricted globals
    }
    installFlacMediaCapabilitiesGuard();
    registerShakaDolbyTransmuxers(shaka);
    registerShakaMp4MseParser(shaka);
    if (!customLoader && typeof window !== "undefined") {
      void loadEac3DecoderModule().catch(() => {});
    }
  }

  return shaka;
}

/**
 * Browser codec capabilities augmented with Shaka Player + WASM Dolby (`ec-3` / `ac-3`) support.
 */
export function probeShakaCapabilities(
  video?: CanPlayTypeProbe | null,
): BrowserCapabilities | null {
  const base = probeBrowserCapabilities(video);
  if (!base) return null;
  if (isFlacInMp4MseSupported() || isMseMimeSupported('audio/mp4; codecs="ec-3"')) {
    return {
      ...base,
      mkv: true,
      ac3: true,
      eac3: true,
    };
  }
  return base;
}

/**
 * Resolves an explicit MIME type for `shaka.Player.load(uri, startTime, mimeType)` so
 * extensionless signed CDN URLs never trigger Shaka's fallback full-file GET sniff.
 */
export function resolveShakaMimeType(opts: {
  url: string;
  streamType?: PlaybackStreamType | string | null;
  container?: string | null;
  fileName?: string | null;
}): string | null {
  const st = (opts.streamType || "").trim().toLowerCase();
  if (st === "hls") return "application/x-mpegurl";
  if (st === "dash") return "application/dash+xml";

  const container = (opts.container || "").trim().toUpperCase();
  if (container === "HLS" || container === "M3U8") return "application/x-mpegurl";
  if (container === "DASH" || container === "MPD") return "application/dash+xml";
  if (container === "MKV" || container === "MATROSKA") return "video/x-matroska";
  if (container === "WEBM") return "video/webm";
  if (container === "MP4" || container === "M4V" || container === "MOV") return "video/mp4";
  if (container === "TS" || container === "M2TS") return "video/mp2t";

  const probeText = `${opts.fileName || ""} ${(opts.url || "").split(/[?#]/)[0]}`.toLowerCase();
  if (/\.m3u8(\b|$)/i.test(probeText)) return "application/x-mpegurl";
  if (/\.mpd(\b|$)/i.test(probeText)) return "application/dash+xml";
  if (/\.mkv(\b|$)/i.test(probeText)) return "video/x-matroska";
  if (/\.webm(\b|$)/i.test(probeText)) return "video/webm";
  if (/\.(mp4|m4v|mov)(\b|$)/i.test(probeText)) return "video/mp4";
  if (/\.(ts|m2ts)(\b|$)/i.test(probeText)) return "video/mp2t";

  if (st === "webm") return "video/webm";
  if (st === "mp4") return "video/mp4";

  return null;
}

function getCurrentBrowserOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const origin = window.location?.origin;
  if (!origin || !/^https?:\/\//i.test(origin)) return null;
  return origin;
}

/**
 * Installs request & response filters on a Shaka `Player`'s `NetworkingEngine` so cross-origin
 * mirror URLs (`*.r2.cloudflarestorage.com`, `pixel.hubcloud.ist`, `gpdl.hubcloud.ist`,
 * `pixeldrain.com`, etc.) stream through same-origin `/api/media/stream` with HTTP `Range`
 * and `302` redirect support — preventing browser CORS failures in MSE mode while preserving
 * the upstream URL on `response.uri` for relative HLS/DASH segment resolution.
 */
export function installPlayerCrossOriginProxy(
  player: ShakaNamespace.Player,
  proxyOrigin: string | null,
): () => void {
  if (!proxyOrigin) return () => {};
  const netEngine =
    typeof player.getNetworkingEngine === "function" ? player.getNetworkingEngine() : null;
  if (
    !netEngine ||
    typeof netEngine.registerRequestFilter !== "function" ||
    typeof netEngine.registerResponseFilter !== "function"
  ) {
    return () => {};
  }

  const resolvedFinalUrls = new Map<string, string>();

  const requestFilter: ShakaNamespace.extern.RequestFilter = (_type, request) => {
    if (!request?.uris?.length) return;
    request.uris = request.uris.map((rawUri) => {
      const cachedFinal = resolvedFinalUrls.get(rawUri);
      const targetUri = cachedFinal || rawUri;
      if (shouldProxyCrossOriginMediaUrl(targetUri, proxyOrigin)) {
        return buildMediaStreamProxyUrl(targetUri, proxyOrigin);
      }
      return rawUri;
    });
  };

  const responseFilter: ShakaNamespace.extern.ResponseFilter = (_type, response) => {
    if (!response) return;
    const unwrappedOriginal =
      unwrapMediaStreamProxyUrl(response.originalUri) ||
      unwrapMediaStreamProxyUrl(response.uri);
    if (!unwrappedOriginal) return;

    const headerFinalUrl = response.headers?.[MEDIA_STREAM_FINAL_URL_HEADER]?.trim();
    if (headerFinalUrl && /^https:\/\//i.test(headerFinalUrl)) {
      try {
        const finalHost = new URL(headerFinalUrl).hostname;
        if (headerFinalUrl !== unwrappedOriginal && isAllowedStreamEntryHost(finalHost)) {
          resolvedFinalUrls.set(unwrappedOriginal, headerFinalUrl);
        }
      } catch {
        // Ignore malformed final URL header
      }
      response.uri = headerFinalUrl;
    } else {
      response.uri = unwrappedOriginal;
    }
  };

  netEngine.registerRequestFilter(requestFilter);
  netEngine.registerResponseFilter(responseFilter);

  return () => {
    try {
      netEngine.unregisterRequestFilter?.(requestFilter);
      netEngine.unregisterResponseFilter?.(responseFilter);
    } catch {
      // NetworkingEngine may already be destroyed
    }
  };
}

/**
 * Performs a lightweight 64-byte HTTP Range magic-header check for extensionless URLs
 * whose container wasn't labeled by the resolver.
 */
export async function sniffStreamMagicMime(
  url: string,
  outerSignal?: AbortSignal,
  proxyOrigin?: string | null,
): Promise<string | null> {
  if (typeof fetch !== "function") return null;
  const effectiveOrigin = proxyOrigin !== undefined ? proxyOrigin : getCurrentBrowserOrigin();
  const fetchUrl = shouldProxyCrossOriginMediaUrl(url, effectiveOrigin)
    ? buildMediaStreamProxyUrl(url, effectiveOrigin)
    : url;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3500);
  const onOuterAbort = () => ctrl.abort();
  outerSignal?.addEventListener("abort", onOuterAbort, { once: true });

  try {
    const res = await fetch(fetchUrl, {
      method: "GET",
      headers: { Range: "bytes=0-63" },
      signal: ctrl.signal,
    });
    const contentType = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (contentType === "application/vnd.apple.mpegurl" || contentType === "application/x-mpegurl") {
      ctrl.abort();
      return "application/x-mpegurl";
    }
    if (contentType === "application/dash+xml") {
      ctrl.abort();
      return "application/dash+xml";
    }
    if (contentType === "video/x-matroska" || contentType === "audio/x-matroska") {
      ctrl.abort();
      return "video/x-matroska";
    }
    if (contentType === "video/webm") {
      ctrl.abort();
      return "video/webm";
    }
    if (contentType === "video/mp4") {
      ctrl.abort();
      return "video/mp4";
    }

    const reader = res.body?.getReader();
    if (!reader) return null;
    const chunk = await reader.read();
    void reader.cancel().catch(() => {});
    const bytes = chunk.value;
    if (!bytes || bytes.byteLength < 4) return null;

    // EBML magic bytes: 0x1A 0x45 0xDF 0xA3 (Matroska or WebM)
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
      const ascii = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(64, bytes.byteLength))).toLowerCase();
      return ascii.includes("webm") ? "video/webm" : "video/x-matroska";
    }

    // ISO BMFF ('ftyp', 'moov', 'mdat', 'free', 'styp')
    if (bytes.byteLength >= 8) {
      const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
      if (boxType === "ftyp" || boxType === "moov" || boxType === "mdat" || boxType === "styp") {
        return "video/mp4";
      }
    }

    const headText = new TextDecoder("utf-8", { fatal: false })
      .decode(bytes.subarray(0, Math.min(64, bytes.byteLength)))
      .trimStart();
    if (headText.startsWith("#EXTM3U")) return "application/x-mpegurl";
    if (headText.startsWith("<MPD") || headText.includes("<MPD")) return "application/dash+xml";
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    outerSignal?.removeEventListener("abort", onOuterAbort);
  }
}

export function classifyShakaError(err: unknown): ShakaErrorEvent {
  const e = err as {
    severity?: number;
    category?: number;
    code?: number;
    message?: string;
  } | null;

  const category = typeof e?.category === "number" ? e.category : null;
  const code = typeof e?.code === "number" ? e.code : null;
  const detail = e?.message || (code !== null ? `shaka-${category ?? "x"}-${code}` : "shaka-error");

  // Shaka Error.Category: 1 = NETWORK, 3 = MEDIA, 4 = MANIFEST
  if (category === 1) {
    return { kind: "network", category, code, detail };
  }
  // 4000 = UNABLE_TO_GUESS_MANIFEST_TYPE, 1001..1009 = HTTP/network
  if (code !== null && code >= 1000 && code < 2000) {
    return { kind: "network", category, code, detail };
  }
  if (category === 3 || category === 4) {
    return { kind: "decode", category, code, detail };
  }
  return { kind: "network", category, code, detail };
}

/* -------------------------------------------------------------------------- */
/* Dynamic Per-<video>-Element Shaka Instance Registry                        */
/* -------------------------------------------------------------------------- */

interface ActiveVideoSession {
  id: number;
  player: ShakaNamespace.Player;
  teardown: () => Promise<void>;
}

const activeSessionsByVideo = new WeakMap<HTMLMediaElement, ActiveVideoSession>();
let nextSessionId = 1;

export function getActiveShakaPlayerForVideo(
  video: HTMLMediaElement | null | undefined,
): ShakaNamespace.Player | null {
  if (!video) return null;
  return activeSessionsByVideo.get(video)?.player ?? null;
}

export async function destroyShakaForVideo(
  video: HTMLMediaElement | null | undefined,
): Promise<void> {
  if (!video) return;
  const existing = activeSessionsByVideo.get(video);
  if (existing) {
    activeSessionsByVideo.delete(video);
    await existing.teardown();
  }
}

function shouldProactivelyUseMp4Mse(
  mimeType: string,
  fileName: string | null | undefined,
  url: string,
  video: HTMLMediaElement,
): boolean {
  if (mimeType !== "video/mp4") return false;
  if (!isFlacInMp4MseSupported()) return false;
  const probe = `${fileName || ""} ${url.split(/[?#]/)[0]}`;
  const hints = parseReleaseHints(probe);
  if (hints.audio.length === 0) return false;
  const onlyDolby = hints.audio.every((c) => c === "eac3" || c === "ac3");
  if (!onlyDolby) return false;

  const nativeCaps = probeBrowserCapabilities(video);
  if (!nativeCaps) return false;
  const needsEac3 = hints.audio.includes("eac3") && !nativeCaps.eac3;
  const needsAc3 = hints.audio.includes("ac3") && !nativeCaps.ac3;
  return needsEac3 || needsAc3;
}

function extractDeduplicatedAudioTracks(
  player: ShakaNamespace.Player,
): ShakaAudioTrackOption[] {
  let variants: ShakaNamespace.extern.Track[] = [];
  try {
    variants = player.getVariantTracks() || [];
  } catch {
    return [];
  }

  const withAudio = variants.filter((t) => Boolean(t.audioCodec || t.audioMimeType || t.audioId !== null));
  if (withAudio.length === 0) return [];

  const groups = new Map<string, ShakaNamespace.extern.Track[]>();
  for (const track of withAudio) {
    const key =
      track.audioId !== null && track.audioId !== undefined
        ? `aid:${track.audioId}`
        : `${track.language || "und"}:${track.label || ""}:${track.channelsCount || 0}:${track.audioCodec || ""}`;
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(track);
    } else {
      groups.set(key, [track]);
    }
  }

  const options: ShakaAudioTrackOption[] = [];
  let idx = 0;
  for (const bucket of groups.values()) {
    const activeTrack = bucket.find((t) => t.active);
    // Pick the active variant in this audio group, or highest bandwidth matching current video
    const chosen =
      activeTrack ||
      bucket.slice().sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0];

    const baseName = chosen.label?.trim() || formatLanguageName(chosen.language, idx);
    const chBadge = formatChannelBadge(chosen.channelsCount);
    const fullLabel = chBadge && !baseName.includes(chBadge) ? `${baseName} · ${chBadge}` : baseName;

    options.push({
      id: chosen.id,
      audioId: chosen.audioId ?? null,
      language: chosen.language || "und",
      label: fullLabel,
      codec: chosen.audioCodec ?? null,
      channelsCount: chosen.channelsCount ?? null,
      active: Boolean(activeTrack),
    });
    idx++;
  }

  return options;
}

function extractTextTrackOptions(
  player: ShakaNamespace.Player,
): ShakaTextTrackOption[] {
  let tracks: ShakaNamespace.extern.Track[] = [];
  try {
    tracks = player.getTextTracks() || [];
  } catch {
    return [];
  }

  const visible = typeof player.isTextTrackVisible === "function" ? player.isTextTrackVisible() : false;
  return tracks.map((t, idx) => ({
    id: t.id,
    language: t.language || "und",
    label: t.label?.trim() || formatLanguageName(t.language, idx),
    active: Boolean(t.active && visible),
  }));
}

/**
 * Dynamically creates and attaches a dedicated `shaka.Player` instance for `video`,
 * configures codec & streaming compatibility (including DDP 5.1 / AC-3 WASM transcoding),
 * and loads the requested media URL.
 */
export async function attachShakaPlayback(
  video: HTMLVideoElement,
  options: AttachShakaOptions,
): Promise<ShakaPlaybackHandle> {
  // Always tear down any prior Shaka Player instance attached to this <video> element first
  await destroyShakaForVideo(video);

  const shaka = await ensureShakaInitialized(options.loader);
  if (!shaka || !shaka.Player?.isBrowserSupported?.()) {
    return {
      mode: "unsupported",
      mimeType: "",
      player: null,
      hasAudioTrack: () => false,
      getAudioTracks: () => [],
      selectAudioTrack: () => {},
      getTextTracks: () => [],
      selectTextTrack: async () => {},
      upgradeProgressiveMp4ToMse: async () => false,
      destroy: async () => {},
    };
  }

  const proxyOrigin =
    options.proxyOrigin !== undefined ? options.proxyOrigin : getCurrentBrowserOrigin();

  let mimeType =
    resolveShakaMimeType({
      url: options.url,
      streamType: options.streamType,
      container: options.container,
      fileName: options.fileName,
    }) ||
    (await sniffStreamMagicMime(options.url, options.signal, proxyOrigin)) ||
    "video/mp4";

  if (options.signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  if (shouldProactivelyUseMp4Mse(mimeType, options.fileName, options.url, video)) {
    mimeType = SIDIFY_MP4_MSE_MIME;
  }

  // Dynamically create a brand-new Shaka Player instance for this <video> element
  const player = new shaka.Player();
  const removeCrossOriginProxy = installPlayerCrossOriginProxy(player, proxyOrigin);
  const sessionId = nextSessionId++;
  let destroyed = false;

  const preferredLangs = options.preferredAudioLanguages?.length
    ? options.preferredAudioLanguages
    : ["hi", "en"];

  player.configure({
    abr: {
      enabled: true,
      allowAudioFallback: true,
    },
    manifest: {
      continueLoadingWhenPaused: true,
      hls: {
        ignoreTextStreamFailures: true,
        ignoreImageStreamFailures: true,
      },
    },
    streaming: {
      ignoreTextStreamFailures: true,
      bufferingGoal: 20,
      rebufferingGoal: 2,
      bufferBehind: 30,
      stallEnabled: true,
      stallThreshold: 1.5,
      stallSkip: 0.1,
      allowMediaSourceRecoveries: true,
      preferNativeHls: false,
      fallbackToNativeHlsOnMseError: true,
      processSrcEqualMetadata: false,
    },
    preferredAudio: preferredLangs.map((language) => ({
      language,
      role: "",
      label: "",
      channelCount: 2,
      codec: "",
    })),
  });

  const emitTracks = () => {
    if (destroyed || !options.onTracksChanged) return;
    options.onTracksChanged({
      audio: extractDeduplicatedAudioTracks(player),
      text: extractTextTrackOptions(player),
    });
  };

  const onErrorEvent = (event: Event & { detail?: unknown }) => {
    if (destroyed) return;
    const detail = event.detail as { severity?: number } | undefined;
    const criticalSeverity = shaka.util?.Error?.Severity?.CRITICAL ?? 2;
    if (detail && typeof detail.severity === "number" && detail.severity !== criticalSeverity) {
      // Shaka handles RECOVERABLE errors internally; do not jump links
      return;
    }
    options.onFatalError?.(classifyShakaError(detail));
  };

  player.addEventListener("error", onErrorEvent);
  player.addEventListener("trackschanged", emitTracks);
  player.addEventListener("variantchanged", emitTracks);
  player.addEventListener("textchanged", emitTracks);

  const teardown = async () => {
    if (destroyed) return;
    destroyed = true;
    removeCrossOriginProxy();
    player.removeEventListener("error", onErrorEvent);
    player.removeEventListener("trackschanged", emitTracks);
    player.removeEventListener("variantchanged", emitTracks);
    player.removeEventListener("textchanged", emitTracks);
    try {
      await player.destroy();
    } catch {
      // Ignore player teardown errors
    }
    try {
      video.removeAttribute("src");
      video.load();
    } catch {
      // Ignore DOM video reset errors in headless/mock environments
    }
  };

  activeSessionsByVideo.set(video, {
    id: sessionId,
    player,
    teardown,
  });

  try {
    await player.attach(video);
    if (options.signal?.aborted || destroyed) {
      await destroyShakaForVideo(video);
      throw new DOMException("Aborted", "AbortError");
    }

    const startTime =
      typeof options.startAt === "number" && Number.isFinite(options.startAt) && options.startAt > 0
        ? options.startAt
        : null;

    try {
      await player.load(options.url, startTime, mimeType);
    } catch (firstLoadError) {
      // If proactive MP4-MSE failed (e.g. server lacks Range header CORS or fragmented MP4),
      // fall back cleanly to standard Shaka video/mp4 before surfacing an error.
      if (mimeType === SIDIFY_MP4_MSE_MIME && !options.signal?.aborted && !destroyed) {
        mimeType = "video/mp4";
        await player.load(options.url, startTime, mimeType);
      } else {
        throw firstLoadError;
      }
    }
  } catch (err) {
    if (activeSessionsByVideo.get(video)?.id === sessionId) {
      activeSessionsByVideo.delete(video);
    }
    await teardown();
    throw err;
  }

  emitTracks();

  const getLoadModeKind = (): "shaka-mse" | "shaka-src" => {
    const loadMode = typeof player.getLoadMode === "function" ? player.getLoadMode() : 1;
    const srcMode = shaka.Player?.LoadMode?.SRC_EQUALS ?? 2;
    return loadMode === srcMode ? "shaka-src" : "shaka-mse";
  };

  const hasAudioTrack = (): boolean => {
    if (getLoadModeKind() === "shaka-src") {
      if (hasLiveDecoderCounters(video)) {
        const wc = video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number };
        if (typeof wc.webkitAudioDecodedByteCount === "number") {
          return wc.webkitAudioDecodedByteCount > 0;
        }
      }
      return true;
    }
    try {
      const variants = player.getVariantTracks() || [];
      if (variants.length === 0) return true;
      return variants.some((t) => Boolean(t.audioCodec || t.audioMimeType || t.audioId !== null));
    } catch {
      return true;
    }
  };

  const selectAudioTrack = (variantTrackId: number): void => {
    if (destroyed) return;
    try {
      const variants = player.getVariantTracks() || [];
      const target = variants.find((t) => t.id === variantTrackId);
      if (!target) return;
      // Prefer matching current active video resolution if multiple variants share this audioId
      const activeVariant = variants.find((t) => t.active);
      const bestMatch =
        (activeVariant &&
          target.audioId !== null &&
          variants.find(
            (t) => t.audioId === target.audioId && t.videoId === activeVariant.videoId,
          )) ||
        target;
      player.selectVariantTrack(bestMatch, true);
      emitTracks();
    } catch {
      // Ignore selection error
    }
  };

  const selectTextTrack = async (textTrackId: number | null): Promise<void> => {
    if (destroyed) return;
    try {
      if (textTrackId === null) {
        await player.setTextTrackVisibility(false);
        emitTracks();
        return;
      }
      const tracks = player.getTextTracks() || [];
      const target = tracks.find((t) => t.id === textTrackId);
      if (!target) return;
      player.selectTextTrack(target);
      await player.setTextTrackVisibility(true);
      emitTracks();
    } catch {
      // Ignore text track selection error
    }
  };

  const upgradeProgressiveMp4ToMse = async (resumeAt?: number): Promise<boolean> => {
    if (destroyed || mimeType === SIDIFY_MP4_MSE_MIME || !isFlacInMp4MseSupported()) {
      return false;
    }
    try {
      const pos =
        typeof resumeAt === "number" && Number.isFinite(resumeAt) && resumeAt > 0
          ? resumeAt
          : video.currentTime > 0
            ? video.currentTime
            : null;
      await player.load(options.url, pos, SIDIFY_MP4_MSE_MIME);
      mimeType = SIDIFY_MP4_MSE_MIME;
      emitTracks();
      return hasAudioTrack();
    } catch {
      return false;
    }
  };

  return {
    get mode() {
      return getLoadModeKind();
    },
    get mimeType() {
      return mimeType;
    },
    player,
    hasAudioTrack,
    getAudioTracks: () => extractDeduplicatedAudioTracks(player),
    selectAudioTrack,
    getTextTracks: () => extractTextTrackOptions(player),
    selectTextTrack,
    upgradeProgressiveMp4ToMse,
    destroy: async () => {
      if (activeSessionsByVideo.get(video)?.id === sessionId) {
        activeSessionsByVideo.delete(video);
      }
      await teardown();
    },
  };
}
