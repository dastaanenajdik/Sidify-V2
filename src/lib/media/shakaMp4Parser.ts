import type { shaka as ShakaNamespace } from "shaka-player/dist/shaka-player.experimental.js";
import {
  DolbyToFlacTranscoder,
  iterateMp4Boxes,
  mp4Box,
} from "./dolbyFlacTranscoder";
import {
  isFlacInMp4MseSupported,
  isMseMimeSupported,
} from "./shakaDolbyTransmuxer";

type ShakaModule = typeof ShakaNamespace;

export const SIDIFY_MP4_MSE_MIME = "application/x-sidify-mp4-mse";
const SIDIFY_MP4_VIDEO_MIME = "video/x-sidify-mp4";
const SIDIFY_MP4_AUDIO_MIME = "audio/x-sidify-mp4";
const FLAC_MP4_MIME = 'audio/mp4; codecs="flac"';
const UINT32_MOD = 0x1_0000_0000;
const INITIAL_PROBE_BYTES = 512 * 1024;
const TARGET_SEGMENT_SECONDS = 3.0;
const MAX_SEGMENT_SPAN_BYTES = 8 * 1024 * 1024;

export interface Mp4SampleRecord {
  offset: number;
  size: number;
  dts: number;
  duration: number;
  ctsOffset: number;
  isSync: boolean;
}

export interface ParsedProgressiveTrack {
  trackId: number;
  handlerType: "vide" | "soun";
  timescale: number;
  durationTicks: number;
  language: string;
  width: number;
  height: number;
  channelsCount: number;
  sampleRate: number;
  codecFourcc: string;
  codecString: string;
  stsdBoxBytes: Uint8Array;
  samples: Mp4SampleRecord[];
}

interface SegmentSampleSlice {
  startByte: number;
  endByte: number;
  baseMediaDecodeTime: number;
  samples: Mp4SampleRecord[];
}

interface StreamMp4Context {
  track: ParsedProgressiveTrack;
  slicesByKey: Map<string, SegmentSampleSlice>;
}

const streamContextMap = new WeakMap<ShakaNamespace.extern.Stream, StreamMp4Context>();

function hex2(n: number): string {
  return (n & 0xff).toString(16).padStart(2, "0");
}

function writeUint32BE(buf: Uint8Array, value: number, offset: number): void {
  const u = value >>> 0;
  buf[offset] = (u >>> 24) & 0xff;
  buf[offset + 1] = (u >>> 16) & 0xff;
  buf[offset + 2] = (u >>> 8) & 0xff;
  buf[offset + 3] = u & 0xff;
}

function writeUint16BE(buf: Uint8Array, value: number, offset: number): void {
  buf[offset] = (value >>> 8) & 0xff;
  buf[offset + 1] = value & 0xff;
}

function deriveCodecStringFromSampleEntry(
  bytes: Uint8Array,
  entryDataOffset: number,
  entryEndOffset: number,
  fourcc: string,
  handlerType: "vide" | "soun",
): { codecString: string; width: number; height: number; channels: number; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let channels = 2;
  let sampleRate = 48000;

  if (handlerType === "vide" && entryEndOffset - entryDataOffset >= 78) {
    width = view.getUint16(entryDataOffset + 24, false);
    height = view.getUint16(entryDataOffset + 26, false);
    const children = iterateMp4Boxes(bytes, entryDataOffset + 78, entryEndOffset);

    if (fourcc === "avc1" || fourcc === "avc3") {
      const avcC = children.find((b) => b.type === "avcC");
      if (avcC && avcC.endOffset - avcC.dataOffset >= 4) {
        const p = bytes[avcC.dataOffset + 1];
        const c = bytes[avcC.dataOffset + 2];
        const l = bytes[avcC.dataOffset + 3];
        return {
          codecString: `${fourcc}.${hex2(p)}${hex2(c)}${hex2(l)}`,
          width,
          height,
          channels,
          sampleRate,
        };
      }
      return { codecString: "avc1.640028", width, height, channels, sampleRate };
    }

    if (fourcc === "hvc1" || fourcc === "hev1") {
      const hvcC = children.find((b) => b.type === "hvcC");
      if (hvcC && hvcC.endOffset - hvcC.dataOffset >= 13) {
        const b1 = bytes[hvcC.dataOffset + 1];
        const profileSpace = ["", "A", "B", "C"][(b1 >>> 6) & 0x03];
        const tierFlag = (b1 & 0x20) !== 0 ? "H" : "L";
        const profileIdc = b1 & 0x1f;
        const levelIdc = bytes[hvcC.dataOffset + 12];
        return {
          codecString: `${fourcc}.${profileSpace}${profileIdc}.6.${tierFlag}${levelIdc}.90`,
          width,
          height,
          channels,
          sampleRate,
        };
      }
      return { codecString: `${fourcc}.1.6.L120.90`, width, height, channels, sampleRate };
    }

    if (fourcc === "av01") {
      const av1C = children.find((b) => b.type === "av1C");
      if (av1C && av1C.endOffset - av1C.dataOffset >= 4) {
        const b1 = bytes[av1C.dataOffset + 1];
        const b2 = bytes[av1C.dataOffset + 2];
        const seqProfile = (b1 >>> 5) & 0x07;
        const seqLevelIdx = b1 & 0x1f;
        const tier = (b2 & 0x80) !== 0 ? "H" : "M";
        const highBitdepth = (b2 & 0x40) !== 0;
        const twelveBit = (b2 & 0x20) !== 0;
        const bitDepth = highBitdepth ? (twelveBit ? 12 : 10) : 8;
        return {
          codecString: `av01.${seqProfile}.${String(seqLevelIdx).padStart(2, "0")}${tier}.${String(bitDepth).padStart(2, "0")}`,
          width,
          height,
          channels,
          sampleRate,
        };
      }
      return { codecString: "av01.0.08M.08", width, height, channels, sampleRate };
    }

    if (fourcc === "vp09") {
      return { codecString: "vp09.00.41.08", width, height, channels, sampleRate };
    }

    return { codecString: fourcc, width, height, channels, sampleRate };
  }

  if (handlerType === "soun" && entryEndOffset - entryDataOffset >= 28) {
    channels = view.getUint16(entryDataOffset + 16, false) || 2;
    sampleRate = view.getUint16(entryDataOffset + 24, false) || 48000;

    if (fourcc === "ec-3") {
      return { codecString: "ec-3", width, height, channels, sampleRate };
    }
    if (fourcc === "ac-3") {
      return { codecString: "ac-3", width, height, channels, sampleRate };
    }
    if (fourcc === "Opus" || fourcc === "opus") {
      return { codecString: "opus", width, height, channels, sampleRate };
    }
    if (fourcc === "fLaC" || fourcc === "flac") {
      return { codecString: "flac", width, height, channels, sampleRate };
    }
    if (fourcc === ".mp3" || fourcc === "mp3 ") {
      return { codecString: "mp3", width, height, channels, sampleRate };
    }
    if (fourcc === "mp4a") {
      return { codecString: "mp4a.40.2", width, height, channels, sampleRate };
    }
  }

  return { codecString: fourcc, width, height, channels, sampleRate };
}

