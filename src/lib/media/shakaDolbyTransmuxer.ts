import type { shaka as ShakaNamespace } from "shaka-player/dist/shaka-player.experimental.js";
import { DolbyToFlacTranscoder } from "./dolbyFlacTranscoder";

type ShakaModule = typeof ShakaNamespace;

const FLAC_MP4_MIME = 'audio/mp4; codecs="flac"';

function getMediaSourceConstructor(): { isTypeSupported(type: string): boolean } | null {
  if (typeof globalThis === "undefined") return null;
  const g = globalThis as unknown as {
    ManagedMediaSource?: { isTypeSupported?: (type: string) => boolean };
    MediaSource?: { isTypeSupported?: (type: string) => boolean };
  };
  if (g.ManagedMediaSource && typeof g.ManagedMediaSource.isTypeSupported === "function") {
    return g.ManagedMediaSource as { isTypeSupported(type: string): boolean };
  }
  if (g.MediaSource && typeof g.MediaSource.isTypeSupported === "function") {
    return g.MediaSource as { isTypeSupported(type: string): boolean };
  }
  return null;
}

export function isMseMimeSupported(fullMimeType: string): boolean {
  const ms = getMediaSourceConstructor();
  if (!ms) return false;
  try {
    return Boolean(ms.isTypeSupported(fullMimeType));
  } catch {
    return false;
  }
}

export function isFlacInMp4MseSupported(): boolean {
  return (
    typeof WebAssembly === "object" &&
    isMseMimeSupported(FLAC_MP4_MIME)
  );
}

export function extractDolbyCodecFromMime(mimeType: string): "ec-3" | "ac-3" | null {
  const lower = (mimeType || "").trim().toLowerCase();
  const basic = lower.split(";")[0].trim();
  if (basic === "audio/ec3" || basic === "audio/eac3") return "ec-3";
  if (basic === "audio/ac3") return "ac-3";

  const codecsMatch = lower.match(/codecs\s*=\s*"?([^";]+)"?/i);
  if (!codecsMatch) return null;
  const parts = codecsMatch[1].split(",").map((c) => c.trim().split(".")[0]);
  if (parts.includes("ec-3") || parts.includes("eac3")) return "ec-3";
  if (parts.includes("ac-3") || parts.includes("ac3")) return "ac-3";
  return null;
}

export function needsDolbySoftwareTranscode(
  mimeType: string,
  contentType?: string,
): boolean {
  const lower = (mimeType || "").trim().toLowerCase();
  const isAudioContext =
    contentType === "audio" ||
    (!contentType && lower.startsWith("audio/"));
  if (!isAudioContext) return false;

  const dolbyCodec = extractDolbyCodecFromMime(lower);
  if (!dolbyCodec) return false;

  // Prefer zero-CPU hardware passthrough when the browser's MSE natively supports Dolby
  if (isMseMimeSupported(`audio/mp4; codecs="${dolbyCodec}"`)) {
    return false;
  }

  return isFlacInMp4MseSupported();
}

function bufferSourceToUint8(data: BufferSource): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return new Uint8Array(data);
}

function isDolbyStream(stream: ShakaNamespace.extern.Stream | null | undefined): boolean {
  if (!stream) return false;
  const codecs = (stream.codecs || "").toLowerCase();
  if (codecs.includes("ec-3") || codecs.includes("eac3")) {
    return !isMseMimeSupported('audio/mp4; codecs="ec-3"');
  }
  if (codecs.includes("ac-3") || codecs.includes("ac3")) {
    return !isMseMimeSupported('audio/mp4; codecs="ac-3"');
  }
  const mime = (stream.mimeType || "").toLowerCase();
  if (mime === "audio/ec3" || mime === "audio/eac3") {
    return !isMseMimeSupported('audio/mp4; codecs="ec-3"');
  }
  if (mime === "audio/ac3") {
    return !isMseMimeSupported('audio/mp4; codecs="ac-3"');
  }
  return false;
}

/**
 * Wraps a built-in Shaka transmuxer (MatroskaTransmuxer, Ec3Transmuxer, Ac3Transmuxer, TsTransmuxer)
 * so video and natively-supported audio pass straight through untouched, while unsupported
 * E-AC-3 (DDP 5.1/7.1) and AC-3 (DD 5.1) audio streams are decoded via WASM and packaged as
 * lossless FLAC-in-fMP4 (`audio/mp4; codecs="flac"`).
 */