/**
 * Parses an ISO BMFF `moov` box payload (or buffer containing `moov`) into per-track sample tables.
 */
export function parseProgressiveMp4Moov(bufferContainingMoov: Uint8Array): ParsedProgressiveTrack[] {
  const top = iterateMp4Boxes(bufferContainingMoov);
  const moov = top.find((b) => b.type === "moov");
  const moovStart = moov ? moov.dataOffset : 0;
  const moovEnd = moov ? moov.endOffset : bufferContainingMoov.byteLength;

  const view = new DataView(
    bufferContainingMoov.buffer,
    bufferContainingMoov.byteOffset,
    bufferContainingMoov.byteLength,
  );
  const tracks: ParsedProgressiveTrack[] = [];

  for (const moovChild of iterateMp4Boxes(bufferContainingMoov, moovStart, moovEnd)) {
    if (moovChild.type !== "trak") continue;

    let trackId = tracks.length + 1;
    let tkhdWidth = 0;
    let tkhdHeight = 0;
    let timescale = 0;
    let durationTicks = 0;
    let language = "und";
    let handlerType: "vide" | "soun" | null = null;
    let stblSlice: { dataOffset: number; endOffset: number } | null = null;

    for (const trakChild of iterateMp4Boxes(bufferContainingMoov, moovChild.dataOffset, moovChild.endOffset)) {
      if (trakChild.type === "tkhd") {
        const ver = bufferContainingMoov[trakChild.dataOffset];
        if (ver === 1 && trakChild.endOffset - trakChild.dataOffset >= 96) {
          trackId = view.getUint32(trakChild.dataOffset + 20, false);
          tkhdWidth = view.getUint16(trakChild.dataOffset + 88, false);
          tkhdHeight = view.getUint16(trakChild.dataOffset + 92, false);
        } else if (ver === 0 && trakChild.endOffset - trakChild.dataOffset >= 84) {
          trackId = view.getUint32(trakChild.dataOffset + 12, false);
          tkhdWidth = view.getUint16(trakChild.dataOffset + 76, false);
          tkhdHeight = view.getUint16(trakChild.dataOffset + 80, false);
        }
      } else if (trakChild.type === "mdia") {
        for (const mdiaChild of iterateMp4Boxes(bufferContainingMoov, trakChild.dataOffset, trakChild.endOffset)) {
          if (mdiaChild.type === "mdhd") {
            const ver = bufferContainingMoov[mdiaChild.dataOffset];
            if (ver === 1 && mdiaChild.endOffset - mdiaChild.dataOffset >= 34) {
              timescale = view.getUint32(mdiaChild.dataOffset + 20, false);
              const hi = view.getUint32(mdiaChild.dataOffset + 24, false);
              const lo = view.getUint32(mdiaChild.dataOffset + 28, false);
              durationTicks = hi * UINT32_MOD + lo;
              const langBits = view.getUint16(mdiaChild.dataOffset + 32, false);
              const c1 = ((langBits >>> 10) & 0x1f) + 0x60;
              const c2 = ((langBits >>> 5) & 0x1f) + 0x60;
              const c3 = (langBits & 0x1f) + 0x60;
              if (c1 >= 0x61 && c1 <= 0x7a && c2 >= 0x61 && c2 <= 0x7a && c3 >= 0x61 && c3 <= 0x7a) {
                language = String.fromCharCode(c1, c2, c3);
              }
            } else if (mdiaChild.endOffset - mdiaChild.dataOffset >= 22) {
              timescale = view.getUint32(mdiaChild.dataOffset + 12, false);
              durationTicks = view.getUint32(mdiaChild.dataOffset + 16, false);
              const langBits = view.getUint16(mdiaChild.dataOffset + 20, false);
              const c1 = ((langBits >>> 10) & 0x1f) + 0x60;
              const c2 = ((langBits >>> 5) & 0x1f) + 0x60;
              const c3 = (langBits & 0x1f) + 0x60;
              if (c1 >= 0x61 && c1 <= 0x7a && c2 >= 0x61 && c2 <= 0x7a && c3 >= 0x61 && c3 <= 0x7a) {
                language = String.fromCharCode(c1, c2, c3);
              }
            }
          } else if (mdiaChild.type === "hdlr" && mdiaChild.endOffset - mdiaChild.dataOffset >= 12) {
            const hType = String.fromCharCode(
              bufferContainingMoov[mdiaChild.dataOffset + 8],
              bufferContainingMoov[mdiaChild.dataOffset + 9],
              bufferContainingMoov[mdiaChild.dataOffset + 10],
              bufferContainingMoov[mdiaChild.dataOffset + 11],
            );
            if (hType === "vide" || hType === "soun") {
              handlerType = hType;
            }
          } else if (mdiaChild.type === "minf") {
            for (const minfChild of iterateMp4Boxes(bufferContainingMoov, mdiaChild.dataOffset, mdiaChild.endOffset)) {
              if (minfChild.type === "stbl") {
                stblSlice = { dataOffset: minfChild.dataOffset, endOffset: minfChild.endOffset };
              }
            }
          }
        }
      }
    }

    if (!handlerType || !stblSlice || timescale <= 0) continue;

    let stsdBoxBytes: Uint8Array | null = null;
    let codecFourcc = "";
    let codecString = "";
    let width = tkhdWidth;
    let height = tkhdHeight;
    let channelsCount = 2;
    let sampleRate = timescale;

    const sttsEntries: Array<{ count: number; delta: number }> = [];
    const cttsEntries: Array<{ count: number; offset: number }> = [];
    const stscEntries: Array<{ firstChunk: number; samplesPerChunk: number }> = [];
    let defaultSampleSize = 0;
    let sampleSizes: Uint32Array = new Uint32Array(0);
    let chunkOffsets: Float64Array = new Float64Array(0);
    let syncSet: Set<number> | null = null;

    for (const box of iterateMp4Boxes(bufferContainingMoov, stblSlice.dataOffset, stblSlice.endOffset)) {
      const p = box.dataOffset;
      const len = box.endOffset - p;

      if (box.type === "stsd" && len >= 16) {
        stsdBoxBytes = bufferContainingMoov.slice(box.headerOffset, box.endOffset);
        const entries = iterateMp4Boxes(bufferContainingMoov, p + 8, box.endOffset);
        if (entries.length > 0) {
          codecFourcc = entries[0].type;
          const derived = deriveCodecStringFromSampleEntry(
            bufferContainingMoov,
            entries[0].dataOffset,
            entries[0].endOffset,
            codecFourcc,
            handlerType,
          );
          codecString = derived.codecString;
          if (derived.width > 0) width = derived.width;
          if (derived.height > 0) height = derived.height;
          channelsCount = derived.channels;
          sampleRate = derived.sampleRate;
        }
      } else if (box.type === "stts" && len >= 8) {
        const count = view.getUint32(p + 4, false);
        for (let i = 0; i < count && p + 8 + (i + 1) * 8 <= box.endOffset; i++) {
          sttsEntries.push({
            count: view.getUint32(p + 8 + i * 8, false),
            delta: view.getUint32(p + 12 + i * 8, false),
          });
        }
      } else if (box.type === "ctts" && len >= 8) {
        const ver = bufferContainingMoov[p];
        const count = view.getUint32(p + 4, false);
        for (let i = 0; i < count && p + 8 + (i + 1) * 8 <= box.endOffset; i++) {
          cttsEntries.push({
            count: view.getUint32(p + 8 + i * 8, false),
            offset: ver === 1 ? view.getInt32(p + 12 + i * 8, false) : view.getUint32(p + 12 + i * 8, false),
          });
        }
      } else if (box.type === "stsc" && len >= 8) {
        const count = view.getUint32(p + 4, false);
        for (let i = 0; i < count && p + 8 + (i + 1) * 12 <= box.endOffset; i++) {
          stscEntries.push({
            firstChunk: view.getUint32(p + 8 + i * 12, false),
            samplesPerChunk: view.getUint32(p + 12 + i * 12, false),
          });
        }
      } else if (box.type === "stsz" && len >= 12) {
        defaultSampleSize = view.getUint32(p + 4, false);
        const count = view.getUint32(p + 8, false);
        sampleSizes = new Uint32Array(count);
        if (defaultSampleSize > 0) {
          sampleSizes.fill(defaultSampleSize);
        } else {
          for (let i = 0; i < count && p + 12 + (i + 1) * 4 <= box.endOffset; i++) {
            sampleSizes[i] = view.getUint32(p + 12 + i * 4, false);
          }
        }
      } else if (box.type === "stco" && len >= 8) {
        const count = view.getUint32(p + 4, false);
        chunkOffsets = new Float64Array(count);
        for (let i = 0; i < count && p + 8 + (i + 1) * 4 <= box.endOffset; i++) {
          chunkOffsets[i] = view.getUint32(p + 8 + i * 4, false);
        }
      } else if (box.type === "co64" && len >= 8) {
        const count = view.getUint32(p + 4, false);
        chunkOffsets = new Float64Array(count);
        for (let i = 0; i < count && p + 8 + (i + 1) * 8 <= box.endOffset; i++) {
          const hi = view.getUint32(p + 8 + i * 8, false);
          const lo = view.getUint32(p + 12 + i * 8, false);
          chunkOffsets[i] = hi * UINT32_MOD + lo;
        }
      } else if (box.type === "stss" && len >= 8) {
        const count = view.getUint32(p + 4, false);
        syncSet = new Set<number>();
        for (let i = 0; i < count && p + 8 + (i + 1) * 4 <= box.endOffset; i++) {
          syncSet.add(view.getUint32(p + 8 + i * 4, false)); // 1-based sample index
        }
      }
    }

    if (!stsdBoxBytes || !codecString || sampleSizes.length === 0 || chunkOffsets.length === 0 || stscEntries.length === 0) {
      continue;
    }

    const totalSamples = sampleSizes.length;
    const samples: Mp4SampleRecord[] = new Array(totalSamples);

    let sttsIdx = 0;
    let sttsRem = sttsEntries[0]?.count ?? 0;
    let cttsIdx = 0;
    let cttsRem = cttsEntries[0]?.count ?? 0;
    let currentDts = 0;
    let sampleIdx = 0;

    for (let chunkIdx = 0; chunkIdx < chunkOffsets.length && sampleIdx < totalSamples; chunkIdx++) {
      const chunkNum1 = chunkIdx + 1;
      let spc = stscEntries[0].samplesPerChunk;
      for (let s = 0; s < stscEntries.length; s++) {
        if (stscEntries[s].firstChunk <= chunkNum1) {
          spc = stscEntries[s].samplesPerChunk;
        } else {
          break;
        }
      }

      let byteCursor = chunkOffsets[chunkIdx];
      for (let k = 0; k < spc && sampleIdx < totalSamples; k++) {
        while (sttsRem === 0 && sttsIdx + 1 < sttsEntries.length) {
          sttsIdx++;
          sttsRem = sttsEntries[sttsIdx].count;
        }
        const dur = sttsEntries[sttsIdx]?.delta ?? 0;
        if (sttsRem > 0) sttsRem--;

        let ctsOff = 0;
        if (cttsEntries.length > 0) {
          while (cttsRem === 0 && cttsIdx + 1 < cttsEntries.length) {
            cttsIdx++;
            cttsRem = cttsEntries[cttsIdx].count;
          }
          ctsOff = cttsEntries[cttsIdx]?.offset ?? 0;
          if (cttsRem > 0) cttsRem--;
        }

        const sz = sampleSizes[sampleIdx];
        const isSync = syncSet ? syncSet.has(sampleIdx + 1) : true;
        samples[sampleIdx] = {
          offset: byteCursor,
          size: sz,
          dts: currentDts,
          duration: dur,
          ctsOffset: ctsOff,
          isSync,
        };
        byteCursor += sz;
        currentDts += dur;
        sampleIdx++;
      }
    }

    if (sampleIdx < totalSamples) {
      samples.length = sampleIdx;
    }
    if (samples.length === 0) continue;
    if (durationTicks <= 0) {
      const last = samples[samples.length - 1];
      durationTicks = last.dts + last.duration;
    }

    tracks.push({
      trackId,
      handlerType,
      timescale,
      durationTicks,
      language,
      width,
      height,
      channelsCount,
      sampleRate,
      codecFourcc,
      codecString,
      stsdBoxBytes,
      samples,
    });
  }

  return tracks;
}

const FTYP_ISOM = new Uint8Array([
  0x00, 0x00, 0x00, 0x18,
  0x66, 0x74, 0x79, 0x70,
  0x69, 0x73, 0x6f, 0x6d,
  0x00, 0x00, 0x02, 0x00,
  0x69, 0x73, 0x6f, 0x6d,
  0x69, 0x73, 0x6f, 0x36,
]);

const DINF_BOX = new Uint8Array([
  0x00, 0x00, 0x00, 0x24, 0x64, 0x69, 0x6e, 0x66,
  0x00, 0x00, 0x00, 0x1c, 0x64, 0x72, 0x65, 0x66,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x0c, 0x75, 0x72, 0x6c, 0x20,
  0x00, 0x00, 0x00, 0x01,
]);

export function buildPassthroughFmp4InitFromTrack(track: ParsedProgressiveTrack): Uint8Array {
  const upperDur = Math.floor(track.durationTicks / UINT32_MOD);
  const lowerDur = Math.floor(track.durationTicks % UINT32_MOD);
  const lang = (track.language || "und").padEnd(3, "d").slice(0, 3);
  const langBits =
    (((lang.charCodeAt(0) - 0x60) & 0x1f) << 10) |
    (((lang.charCodeAt(1) - 0x60) & 0x1f) << 5) |
    ((lang.charCodeAt(2) - 0x60) & 0x1f);

  const mvhdPayload = new Uint8Array(112);
  mvhdPayload[0] = 0x01;
  mvhdPayload[11] = 0x02;
  mvhdPayload[19] = 0x03;
  writeUint32BE(mvhdPayload, track.timescale, 20);
  writeUint32BE(mvhdPayload, upperDur, 24);
  writeUint32BE(mvhdPayload, lowerDur, 28);
  writeUint32BE(mvhdPayload, 0x00010000, 32);
  writeUint16BE(mvhdPayload, 0x0100, 36);
  writeUint32BE(mvhdPayload, 0x00010000, 48);
  writeUint32BE(mvhdPayload, 0x00010000, 64);
  writeUint32BE(mvhdPayload, 0x40000000, 80);
  writeUint32BE(mvhdPayload, 0xffffffff, 108);

  const tkhdPayload = new Uint8Array(96);
  tkhdPayload[0] = 0x01;
  tkhdPayload[3] = 0x07;
  tkhdPayload[11] = 0x02;
  tkhdPayload[19] = 0x03;
  writeUint32BE(tkhdPayload, track.trackId, 20);
  writeUint32BE(tkhdPayload, upperDur, 28);
  writeUint32BE(tkhdPayload, lowerDur, 32);
  if (track.handlerType === "soun") {
    writeUint16BE(tkhdPayload, 0x0100, 48);
  }
  writeUint32BE(tkhdPayload, 0x00010000, 52);
  writeUint32BE(tkhdPayload, 0x00010000, 68);
  writeUint32BE(tkhdPayload, 0x40000000, 84);
  if (track.handlerType === "vide") {
    writeUint16BE(tkhdPayload, track.width, 88);
    writeUint16BE(tkhdPayload, track.height, 92);
  }

  const mdhdPayload = new Uint8Array(36);
  mdhdPayload[0] = 0x01;
  mdhdPayload[11] = 0x02;
  mdhdPayload[19] = 0x03;
  writeUint32BE(mdhdPayload, track.timescale, 20);
  writeUint32BE(mdhdPayload, upperDur, 24);
  writeUint32BE(mdhdPayload, lowerDur, 28);
  writeUint16BE(mdhdPayload, langBits, 32);

  const hdlrPayload = track.handlerType === "vide"
    ? new Uint8Array([
        0, 0, 0, 0, 0, 0, 0, 0, 0x76, 0x69, 0x64, 0x65,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0x56, 0x69, 0x64, 0x65, 0x6f, 0x48, 0x61, 0x6e, 0x64, 0x6c, 0x65, 0x72, 0,
      ])
    : new Uint8Array([
        0, 0, 0, 0, 0, 0, 0, 0, 0x73, 0x6f, 0x75, 0x6e,
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        0x53, 0x6f, 0x75, 0x6e, 0x64, 0x48, 0x61, 0x6e, 0x64, 0x6c, 0x65, 0x72, 0,
      ]);

  const mediaHeaderBox = track.handlerType === "vide"
    ? mp4Box("vmhd", new Uint8Array([0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]))
    : mp4Box("smhd", new Uint8Array(8));

  const stblBox = mp4Box(
    "stbl",
    track.stsdBoxBytes,
    mp4Box("stts", new Uint8Array(8)),
    mp4Box("stsc", new Uint8Array(8)),
    mp4Box("stsz", new Uint8Array(12)),
    mp4Box("stco", new Uint8Array(8)),
  );

  const minfBox = mp4Box("minf", mediaHeaderBox, DINF_BOX, stblBox);
  const mdiaBox = mp4Box("mdia", mp4Box("mdhd", mdhdPayload), mp4Box("hdlr", hdlrPayload), minfBox);
  const trakBox = mp4Box("trak", mp4Box("tkhd", tkhdPayload), mdiaBox);

  const trexPayload = new Uint8Array(24);
  writeUint32BE(trexPayload, track.trackId, 4);
  writeUint32BE(trexPayload, 1, 8);
  const mvexBox = mp4Box("mvex", mp4Box("trex", trexPayload));

  const moovBox = mp4Box("moov", mp4Box("mvhd", mvhdPayload), trakBox, mvexBox);
  const out = new Uint8Array(FTYP_ISOM.byteLength + moovBox.byteLength);
  out.set(FTYP_ISOM, 0);
  out.set(moovBox, FTYP_ISOM.byteLength);
  return out;
}