class DelegatingDolbyTransmuxer implements ShakaNamespace.extern.Transmuxer {
  private readonly inner: ShakaNamespace.extern.Transmuxer;
  private readonly originalMimeType: string;
  private transcoder: DolbyToFlacTranscoder | null = null;

  constructor(inner: ShakaNamespace.extern.Transmuxer, originalMimeType: string) {
    this.inner = inner;
    this.originalMimeType = originalMimeType;
  }

  private getTranscoder(): DolbyToFlacTranscoder {
    if (!this.transcoder) {
      this.transcoder = new DolbyToFlacTranscoder();
    }
    return this.transcoder;
  }

  destroy(): void {
    try {
      this.inner.destroy();
    } catch {
      // Ignore inner cleanup failure
    }
    if (this.transcoder) {
      this.transcoder.destroy();
      this.transcoder = null;
    }
  }

  getOriginalMimeType(): string {
    return this.originalMimeType;
  }

  isSupported(mimeType: string, contentType?: string): boolean {
    try {
      if (this.inner.isSupported(mimeType, contentType)) {
        return true;
      }
    } catch {
      // Fall through to software Dolby support check
    }
    return needsDolbySoftwareTranscode(mimeType, contentType);
  }

  convertCodecs(contentType: string, mimeType: string): string {
    if (needsDolbySoftwareTranscode(mimeType, contentType || "audio")) {
      return FLAC_MP4_MIME;
    }
    return this.inner.convertCodecs(contentType, mimeType);
  }

  async transmux(
    data: BufferSource,
    stream: ShakaNamespace.extern.Stream,
    reference: ShakaNamespace.SegmentReference | null,
    duration: number,
    contentType: string,
  ): Promise<Uint8Array | ShakaNamespace.extern.TransmuxerOutput> {
    const innerResult = await this.inner.transmux(data, stream, reference, duration, contentType);

    const isAudio = contentType === "audio" || stream?.type === "audio";
    if (!isAudio || !isDolbyStream(stream) || !isFlacInMp4MseSupported()) {
      return innerResult;
    }

    if (innerResult instanceof Uint8Array) {
      if (innerResult.byteLength === 0) {
        return innerResult;
      }
      const transcoded = await this.getTranscoder().transcodeFmp4Segment(
        innerResult,
        null,
        duration,
        stream?.language,
      );
      if (!transcoded) return new Uint8Array(0);
      stream.audioSamplingRate = transcoded.sampleRate;
      stream.channelsCount = transcoded.channels;
      return { data: transcoded.data, init: transcoded.init };
    }

    if (!innerResult.data || innerResult.data.byteLength === 0) {
      if (innerResult.init && innerResult.init.byteLength > 0) {
        this.getTranscoder().ingestFmp4Init(innerResult.init);
      }
      return new Uint8Array(0);
    }

    const transcoded = await this.getTranscoder().transcodeFmp4Segment(
      innerResult.data,
      innerResult.init,
      duration,
      stream?.language,
    );
    if (!transcoded) {
      return new Uint8Array(0);
    }
    stream.audioSamplingRate = transcoded.sampleRate;
    stream.channelsCount = transcoded.channels;
    return {
      data: transcoded.data,
      init: transcoded.init,
    };
  }
}

/**
 * Handles fragmented MP4 (`audio/mp4; codecs="ec-3"` / `"ac-3"`) audio segments
 * in HLS or DASH manifests on browsers without native Dolby MSE support.
 */
class Fmp4DolbyAudioTransmuxer implements ShakaNamespace.extern.Transmuxer {
  private transcoder: DolbyToFlacTranscoder | null = null;

  private getTranscoder(): DolbyToFlacTranscoder {
    if (!this.transcoder) {
      this.transcoder = new DolbyToFlacTranscoder();
    }
    return this.transcoder;
  }

  destroy(): void {
    if (this.transcoder) {
      this.transcoder.destroy();
      this.transcoder = null;
    }
  }

  getOriginalMimeType(): string {
    return "audio/mp4";
  }

  isSupported(mimeType: string, contentType?: string): boolean {
    const basic = (mimeType || "").split(";")[0].trim().toLowerCase();
    if (basic !== "audio/mp4") return false;
    return needsDolbySoftwareTranscode(mimeType, contentType || "audio");
  }

  convertCodecs(_contentType: string, mimeType: string): string {
    if (needsDolbySoftwareTranscode(mimeType, "audio")) {
      return FLAC_MP4_MIME;
    }
    return mimeType;
  }