export function buildPassthroughFmp4MediaFromSlice(
  track: ParsedProgressiveTrack,
  rangeData: Uint8Array,
  slice: SegmentSampleSlice,
  sequenceNumber: number,
): Uint8Array {
  const isVideo = track.handlerType === "vide";
  const samples = slice.samples;
  const upperTime = Math.floor(slice.baseMediaDecodeTime / UINT32_MOD);
  const lowerTime = Math.floor(slice.baseMediaDecodeTime % UINT32_MOD);

  const mfhdPayload = new Uint8Array(8);
  writeUint32BE(mfhdPayload, sequenceNumber, 4);
  const mfhdBox = mp4Box("mfhd", mfhdPayload);

  const tfhdPayload = new Uint8Array(24);
  tfhdPayload[3] = 0x3a;
  writeUint32BE(tfhdPayload, track.trackId, 4);
  writeUint32BE(tfhdPayload, 1, 8);
  const tfhdBox = mp4Box("tfhd", tfhdPayload);

  const tfdtPayload = new Uint8Array(12);
  tfdtPayload[0] = 0x01;
  writeUint32BE(tfdtPayload, upperTime, 4);
  writeUint32BE(tfdtPayload, lowerTime, 8);
  const tfdtBox = mp4Box("tfdt", tfdtPayload);

  // trun flags 0x000f01: data-offset | duration | size | flags | cts-offset
  const trunPayloadLen = 12 + 16 * samples.length;
  const trunBoxLen = 8 + trunPayloadLen;
  const moofBoxLen = 8 + mfhdBox.byteLength + 8 + tfhdBox.byteLength + tfdtBox.byteLength + trunBoxLen;
  const dataOffset = moofBoxLen + 8;

  const trunPayload = new Uint8Array(trunPayloadLen);
  trunPayload[0] = isVideo ? 0x01 : 0x00; // signed cts offset in v1
  trunPayload[1] = 0x00;
  trunPayload[2] = 0x0f;
  trunPayload[3] = 0x01;
  writeUint32BE(trunPayload, samples.length, 4);
  writeUint32BE(trunPayload, dataOffset, 8);

  const trunView = new DataView(trunPayload.buffer);
  let mdatDataSize = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const base = 12 + 16 * i;
    trunView.setUint32(base, s.duration, false);
    trunView.setUint32(base + 4, s.size, false);
    // flags: sync sample => dependsOn=2 (0x02000000), non-sync => dependsOn=1, isNonSync=1 (0x01010000)
    trunPayload[base + 8] = s.isSync ? 0x02 : 0x01;
    trunPayload[base + 9] = s.isSync ? 0x00 : 0x01;
    trunPayload[base + 10] = 0x00;
    trunPayload[base + 11] = 0x00;
    trunView.setInt32(base + 12, isVideo ? s.ctsOffset : 0, false);
    mdatDataSize += s.size;
  }

  const trunBox = mp4Box("trun", trunPayload);
  const trafBox = mp4Box("traf", tfhdBox, tfdtBox, trunBox);
  const moofBox = mp4Box("moof", mfhdBox, trafBox);

  const out = new Uint8Array(moofBox.byteLength + 8 + mdatDataSize);
  out.set(moofBox, 0);
  writeUint32BE(out, 8 + mdatDataSize, moofBox.byteLength);
  out[moofBox.byteLength + 4] = 0x6d;
  out[moofBox.byteLength + 5] = 0x64;
  out[moofBox.byteLength + 6] = 0x61;
  out[moofBox.byteLength + 7] = 0x74;

  let pos = moofBox.byteLength + 8;
  for (const s of samples) {
    const relStart = s.offset - slice.startByte;
    const relEnd = relStart + s.size;
    if (relStart >= 0 && relEnd <= rangeData.byteLength) {
      out.set(rangeData.subarray(relStart, relEnd), pos);
    }
    pos += s.size;
  }
  return out;
}

class SidifyMp4TrackTransmuxer implements ShakaNamespace.extern.Transmuxer {
  private readonly originalMime: string;
  private dolbyTranscoder: DolbyToFlacTranscoder | null = null;
  private emittedPassthroughInit = false;
  private sequenceNumber = 1;

  constructor(originalMime: string) {
    this.originalMime = originalMime;
  }

  private getDolbyTranscoder(): DolbyToFlacTranscoder {
    if (!this.dolbyTranscoder) {
      this.dolbyTranscoder = new DolbyToFlacTranscoder();
    }
    return this.dolbyTranscoder;
  }

  destroy(): void {
    if (this.dolbyTranscoder) {
      this.dolbyTranscoder.destroy();
      this.dolbyTranscoder = null;
    }
  }

  getOriginalMimeType(): string {
    return this.originalMime;
  }

  isSupported(mimeType: string, contentType?: string): boolean {
    const converted = this.convertCodecs(contentType || "video", mimeType);
    return isMseMimeSupported(converted);
  }

  convertCodecs(contentType: string, mimeType: string): string {
    const codecsMatch = mimeType.match(/codecs\s*=\s*"?([^";]+)"?/i);
    const codec = codecsMatch ? codecsMatch[1].trim() : "";
    const isAudio = contentType === "audio" || mimeType.startsWith("audio/");
    if (isAudio) {
      if (
        (codec === "ec-3" || codec === "ac-3") &&
        !isMseMimeSupported(`audio/mp4; codecs="${codec}"`) &&
        isFlacInMp4MseSupported()
      ) {
        return FLAC_MP4_MIME;
      }
      return `audio/mp4; codecs="${codec || "mp4a.40.2"}"`;
    }
    return `video/mp4; codecs="${codec || "avc1.640028"}"`;
  }

  async transmux(
    data: BufferSource,
    stream: ShakaNamespace.extern.Stream,
    reference: ShakaNamespace.SegmentReference | null,
    duration: number,
  ): Promise<Uint8Array | ShakaNamespace.extern.TransmuxerOutput> {
    if (!reference) {
      return new Uint8Array(0);
    }
    const ctx = streamContextMap.get(stream);
    if (!ctx) return new Uint8Array(0);

    const key = `${reference.getStartByte()}-${reference.getEndByte()}`;
    const slice = ctx.slicesByKey.get(key);
    if (!slice || slice.samples.length === 0) return new Uint8Array(0);

    const rangeBytes =
      data instanceof Uint8Array
        ? data
        : ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);

    const { track } = ctx;
    const isDolbyNeedingDecode =
      track.handlerType === "soun" &&
      (track.codecString === "ec-3" || track.codecString === "ac-3") &&
      !isMseMimeSupported(`audio/mp4; codecs="${track.codecString}"`) &&
      isFlacInMp4MseSupported();

    if (isDolbyNeedingDecode) {
      let totalRawBytes = 0;
      for (const s of slice.samples) totalRawBytes += s.size;
      const rawDolby = new Uint8Array(totalRawBytes);
      let cursor = 0;
      for (const s of slice.samples) {
        const relStart = s.offset - slice.startByte;
        const relEnd = relStart + s.size;
        if (relStart >= 0 && relEnd <= rangeBytes.byteLength) {
          rawDolby.set(rangeBytes.subarray(relStart, relEnd), cursor);
          cursor += s.size;
        }
      }
      const transcoded = await this.getDolbyTranscoder().decodeRawDolbyToFlacFmp4({
        rawDolbyBytes: rawDolby.subarray(0, cursor),
        baseMediaDecodeTime: slice.baseMediaDecodeTime,
        inputTimescale: track.timescale,
        trackId: track.trackId,
        sequenceNumber: this.sequenceNumber++,
        durationSeconds: duration,
        language: track.language,
      });
      if (!transcoded) return new Uint8Array(0);
      stream.audioSamplingRate = transcoded.sampleRate;
      stream.channelsCount = transcoded.channels;
      return { data: transcoded.data, init: transcoded.init };
    }

    const init = !this.emittedPassthroughInit
      ? buildPassthroughFmp4InitFromTrack(track)
      : null;
    this.emittedPassthroughInit = true;
    const media = buildPassthroughFmp4MediaFromSlice(
      track,
      rangeBytes,
      slice,
      this.sequenceNumber++,
    );
    return { data: media, init };
  }
}