  async transmux(
    data: BufferSource,
    stream: ShakaNamespace.extern.Stream,
    reference: ShakaNamespace.SegmentReference | null,
    duration: number,
  ): Promise<Uint8Array | ShakaNamespace.extern.TransmuxerOutput> {
    const bytes = bufferSourceToUint8(data);
    if (bytes.byteLength === 0) return new Uint8Array(0);

    if (!reference) {
      this.getTranscoder().ingestFmp4Init(bytes);
      return new Uint8Array(0);
    }

    const transcoded = await this.getTranscoder().transcodeFmp4Segment(
      bytes,
      null,
      duration,
      stream?.language,
    );
    if (!transcoded) {
      return new Uint8Array(0);
    }
    stream.audioSamplingRate = transcoded.sampleRate;
    stream.channelsCount = transcoded.channels;
    return {
      data: transcoded.data,
      init: transcoded.init,
    };
  }
}

const registeredShakaEngines = new WeakSet<object>();

/**
 * Registers APPLICATION-priority Dolby Digital Plus (`ec-3`) and Dolby Digital (`ac-3`)
 * compatibility transmuxers on Shaka's `TransmuxerEngine` (idempotent per Shaka runtime).
 */
export function registerShakaDolbyTransmuxers(shaka: ShakaModule): void {
  const engine = shaka?.transmuxer?.TransmuxerEngine;
  if (!engine || registeredShakaEngines.has(engine)) return;
  registeredShakaEngines.add(engine);

  // Shaka 5.3+ Capabilities.isTypeSupported uses Map.prototype.getOrInsertComputed (TC39 upsert).
  const mapProto = Map.prototype as Map<unknown, unknown> & {
    getOrInsertComputed?: (key: unknown, callback: (key: unknown) => unknown) => unknown;
  };
  if (typeof mapProto.getOrInsertComputed !== "function") {
    Object.defineProperty(Map.prototype, "getOrInsertComputed", {
      value: function getOrInsertComputed(
        this: Map<unknown, unknown>,
        key: unknown,
        callback: (k: unknown) => unknown,
      ) {
        if (this.has(key)) return this.get(key);
        const computed = callback(key);
        this.set(key, computed);
        return computed;
      },
      configurable: true,
      writable: true,
    });
  }

  const appPriority = engine.PluginPriority?.APPLICATION ?? 4;

  const wrapMime = (
    mimeType: string,
    probeMime: string,
    probeContentType: string,
    fallbackFactory?: () => ShakaNamespace.extern.Transmuxer,
  ) => {
    const existingFactory =
      (engine as unknown as {
        findTransmuxer: (m: string, c?: string) => ShakaNamespace.extern.TransmuxerPlugin | null;
      }).findTransmuxer(probeMime, probeContentType) || fallbackFactory;
    if (!existingFactory) return;
    engine.registerTransmuxer(
      mimeType,
      () => new DelegatingDolbyTransmuxer(existingFactory(), mimeType),
      appPriority,
    );
  };

  wrapMime(
    "video/x-matroska",
    'video/x-matroska; codecs="avc1.640028"',
    "video",
    shaka.transmuxer.MatroskaTransmuxer
      ? () => new shaka.transmuxer.MatroskaTransmuxer("video/x-matroska")
      : undefined,
  );
  wrapMime(
    "audio/x-matroska",
    'audio/x-matroska; codecs="mp4a.40.2"',
    "audio",
    shaka.transmuxer.MatroskaTransmuxer
      ? () => new shaka.transmuxer.MatroskaTransmuxer("audio/x-matroska")
      : undefined,
  );
  wrapMime(
    "audio/ec3",
    "audio/ec3",
    "audio",
    shaka.transmuxer.Ec3Transmuxer
      ? () => new shaka.transmuxer.Ec3Transmuxer("audio/ec3")
      : undefined,
  );
  wrapMime(
    "audio/ac3",
    "audio/ac3",
    "audio",
    shaka.transmuxer.Ac3Transmuxer
      ? () => new shaka.transmuxer.Ac3Transmuxer("audio/ac3")
      : undefined,
  );
  wrapMime(
    "video/mp2t",
    'video/mp2t; codecs="avc1.640028"',
    "video",
    shaka.transmuxer.TsTransmuxer
      ? () => new shaka.transmuxer.TsTransmuxer("video/mp2t")
      : shaka.transmuxer.MpegTsTransmuxer
        ? () => new shaka.transmuxer.MpegTsTransmuxer("video/mp2t")
        : undefined,
  );

  engine.registerTransmuxer(
    "audio/mp4",
    () => new Fmp4DolbyAudioTransmuxer(),
    appPriority,
  );
}