function buildTrackSlices(track: ParsedProgressiveTrack): SegmentSampleSlice[] {
  const slices: SegmentSampleSlice[] = [];
  const samples = track.samples;
  if (samples.length === 0) return slices;

  const targetTicks = Math.max(1, Math.round(TARGET_SEGMENT_SECONDS * track.timescale));
  let groupStart = 0;

  while (groupStart < samples.length) {
    let groupEnd = groupStart + 1;
    let minByte = samples[groupStart].offset;
    let maxByte = samples[groupStart].offset + samples[groupStart].size;
    const startDts = samples[groupStart].dts;

    while (groupEnd < samples.length) {
      const candidate = samples[groupEnd];
      const elapsedTicks = candidate.dts - startDts;
      const nextMin = Math.min(minByte, candidate.offset);
      const nextMax = Math.max(maxByte, candidate.offset + candidate.size);

      if (nextMax - nextMin > MAX_SEGMENT_SPAN_BYTES) {
        break;
      }
      if (track.handlerType === "vide") {
        if (candidate.isSync && elapsedTicks >= targetTicks) {
          break;
        }
      } else if (elapsedTicks >= targetTicks) {
        break;
      }

      minByte = nextMin;
      maxByte = nextMax;
      groupEnd++;
    }

    slices.push({
      startByte: minByte,
      endByte: maxByte - 1,
      baseMediaDecodeTime: startDts,
      samples: samples.slice(groupStart, groupEnd),
    });
    groupStart = groupEnd;
  }

  return slices;
}

class SidifyProgressiveMp4Parser implements ShakaNamespace.extern.ManifestParser {
  private readonly shaka: ShakaModule;
  private config: { retryParameters?: unknown } | null = null;
  private stopped = false;

  constructor(shaka: ShakaModule) {
    this.shaka = shaka;
  }

  configure(config: unknown): void {
    this.config = config as { retryParameters?: unknown };
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  update(): void {}
  onExpirationUpdated(): void {}
  onInitialVariantChosen(): void {}
  banLocation(): void {}
  setMediaElement(): void {}

  private async fetchRange(
    uri: string,
    playerInterface: ShakaNamespace.extern.ManifestParserPlayerInterface,
    startByte: number,
    endByte?: number,
  ): Promise<{ bytes: Uint8Array; totalLength: number | null }> {
    const req = this.shaka.net.NetworkingEngine.makeRequest(
      [uri],
      this.config?.retryParameters,
    );
    req.headers["Range"] = endByte !== undefined ? `bytes=${startByte}-${endByte}` : `bytes=${startByte}-`;
    const op = playerInterface.networkingEngine.request(
      this.shaka.net.NetworkingEngine.RequestType.MANIFEST,
      req,
    );
    const resp = await op.promise;
    const contentRange = resp.headers?.["content-range"] || resp.headers?.["Content-Range"] || "";
    const totalMatch = contentRange.match(/\/(\d+)/);
    const totalLength = totalMatch ? Number(totalMatch[1]) : null;
    return {
      bytes: new Uint8Array(resp.data),
      totalLength: Number.isFinite(totalLength) ? totalLength : null,
    };
  }

  private async loadMoovBuffer(
    uri: string,
    playerInterface: ShakaNamespace.extern.ManifestParserPlayerInterface,
  ): Promise<Uint8Array> {
    const first = await this.fetchRange(uri, playerInterface, 0, INITIAL_PROBE_BYTES - 1);
    const view = new DataView(first.bytes.buffer, first.bytes.byteOffset, first.bytes.byteLength);
    let pos = 0;

    while (pos + 8 <= first.bytes.byteLength) {
      const size32 = view.getUint32(pos, false);
      const type = String.fromCharCode(
        first.bytes[pos + 4],
        first.bytes[pos + 5],
        first.bytes[pos + 6],
        first.bytes[pos + 7],
      );
      let boxSize = size32;
      if (size32 === 1) {
        if (pos + 16 > first.bytes.byteLength) break;
        const hi = view.getUint32(pos + 8, false);
        const lo = view.getUint32(pos + 12, false);
        boxSize = hi * UINT32_MOD + lo;
      } else if (size32 === 0) {
        boxSize = (first.totalLength ?? first.bytes.byteLength) - pos;
      }
      if (boxSize < 8) break;

      if (type === "moov") {
        if (pos + boxSize <= first.bytes.byteLength) {
          return first.bytes.subarray(pos, pos + boxSize);
        }
        const fullMoov = await this.fetchRange(uri, playerInterface, pos, pos + boxSize - 1);
        return fullMoov.bytes;
      }

      if (pos + boxSize > first.bytes.byteLength) {
        // e.g. mdat precedes moov; jump right past mdat to read moov!
        const afterBoxOffset = pos + boxSize;
        if (first.totalLength && afterBoxOffset < first.totalLength) {
          const tailEnd = Math.min(first.totalLength - 1, afterBoxOffset + 16 * 1024 * 1024 - 1);
          const tail = await this.fetchRange(uri, playerInterface, afterBoxOffset, tailEnd);
          return tail.bytes;
        }
        break;
      }

      pos += boxSize;
    }

    throw new this.shaka.util.Error(
      this.shaka.util.Error.Severity.CRITICAL,
      this.shaka.util.Error.Category.MANIFEST,
      this.shaka.util.Error.Code.UNABLE_TO_GUESS_MANIFEST_TYPE ?? 4000,
      uri,
    );
  }

  async start(
    uri: string,
    playerInterface: ShakaNamespace.extern.ManifestParserPlayerInterface,
  ): Promise<ShakaNamespace.extern.Manifest> {
    const moovBytes = await this.loadMoovBuffer(uri, playerInterface);
    if (this.stopped) {
      throw new Error("MP4 parser stopped");
    }

    const parsedTracks = parseProgressiveMp4Moov(moovBytes);
    const videoTracks = parsedTracks.filter((t) => t.handlerType === "vide");
    const audioTracks = parsedTracks.filter((t) => t.handlerType === "soun");

    if (videoTracks.length === 0 && audioTracks.length === 0) {
      throw new this.shaka.util.Error(
        this.shaka.util.Error.Severity.CRITICAL,
        this.shaka.util.Error.Category.MANIFEST,
        this.shaka.util.Error.Code.CONTENT_UNSUPPORTED_BY_BROWSER ?? 4032,
      );
    }

    let maxDuration = 0;
    for (const t of parsedTracks) {
      const durSec = t.durationTicks / t.timescale;
      if (durSec > maxDuration) maxDuration = durSec;
    }

    const timeline = new this.shaka.media.PresentationTimeline(null, 0);
    timeline.setDuration(maxDuration || Infinity);
    timeline.setStatic(true);

    const makeShakaStream = (track: ParsedProgressiveTrack, streamId: number): ShakaNamespace.extern.Stream => {
      const isVideo = track.handlerType === "vide";
      const mimeType = isVideo ? SIDIFY_MP4_VIDEO_MIME : SIDIFY_MP4_AUDIO_MIME;
      const fullMime = `${mimeType}; codecs="${track.codecString}"`;
      const slices = buildTrackSlices(track);
      const slicesByKey = new Map<string, SegmentSampleSlice>();
      const refs: ShakaNamespace.SegmentReference[] = [];

      const initRef = new this.shaka.media.InitSegmentReference(
        () => [],
        0,
        null,
        null,
        track.timescale,
        new Uint8Array(0),
      );

      for (let i = 0; i < slices.length; i++) {
        const s = slices[i];
        const startSec = s.baseMediaDecodeTime / track.timescale;
        const lastSample = s.samples[s.samples.length - 1];
        const endSec = (lastSample.dts + lastSample.duration) / track.timescale;
        slicesByKey.set(`${s.startByte}-${s.endByte}`, s);
        refs.push(
          new this.shaka.media.SegmentReference(
            startSec,
            Math.max(startSec + 0.001, endSec),
            () => [uri],
            s.startByte,
            s.endByte,
            initRef,
            0,
            0,
            maxDuration || Infinity,
          ),
        );
      }

      timeline.notifySegments(refs);
      const segmentIndex = new this.shaka.media.SegmentIndex(refs);

      const stream: ShakaNamespace.extern.Stream = {
        id: streamId,
        originalId: String(track.trackId),
        groupId: null,
        createSegmentIndex: () => Promise.resolve(),
        segmentIndex,
        mimeType,
        codecs: track.codecString,
        frameRate: undefined,
        pixelAspectRatio: undefined,
        width: isVideo ? track.width || undefined : undefined,
        height: isVideo ? track.height || undefined : undefined,
        encrypted: false,
        drmInfos: [],
        keyIds: new Set(),
        language: track.language || "und",
        originalLanguage: track.language || null,
        label: null,
        type: isVideo ? "video" : "audio",
        primary: streamId === 1,
        trickModeVideo: null,
        emsgSchemeIdUris: null,
        roles: [],
        forced: false,
        channelsCount: isVideo ? null : track.channelsCount,
        audioSamplingRate: isVideo ? null : track.sampleRate,
        spatialAudio: false,
        closedCaptions: new Map(),
        external: false,
        fastSwitching: false,
        fullMimeTypes: new Set([fullMime]),
        isAudioMuxedInVideo: false,
        baseOriginalId: null,
      } as unknown as ShakaNamespace.extern.Stream;

      streamContextMap.set(stream, { track, slicesByKey });
      return stream;
    };

    let nextId = 1;
    const vStreams = videoTracks.map((t) => makeShakaStream(t, nextId++));
    const aStreams = audioTracks.map((t) => makeShakaStream(t, nextId++));

    const variants: ShakaNamespace.extern.Variant[] = [];
    let variantId = 1;
    const vList: Array<ShakaNamespace.extern.Stream | null> = vStreams.length > 0 ? vStreams : [null];
    const aList: Array<ShakaNamespace.extern.Stream | null> = aStreams.length > 0 ? aStreams : [null];

    for (const v of vList) {
      for (const a of aList) {
        variants.push({
          id: variantId++,
          language: a?.language || "und",
          disabledUntilTime: 0,
          primary: Boolean(a?.primary || (!a && v?.primary)),
          audio: a,
          video: v,
          bandwidth: 2_000_000,
          drmInfos: [],
          allowedByApplication: true,
          allowedByKeySystem: true,
          decodingInfos: [],
        });
      }
    }

    const manifest: ShakaNamespace.extern.Manifest = {
      presentationTimeline: timeline,
      variants,
      textStreams: [],
      imageStreams: [],
      chapterStreams: [],
      offlineSessionIds: [],
      sequenceMode: false,
      ignoreManifestTimestampsInSegmentsMode: false,
      type: "MP4",
      serviceDescription: null,
      nextUrl: null,
      periodCount: 1,
      gapCount: 0,
      isLowLatency: false,
      startTime: null,
    };

    await playerInterface.filter(manifest);
    return manifest;
  }
}

const registeredMp4Parsers = new WeakSet<object>();

export function registerShakaMp4MseParser(shaka: ShakaModule): void {
  const mp = shaka?.media?.ManifestParser;
  const te = shaka?.transmuxer?.TransmuxerEngine;
  if (!mp || !te || registeredMp4Parsers.has(mp)) return;
  registeredMp4Parsers.add(mp);

  const appPriority = te.PluginPriority?.APPLICATION ?? 4;
  te.registerTransmuxer(
    SIDIFY_MP4_VIDEO_MIME,
    () => new SidifyMp4TrackTransmuxer(SIDIFY_MP4_VIDEO_MIME),
    appPriority,
  );
  te.registerTransmuxer(
    SIDIFY_MP4_AUDIO_MIME,
    () => new SidifyMp4TrackTransmuxer(SIDIFY_MP4_AUDIO_MIME),
    appPriority,
  );
  mp.registerParserByMime(
    SIDIFY_MP4_MSE_MIME,
    () => new SidifyProgressiveMp4Parser(shaka),
  );
}
