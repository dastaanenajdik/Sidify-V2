import type { Eac3Decoder } from "@audio/decode-eac3";

export const FLAC_MIN_BLOCK_SIZE = 16;
export const FLAC_MAX_BLOCK_SIZE = 4096;
export const FLAC_DEFAULT_BLOCK_SIZE = 1536;

const SQRT1_2 = Math.SQRT1_2;
const UINT32_MOD = 0x1_0000_0000;

const CRC8_TABLE = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
    table[i] = crc;
  }
  return table;
})();

const CRC16_TABLE = (() => {
  const table = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let crc = i << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x8005) & 0xffff : (crc << 1) & 0xffff;
    }
    table[i] = crc;
  }
  return table;
})();

export function crc8Flac(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc = CRC8_TABLE[(crc ^ bytes[i]) & 0xff];
  }
  return crc;
}

export function crc16Flac(bytes: Uint8Array, start = 0, end = bytes.length): number {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc = ((crc << 8) & 0xffff) ^ CRC16_TABLE[((crc >>> 8) ^ bytes[i]) & 0xff];
  }
  return crc;
}

const MAX_UINT36 = 0xf_ffff_ffff; // 68,719,476,735 (< Number.MAX_SAFE_INTEGER)

/**
 * Encodes an unsigned 36-bit integer using FLAC's extended UTF-8 coding (RFC 9639 §9.1.5).
 */
export function encodeUtf8Uint36(value: number): Uint8Array {
  const v = Math.min(MAX_UINT36, Math.max(0, Math.floor(value)));
  if (v < 0x80) {
    return new Uint8Array([v]);
  }
  if (v < 0x800) {
    return new Uint8Array([
      0xc0 | (Math.floor(v / 64) & 0x1f),
      0x80 | (v & 0x3f),
    ]);
  }
  if (v < 0x10000) {
    return new Uint8Array([
      0xe0 | (Math.floor(v / 4096) & 0x0f),
      0x80 | (Math.floor(v / 64) & 0x3f),
      0x80 | (v & 0x3f),
    ]);
  }
  if (v < 0x200000) {
    return new Uint8Array([
      0xf0 | (Math.floor(v / 262144) & 0x07),
      0x80 | (Math.floor(v / 4096) & 0x3f),
      0x80 | (Math.floor(v / 64) & 0x3f),
      0x80 | (v & 0x3f),
    ]);
  }
  if (v < 0x4000000) {
    return new Uint8Array([
      0xf8 | (Math.floor(v / 16777216) & 0x03),
      0x80 | (Math.floor(v / 262144) & 0x3f),
      0x80 | (Math.floor(v / 4096) & 0x3f),
      0x80 | (Math.floor(v / 64) & 0x3f),
      0x80 | (v & 0x3f),
    ]);
  }
  if (v < 0x80000000) {
    return new Uint8Array([
      0xfc | (Math.floor(v / 1073741824) & 0x01),
      0x80 | (Math.floor(v / 16777216) & 0x3f),
      0x80 | (Math.floor(v / 262144) & 0x3f),
      0x80 | (Math.floor(v / 4096) & 0x3f),
      0x80 | (Math.floor(v / 64) & 0x3f),
      0x80 | (v & 0x3f),
    ]);
  }
  return new Uint8Array([
    0xfe,
    0x80 | (Math.floor(v / 1073741824) & 0x3f),
    0x80 | (Math.floor(v / 16777216) & 0x3f),
    0x80 | (Math.floor(v / 262144) & 0x3f),
    0x80 | (Math.floor(v / 4096) & 0x3f),
    0x80 | (Math.floor(v / 64) & 0x3f),
    0x80 | (v & 0x3f),
  ]);
}

/**
 * Downmixes multi-channel planar Float32 PCM (e.g. 5.1 FL, FR, FC, LFE, BL, BR or 7.1)
 * to stereo (or preserves mono/stereo) using ITU-R BS.775 coefficients with peak-safe limiting,
 * returning planar signed 16-bit PCM channels.
 */
export function downmixToStereoOrMono(channelData: Float32Array[]): Int16Array[] {
  const numChannels = channelData.length;
  if (numChannels === 0) return [];
  const sampleCount = channelData[0].length;
  if (sampleCount === 0) return [];

  const toInt16 = (x: number): number => {
    const s = x <= -1 ? -32768 : x >= 1 ? 32767 : Math.round(x * 32767);
    return s < -32768 ? -32768 : s > 32767 ? 32767 : s;
  };

  if (numChannels === 1) {
    const mono = channelData[0];
    const out = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      out[i] = toInt16(mono[i]);
    }
    return [out];
  }

  if (numChannels === 2) {
    const leftIn = channelData[0];
    const rightIn = channelData[1];
    const leftOut = new Int16Array(sampleCount);
    const rightOut = new Int16Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      leftOut[i] = toInt16(leftIn[i]);
      rightOut[i] = toInt16(rightIn[i]);
    }
    return [leftOut, rightOut];
  }

  // Surround downmix (ITU-R BS.775-3 + subtle LFE warmth)
  // WAV channel layouts emitted by @audio/decode-eac3:
  // 3ch: FL, FR, FC
  // 4ch: FL, FR, BL, BR
  // 5ch: FL, FR, FC, BL, BR
  // 6ch (5.1): FL, FR, FC, LFE, BL, BR
  // 7ch: FL, FR, FC, LFE, BC, SL, SR
  // 8ch (7.1): FL, FR, FC, LFE, BL, BR, SL, SR
  const leftMix = new Float32Array(sampleCount);
  const rightMix = new Float32Array(sampleCount);
  const fl = channelData[0];
  const fr = channelData[1];

  let peak = 0;
  for (let i = 0; i < sampleCount; i++) {
    let l = fl[i];
    let r = fr[i];

    if (numChannels === 3) {
      const fc = channelData[2][i] * SQRT1_2;
      l += fc;
      r += fc;
    } else if (numChannels === 4) {
      l += channelData[2][i] * SQRT1_2;
      r += channelData[3][i] * SQRT1_2;
    } else if (numChannels === 5) {
      const fc = channelData[2][i] * SQRT1_2;
      l += fc + channelData[3][i] * SQRT1_2;
      r += fc + channelData[4][i] * SQRT1_2;
    } else if (numChannels === 6) {
      const fc = channelData[2][i] * SQRT1_2;
      const lfe = channelData[3][i] * 0.25;
      l += fc + lfe + channelData[4][i] * SQRT1_2;
      r += fc + lfe + channelData[5][i] * SQRT1_2;
    } else if (numChannels === 7) {
      const fc = channelData[2][i] * SQRT1_2;
      const lfe = channelData[3][i] * 0.25;
      const bc = channelData[4][i] * 0.5;
      l += fc + lfe + bc + channelData[5][i] * SQRT1_2;
      r += fc + lfe + bc + channelData[6][i] * SQRT1_2;
    } else {
      const fc = channelData[2][i] * SQRT1_2;
      const lfe = channelData[3][i] * 0.25;
      l += fc + lfe + (channelData[4][i] + channelData[6][i]) * 0.6;
      r += fc + lfe + (channelData[5][i] + channelData[7][i]) * 0.6;
    }

    leftMix[i] = l;
    rightMix[i] = r;
    const al = l < 0 ? -l : l;
    const ar = r < 0 ? -r : r;
    if (al > peak) peak = al;
    if (ar > peak) peak = ar;
  }

  const gain = peak > 0.98 ? 0.98 / peak : 1.0;
  const leftOut = new Int16Array(sampleCount);
  const rightOut = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    leftOut[i] = toInt16(leftMix[i] * gain);
    rightOut[i] = toInt16(rightMix[i] * gain);
  }
  return [leftOut, rightOut];
}

export interface FlacStreamInfoOptions {
  sampleRate: number;
  channels: number;
  bitsPerSample?: number;
  minBlockSize?: number;
  maxBlockSize?: number;
}

/**
 * Builds a 34-byte FLAC STREAMINFO payload (RFC 9639 §8.2).
 */
export function buildFlacStreamInfo(opts: FlacStreamInfoOptions): Uint8Array {
  const minBlockSize = opts.minBlockSize ?? FLAC_MIN_BLOCK_SIZE;
  const maxBlockSize = opts.maxBlockSize ?? FLAC_MAX_BLOCK_SIZE;
  const sampleRate = Math.max(1, Math.min(0xfffff, Math.floor(opts.sampleRate)));
  const channels = Math.max(1, Math.min(8, Math.floor(opts.channels)));
  const bitsPerSample = Math.max(4, Math.min(32, Math.floor(opts.bitsPerSample ?? 16)));

  const out = new Uint8Array(34);
  const view = new DataView(out.buffer);
  view.setUint16(0, minBlockSize, false);
  view.setUint16(2, maxBlockSize, false);
  // minFrameSize (24-bit) = 0, maxFrameSize (24-bit) = 0 (bytes 4..9)
  const packed =
    ((sampleRate & 0xfffff) * 4096) +
    (((channels - 1) & 0x07) * 512) +
    (((bitsPerSample - 1) & 0x1f) * 16);
  view.setUint32(10, packed >>> 0, false);
  view.setUint32(14, 0, false); // totalSamples unknown (0)
  // bytes 18..33 = 16-byte MD5 (all zero = unset)
  return out;
}

/**
 * Builds the 42-byte ISO BMFF `dfLa` full-box payload wrapping STREAMINFO.
 */
export function buildDfLaPayload(streamInfo: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + streamInfo.byteLength);
  // FullBox version=0, flags=0 (bytes 0..3)
  out[4] = 0x80; // last-metadata-block flag (1) | block-type STREAMINFO (0)
  out[5] = (streamInfo.byteLength >>> 16) & 0xff;
  out[6] = (streamInfo.byteLength >>> 8) & 0xff;
  out[7] = streamInfo.byteLength & 0xff;
  out.set(streamInfo, 8);
  return out;
}

function sampleRateHeaderCode(sampleRate: number): { code: number; extraBytes: number } {
  switch (sampleRate) {
    case 88200:
      return { code: 0x01, extraBytes: 0 };
    case 176400:
      return { code: 0x02, extraBytes: 0 };
    case 192000:
      return { code: 0x03, extraBytes: 0 };
    case 8000:
      return { code: 0x04, extraBytes: 0 };
    case 16000:
      return { code: 0x05, extraBytes: 0 };
    case 22050:
      return { code: 0x06, extraBytes: 0 };
    case 24000:
      return { code: 0x07, extraBytes: 0 };
    case 32000:
      return { code: 0x08, extraBytes: 0 };
    case 44100:
      return { code: 0x09, extraBytes: 0 };
    case 48000:
      return { code: 0x0a, extraBytes: 0 };
    case 96000:
      return { code: 0x0b, extraBytes: 0 };
    default:
      if (sampleRate > 0 && sampleRate <= 65535) {
        return { code: 0x0d, extraBytes: 2 };
      }
      return { code: 0x00, extraBytes: 0 }; // fall back to STREAMINFO
  }
}

function isConstantSubframe(ch: Int16Array, start: number, count: number): boolean {
  const first = ch[start];
  for (let i = 1; i < count; i++) {
    if (ch[start + i] !== first) return false;
  }
  return true;
}

/**
 * Encodes a single spec-compliant 16-bit FLAC frame (RFC 9639 §9) using
 * SUBFRAME_CONSTANT for uniform blocks and SUBFRAME_VERBATIM otherwise.
 */
export function encodeVerbatimFlacFrame(
  channelsPcm: Int16Array[],
  sampleRate: number,
  sampleNumber: number,
  startOffset = 0,
  requestedBlockSize?: number,
): Uint8Array {
  const numChannels = channelsPcm.length;
  if (numChannels < 1 || numChannels > 8) {
    throw new RangeError(`Unsupported FLAC channel count: ${numChannels}`);
  }
  const available = channelsPcm[0].length - startOffset;
  const blockSize = requestedBlockSize ?? available;
  if (blockSize < 1 || blockSize > 65535 || blockSize > available) {
    throw new RangeError(`Invalid FLAC block size: ${blockSize} (available: ${available})`);
  }

  const utf8SampleNum = encodeUtf8Uint36(sampleNumber);
  const srInfo = sampleRateHeaderCode(sampleRate);
  // Block size code 0x07 = 16-bit (blockSize - 1) stored at end of frame header.
  const blockSizeCode = 0x07;
  const headerLen = 4 + utf8SampleNum.length + 2 + srInfo.extraBytes + 1;

  const constantFlags = new Array<boolean>(numChannels);
  let subframesByteLen = 0;
  for (let c = 0; c < numChannels; c++) {
    const isConst = isConstantSubframe(channelsPcm[c], startOffset, blockSize);
    constantFlags[c] = isConst;
    subframesByteLen += isConst ? 1 + 2 : 1 + blockSize * 2;
  }

  const totalLen = headerLen + subframesByteLen + 2; // +2 for CRC-16 footer
  const frame = new Uint8Array(totalLen);

  // Sync code (14 bits: 11111111111110) + reserved (0) + blocking strategy (1 = variable blocksize)
  frame[0] = 0xff;
  frame[1] = 0xf9;
  frame[2] = (blockSizeCode << 4) | srInfo.code;
  // Independent channel assignment (numChannels - 1), sample size 0b100 = 16 bits, reserved 0
  frame[3] = ((numChannels - 1) << 4) | (0x04 << 1);

  let pos = 4;
  frame.set(utf8SampleNum, pos);
  pos += utf8SampleNum.length;

  const bsMinusOne = blockSize - 1;
  frame[pos++] = (bsMinusOne >>> 8) & 0xff;
  frame[pos++] = bsMinusOne & 0xff;

  if (srInfo.extraBytes === 2) {
    frame[pos++] = (sampleRate >>> 8) & 0xff;
    frame[pos++] = sampleRate & 0xff;
  }

  const headerCrc = crc8Flac(frame, 0, pos);
  frame[pos++] = headerCrc;

  for (let c = 0; c < numChannels; c++) {
    const ch = channelsPcm[c];
    if (constantFlags[c]) {
      // SUBFRAME_CONSTANT: pad(0) | type(000000) | wasted(0) = 0x00
      frame[pos++] = 0x00;
      const s = ch[startOffset];
      frame[pos++] = (s >>> 8) & 0xff;
      frame[pos++] = s & 0xff;
    } else {
      // SUBFRAME_VERBATIM: pad(0) | type(000001) | wasted(0) = 0x02
      frame[pos++] = 0x02;
      for (let i = 0; i < blockSize; i++) {
        const s = ch[startOffset + i];
        frame[pos++] = (s >>> 8) & 0xff;
        frame[pos++] = s & 0xff;
      }
    }
  }

  const crc16 = crc16Flac(frame, 0, pos);
  frame[pos++] = (crc16 >>> 8) & 0xff;
  frame[pos++] = crc16 & 0xff;

  return frame;
}

export interface EncodedFlacSample {
  data: Uint8Array;
  durationSamples: number;
}

/**
 * Slices planar 16-bit PCM into FLAC frames (default 1536 samples/frame, matching E-AC-3/AC-3).
 */
export function encodePcmToFlacSamples(
  channelsPcm: Int16Array[],
  sampleRate: number,
  startSampleNumber = 0,
  targetBlockSize = FLAC_DEFAULT_BLOCK_SIZE,
): { samples: EncodedFlacSample[]; totalSamples: number } {
  if (channelsPcm.length === 0 || channelsPcm[0].length === 0) {
    return { samples: [], totalSamples: 0 };
  }
  const totalSamples = channelsPcm[0].length;
  const samples: EncodedFlacSample[] = [];
  let offset = 0;
  let runningSample = startSampleNumber;

  while (offset < totalSamples) {
    const remaining = totalSamples - offset;
    let blockSize = Math.min(targetBlockSize, remaining);
    // Avoid leaving a trailing remainder shorter than FLAC_MIN_BLOCK_SIZE (16 samples)
    if (remaining - blockSize > 0 && remaining - blockSize < FLAC_MIN_BLOCK_SIZE) {
      if (remaining <= FLAC_MAX_BLOCK_SIZE) {
        blockSize = remaining;
      } else {
        blockSize = remaining - FLAC_MIN_BLOCK_SIZE;
      }
    }
    const frame = encodeVerbatimFlacFrame(channelsPcm, sampleRate, runningSample, offset, blockSize);
    samples.push({ data: frame, durationSamples: blockSize });
    offset += blockSize;
    runningSample += blockSize;
  }

  return { samples, totalSamples };
}

/* -------------------------------------------------------------------------- */
/* ISO BMFF / fMP4 Parsing & Generation                                       */
/* -------------------------------------------------------------------------- */

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

export function mp4Box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  let payloadSize = 0;
  for (const p of payloads) payloadSize += p.byteLength;
  const total = 8 + payloadSize;
  const out = new Uint8Array(total);
  writeUint32BE(out, total, 0);
  out[4] = type.charCodeAt(0) & 0xff;
  out[5] = type.charCodeAt(1) & 0xff;
  out[6] = type.charCodeAt(2) & 0xff;
  out[7] = type.charCodeAt(3) & 0xff;
  let pos = 8;
  for (const p of payloads) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  return out;
}

export interface Mp4BoxSlice {
  type: string;
  headerOffset: number;
  dataOffset: number;
  endOffset: number;
}

export function iterateMp4Boxes(
  bytes: Uint8Array,
  start = 0,
  end = bytes.byteLength,
): Mp4BoxSlice[] {
  const boxes: Mp4BoxSlice[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = start;

  while (pos + 8 <= end) {
    const size32 = view.getUint32(pos, false);
    const type = String.fromCharCode(
      bytes[pos + 4],
      bytes[pos + 5],
      bytes[pos + 6],
      bytes[pos + 7],
    );
    let headerSize = 8;
    let boxEnd: number;

    if (size32 === 1) {
      if (pos + 16 > end) break;
      const hi = view.getUint32(pos + 8, false);
      const lo = view.getUint32(pos + 12, false);
      headerSize = 16;
      boxEnd = pos + hi * UINT32_MOD + lo;
    } else if (size32 === 0) {
      boxEnd = end;
    } else {
      if (size32 < 8) break;
      boxEnd = pos + size32;
    }

    if (boxEnd > end || boxEnd <= pos) break;
    boxes.push({
      type,
      headerOffset: pos,
      dataOffset: pos + headerSize,
      endOffset: boxEnd,
    });
    pos = boxEnd;
  }

  return boxes;
}

export interface ParsedFmp4InitInfo {
  trackId: number;
  timescale: number;
  language: string;
  codecFourcc: string | null;
}

export function parseFmp4InitInfo(bytes: Uint8Array): ParsedFmp4InitInfo | null {
  const top = iterateMp4Boxes(bytes);
  const moov = top.find((b) => b.type === "moov");
  if (!moov) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let trackId = 1;
  let timescale = 48000;
  let language = "und";
  let codecFourcc: string | null = null;

  for (const child of iterateMp4Boxes(bytes, moov.dataOffset, moov.endOffset)) {
    if (child.type !== "trak") continue;
    for (const trakChild of iterateMp4Boxes(bytes, child.dataOffset, child.endOffset)) {
      if (trakChild.type === "tkhd" && trakChild.endOffset - trakChild.dataOffset >= 24) {
        const ver = bytes[trakChild.dataOffset];
        trackId = ver === 1
          ? view.getUint32(trakChild.dataOffset + 20, false)
          : view.getUint32(trakChild.dataOffset + 12, false);
      } else if (trakChild.type === "mdia") {
        for (const mdiaChild of iterateMp4Boxes(bytes, trakChild.dataOffset, trakChild.endOffset)) {
          if (mdiaChild.type === "mdhd" && mdiaChild.endOffset - mdiaChild.dataOffset >= 24) {
            const ver = bytes[mdiaChild.dataOffset];
            timescale = ver === 1
              ? view.getUint32(mdiaChild.dataOffset + 20, false)
              : view.getUint32(mdiaChild.dataOffset + 12, false);
            const langOffset = ver === 1 ? mdiaChild.dataOffset + 32 : mdiaChild.dataOffset + 20;
            if (langOffset + 2 <= mdiaChild.endOffset) {
              const langBits = view.getUint16(langOffset, false);
              const c1 = ((langBits >>> 10) & 0x1f) + 0x60;
              const c2 = ((langBits >>> 5) & 0x1f) + 0x60;
              const c3 = (langBits & 0x1f) + 0x60;
              if (c1 >= 0x61 && c1 <= 0x7a && c2 >= 0x61 && c2 <= 0x7a && c3 >= 0x61 && c3 <= 0x7a) {
                language = String.fromCharCode(c1, c2, c3);
              }
            }
          } else if (mdiaChild.type === "minf") {
            for (const minfChild of iterateMp4Boxes(bytes, mdiaChild.dataOffset, mdiaChild.endOffset)) {
              if (minfChild.type !== "stbl") continue;
              for (const stblChild of iterateMp4Boxes(bytes, minfChild.dataOffset, minfChild.endOffset)) {
                if (stblChild.type === "stsd" && stblChild.endOffset - stblChild.dataOffset >= 16) {
                  const entries = iterateMp4Boxes(bytes, stblChild.dataOffset + 8, stblChild.endOffset);
                  if (entries.length > 0) {
                    codecFourcc = entries[0].type;
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  return { trackId, timescale: timescale || 48000, language, codecFourcc };
}

export interface ParsedFmp4MediaInfo {
  trackId: number;
  sequenceNumber: number;
  baseMediaDecodeTime: number;
  mdatPayload: Uint8Array;
}

export function parseFmp4MediaSegment(bytes: Uint8Array): ParsedFmp4MediaInfo | null {
  const top = iterateMp4Boxes(bytes);
  const moof = top.find((b) => b.type === "moof");
  const mdats = top.filter((b) => b.type === "mdat");
  if (!moof || mdats.length === 0) return null;

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let trackId = 1;
  let sequenceNumber = 1;
  let baseMediaDecodeTime = 0;

  for (const child of iterateMp4Boxes(bytes, moof.dataOffset, moof.endOffset)) {
    if (child.type === "mfhd" && child.endOffset - child.dataOffset >= 8) {
      sequenceNumber = view.getUint32(child.dataOffset + 4, false);
    } else if (child.type === "traf") {
      for (const trafChild of iterateMp4Boxes(bytes, child.dataOffset, child.endOffset)) {
        if (trafChild.type === "tfhd" && trafChild.endOffset - trafChild.dataOffset >= 8) {
          trackId = view.getUint32(trafChild.dataOffset + 4, false);
        } else if (trafChild.type === "tfdt" && trafChild.endOffset - trafChild.dataOffset >= 8) {
          const ver = bytes[trafChild.dataOffset];
          if (ver === 1 && trafChild.endOffset - trafChild.dataOffset >= 12) {
            const hi = view.getUint32(trafChild.dataOffset + 4, false);
            const lo = view.getUint32(trafChild.dataOffset + 8, false);
            baseMediaDecodeTime = hi * UINT32_MOD + lo;
          } else {
            baseMediaDecodeTime = view.getUint32(trafChild.dataOffset + 4, false);
          }
        }
      }
    }
  }

  let mdatPayload: Uint8Array;
  if (mdats.length === 1) {
    mdatPayload = bytes.subarray(mdats[0].dataOffset, mdats[0].endOffset);
  } else {
    let total = 0;
    for (const m of mdats) total += m.endOffset - m.dataOffset;
    mdatPayload = new Uint8Array(total);
    let offset = 0;
    for (const m of mdats) {
      const slice = bytes.subarray(m.dataOffset, m.endOffset);
      mdatPayload.set(slice, offset);
      offset += slice.byteLength;
    }
  }

  return { trackId, sequenceNumber, baseMediaDecodeTime, mdatPayload };
}

const FTYP_ISOM = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, // size: 24
  0x66, 0x74, 0x79, 0x70, // 'ftyp'
  0x69, 0x73, 0x6f, 0x6d, // major_brand: 'isom'
  0x00, 0x00, 0x02, 0x00, // minor_version
  0x69, 0x73, 0x6f, 0x6d, // compatible: 'isom'
  0x69, 0x73, 0x6f, 0x36, // compatible: 'iso6'
]);

const DINF_BOX = new Uint8Array([
  0x00, 0x00, 0x00, 0x24, 0x64, 0x69, 0x6e, 0x66, // dinf
  0x00, 0x00, 0x00, 0x1c, 0x64, 0x72, 0x65, 0x66, // dref
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
  0x00, 0x00, 0x00, 0x0c, 0x75, 0x72, 0x6c, 0x20, // url
  0x00, 0x00, 0x00, 0x01,
]);

const EMPTY_FULL_TABLE = (fourcc: string): Uint8Array =>
  mp4Box(fourcc, new Uint8Array(8));

const EMPTY_STSZ_BOX = mp4Box("stsz", new Uint8Array(12));

function normalizeIsoLanguage(lang?: string | null): string {
  const clean = (lang || "und").trim().toLowerCase().replace(/[^a-z]/g, "");
  return clean.length >= 3 ? clean.slice(0, 3) : "und";
}

export interface FlacFmp4InitOptions {
  trackId: number;
  sampleRate: number;
  channels: number;
  durationSeconds?: number;
  language?: string | null;
}

/**
 * Generates an ISO BMFF fMP4 initialization segment (`ftyp` + `moov`) for
 * lossless FLAC audio (`audio/mp4; codecs="flac"`), matching Shaka's Mp4Generator layout.
 */
export function buildFlacFmp4InitSegment(opts: FlacFmp4InitOptions): Uint8Array {
  const trackId = Math.max(1, opts.trackId >>> 0);
  const sampleRate = Math.max(1, Math.floor(opts.sampleRate));
  const channels = Math.max(1, Math.min(8, Math.floor(opts.channels)));
  const durationTicks = Math.max(0, Math.floor((opts.durationSeconds ?? 0) * sampleRate));
  const upperDur = Math.floor(durationTicks / UINT32_MOD);
  const lowerDur = Math.floor(durationTicks % UINT32_MOD);
  const lang = normalizeIsoLanguage(opts.language);
  const langBits =
    (((lang.charCodeAt(0) - 0x60) & 0x1f) << 10) |
    (((lang.charCodeAt(1) - 0x60) & 0x1f) << 5) |
    ((lang.charCodeAt(2) - 0x60) & 0x1f);

  // mvhd (version 1, 112 bytes payload)
  const mvhdPayload = new Uint8Array(112);
  mvhdPayload[0] = 0x01;
  mvhdPayload[11] = 0x02;
  mvhdPayload[19] = 0x03;
  writeUint32BE(mvhdPayload, sampleRate, 20);
  writeUint32BE(mvhdPayload, upperDur, 24);
  writeUint32BE(mvhdPayload, lowerDur, 28);
  writeUint32BE(mvhdPayload, 0x00010000, 32); // rate 1.0
  writeUint16BE(mvhdPayload, 0x0100, 36); // volume 1.0
  writeUint32BE(mvhdPayload, 0x00010000, 48); // unity matrix
  writeUint32BE(mvhdPayload, 0x00010000, 64);
  writeUint32BE(mvhdPayload, 0x40000000, 80);
  writeUint32BE(mvhdPayload, 0xffffffff, 108); // next_track_ID

  // tkhd (version 1, 96 bytes payload)
  const tkhdPayload = new Uint8Array(96);
  tkhdPayload[0] = 0x01;
  tkhdPayload[3] = 0x07; // track_enabled | track_in_movie | track_in_preview
  tkhdPayload[11] = 0x02;
  tkhdPayload[19] = 0x03;
  writeUint32BE(tkhdPayload, trackId, 20);
  writeUint32BE(tkhdPayload, upperDur, 28);
  writeUint32BE(tkhdPayload, lowerDur, 32);
  writeUint16BE(tkhdPayload, 0x0100, 48); // audio volume 1.0
  writeUint32BE(tkhdPayload, 0x00010000, 52); // unity matrix
  writeUint32BE(tkhdPayload, 0x00010000, 68);
  writeUint32BE(tkhdPayload, 0x40000000, 84);

  // mdhd (version 1, 36 bytes payload)
  const mdhdPayload = new Uint8Array(36);
  mdhdPayload[0] = 0x01;
  mdhdPayload[11] = 0x02;
  mdhdPayload[19] = 0x03;
  writeUint32BE(mdhdPayload, sampleRate, 20);
  writeUint32BE(mdhdPayload, upperDur, 24);
  writeUint32BE(mdhdPayload, lowerDur, 28);
  writeUint16BE(mdhdPayload, langBits, 32);

  // hdlr ('soun')
  const hdlrPayload = new Uint8Array([
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x73, 0x6f, 0x75, 0x6e, // 'soun'
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x53, 0x6f, 0x75, 0x6e, 0x64, 0x48, 0x61, 0x6e, 0x64, 0x6c, 0x65, 0x72, 0x00,
  ]);

  // smhd (8 bytes payload)
  const smhdPayload = new Uint8Array(8);

  // fLaC AudioSampleEntry (28-byte header + dfLa box)
  const audioEntryHeader = new Uint8Array(28);
  audioEntryHeader[7] = 0x01; // data_reference_index = 1
  audioEntryHeader[17] = channels;
  writeUint16BE(audioEntryHeader, 16, 18); // sampleSize = 16 bits
  writeUint16BE(audioEntryHeader, sampleRate > 0xffff ? 0 : sampleRate, 24);

  const streamInfo = buildFlacStreamInfo({ sampleRate, channels, bitsPerSample: 16 });
  const dfLaBox = mp4Box("dfLa", buildDfLaPayload(streamInfo));
  const flacEntry = mp4Box("fLaC", audioEntryHeader, dfLaBox);

  const stsdHeader = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);
  const stsdBox = mp4Box("stsd", stsdHeader, flacEntry);

  const stblBox = mp4Box(
    "stbl",
    stsdBox,
    EMPTY_FULL_TABLE("stts"),
    EMPTY_FULL_TABLE("stsc"),
    EMPTY_STSZ_BOX,
    EMPTY_FULL_TABLE("stco"),
  );

  const minfBox = mp4Box("minf", mp4Box("smhd", smhdPayload), DINF_BOX, stblBox);
  const mdiaBox = mp4Box("mdia", mp4Box("mdhd", mdhdPayload), mp4Box("hdlr", hdlrPayload), minfBox);
  const trakBox = mp4Box("trak", mp4Box("tkhd", tkhdPayload), mdiaBox);

  const trexPayload = new Uint8Array(24);
  writeUint32BE(trexPayload, trackId, 4);
  writeUint32BE(trexPayload, 1, 8); // default_sample_description_index = 1
  const mvexBox = mp4Box("mvex", mp4Box("trex", trexPayload));

  const moovBox = mp4Box("moov", mp4Box("mvhd", mvhdPayload), trakBox, mvexBox);

  const out = new Uint8Array(FTYP_ISOM.byteLength + moovBox.byteLength);
  out.set(FTYP_ISOM, 0);
  out.set(moovBox, FTYP_ISOM.byteLength);
  return out;
}

export interface FlacFmp4MediaOptions {
  trackId: number;
  sequenceNumber: number;
  baseMediaDecodeTime: number;
  samples: EncodedFlacSample[];
}

/**
 * Generates an ISO BMFF fMP4 media segment (`moof` + `mdat`) for encoded FLAC audio samples.
 */
export function buildFlacFmp4MediaSegment(opts: FlacFmp4MediaOptions): Uint8Array {
  const trackId = Math.max(1, opts.trackId >>> 0);
  const sequenceNumber = Math.max(1, opts.sequenceNumber >>> 0);
  const baseTime = Math.max(0, Math.round(opts.baseMediaDecodeTime));
  const upperTime = Math.floor(baseTime / UINT32_MOD);
  const lowerTime = Math.floor(baseTime % UINT32_MOD);
  const samples = opts.samples;

  // mfhd (8 bytes payload -> 16 bytes box)
  const mfhdPayload = new Uint8Array(8);
  writeUint32BE(mfhdPayload, sequenceNumber, 4);
  const mfhdBox = mp4Box("mfhd", mfhdPayload);

  // tfhd (24 bytes payload -> 32 bytes box, matching Shaka TFHD_TEMPLATE_)
  const tfhdPayload = new Uint8Array(24);
  tfhdPayload[3] = 0x3a; // sample-description-index | default-duration | default-size | default-flags
  writeUint32BE(tfhdPayload, trackId, 4);
  writeUint32BE(tfhdPayload, 1, 8); // sample_description_index = 1
  const tfhdBox = mp4Box("tfhd", tfhdPayload);

  // tfdt (version 1, 12 bytes payload -> 20 bytes box)
  const tfdtPayload = new Uint8Array(12);
  tfdtPayload[0] = 0x01;
  writeUint32BE(tfdtPayload, upperTime, 4);
  writeUint32BE(tfdtPayload, lowerTime, 8);
  const tfdtBox = mp4Box("tfdt", tfdtPayload);

  // trun (flags 0x000301: data-offset-present | sample-duration-present | sample-size-present)
  // 12 bytes header + 8 bytes per audio sample
  const trunPayloadLen = 12 + 8 * samples.length;
  const trunBoxLen = 8 + trunPayloadLen;
  const moofBoxLen = 8 + mfhdBox.byteLength + 8 + tfhdBox.byteLength + tfdtBox.byteLength + trunBoxLen;
  const dataOffset = moofBoxLen + 8; // +8 for mdat box header

  const trunPayload = new Uint8Array(trunPayloadLen);
  trunPayload[0] = 0x00; // version 0
  trunPayload[1] = 0x00;
  trunPayload[2] = 0x03; // sample-duration-present (0x0100) | sample-size-present (0x0200)
  trunPayload[3] = 0x01; // data-offset-present (0x0001)
  writeUint32BE(trunPayload, samples.length, 4);
  writeUint32BE(trunPayload, dataOffset, 8);

  let mdatDataSize = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const base = 12 + i * 8;
    writeUint32BE(trunPayload, s.durationSamples, base);
    writeUint32BE(trunPayload, s.data.byteLength, base + 4);
    mdatDataSize += s.data.byteLength;
  }
  const trunBox = mp4Box("trun", trunPayload);
  const trafBox = mp4Box("traf", tfhdBox, tfdtBox, trunBox);
  const moofBox = mp4Box("moof", mfhdBox, trafBox);

  const totalLen = moofBox.byteLength + 8 + mdatDataSize;
  const out = new Uint8Array(totalLen);
  out.set(moofBox, 0);
  writeUint32BE(out, 8 + mdatDataSize, moofBox.byteLength);
  out[moofBox.byteLength + 4] = 0x6d; // 'm'
  out[moofBox.byteLength + 5] = 0x64; // 'd'
  out[moofBox.byteLength + 6] = 0x61; // 'a'
  out[moofBox.byteLength + 7] = 0x74; // 't'

  let pos = moofBox.byteLength + 8;
  for (const s of samples) {
    out.set(s.data, pos);
    pos += s.data.byteLength;
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Streaming E-AC-3 / AC-3 WASM -> FLAC-in-fMP4 Transcoder                     */
/* -------------------------------------------------------------------------- */

let decoderFactoryPromise: Promise<typeof import("@audio/decode-eac3")> | null = null;

export function loadEac3DecoderModule(): Promise<typeof import("@audio/decode-eac3")> {
  if (!decoderFactoryPromise) {
    decoderFactoryPromise = import("@audio/decode-eac3");
  }
  return decoderFactoryPromise;
}

export async function createEac3WasmDecoder(): Promise<Eac3Decoder> {
  const mod = await loadEac3DecoderModule();
  return mod.decoder();
}

export interface TranscodedAudioSegment {
  init: Uint8Array | null;
  data: Uint8Array;
  sampleRate: number;
  channels: number;
}

/**
 * Stateful per-track transcoder that decodes E-AC-3 (DDP 5.1/7.1) or AC-3 (DD 5.1)
 * syncframes using FFmpeg libavcodec WASM (`@audio/decode-eac3`) and packages the
 * output into lossless FLAC-in-fMP4 segments preserving exact media timestamps.
 */
export class DolbyToFlacTranscoder {
  private wasmDecoder: Eac3Decoder | null = null;
  private decoderInitPromise: Promise<Eac3Decoder> | null = null;
  private destroyed = false;

  private trackId = 1;
  private inputTimescale = 48000;
  private language = "und";
  private emittedInitKey: string | null = null;
  private nextSequenceNumber = 1;
  private expectedNextSamplePts: number | null = null;
  private runningSampleCounter = 0;

  private async ensureDecoder(): Promise<Eac3Decoder> {
    if (this.destroyed) {
      throw new Error("DolbyToFlacTranscoder has already been destroyed");
    }
    if (this.wasmDecoder) return this.wasmDecoder;
    if (!this.decoderInitPromise) {
      this.decoderInitPromise = createEac3WasmDecoder().then((dec) => {
        if (this.destroyed) {
          dec.free();
          throw new Error("DolbyToFlacTranscoder destroyed during initialization");
        }
        this.wasmDecoder = dec;
        return dec;
      });
    }
    return this.decoderInitPromise;
  }

  ingestFmp4Init(initBytes: Uint8Array): void {
    const parsed = parseFmp4InitInfo(initBytes);
    if (!parsed) return;
    this.trackId = parsed.trackId;
    if (parsed.timescale > 0) {
      this.inputTimescale = parsed.timescale;
    }
    if (parsed.language && parsed.language !== "und") {
      this.language = parsed.language;
    }
  }

  configureTrack(opts: { trackId?: number; timescale?: number; language?: string | null }): void {
    if (opts.trackId && opts.trackId > 0) this.trackId = opts.trackId;
    if (opts.timescale && opts.timescale > 0) this.inputTimescale = opts.timescale;
    if (opts.language) this.language = opts.language;
  }

  async decodeRawDolbyToFlacFmp4(opts: {
    rawDolbyBytes: Uint8Array;
    baseMediaDecodeTime: number;
    inputTimescale?: number;
    trackId?: number;
    sequenceNumber?: number;
    durationSeconds?: number;
    language?: string | null;
    forceEmitInit?: boolean;
  }): Promise<TranscodedAudioSegment | null> {
    if (opts.rawDolbyBytes.byteLength === 0) return null;
    const dec = await this.ensureDecoder();

    const inTimescale = opts.inputTimescale ?? this.inputTimescale;
    const trackId = opts.trackId ?? this.trackId;
    const lang = opts.language ?? this.language;

    // Detect seeks / timeline discontinuities (> 250ms jump) and flush partial frame state
    if (this.expectedNextSamplePts !== null && inTimescale > 0) {
      const approxIncomingSec = opts.baseMediaDecodeTime / inTimescale;
      if (Math.abs(approxIncomingSec - this.expectedNextSamplePts) > 0.25) {
        try {
          dec.flush();
        } catch {
          // Ignore flush errors on boundary reset
        }
      }
    }

    const decoded = dec.decode(opts.rawDolbyBytes);
    if (!decoded.channelData || decoded.channelData.length === 0 || decoded.channelData[0].length === 0) {
      return null;
    }

    const sampleRate = decoded.sampleRate || 48000;
    const pcmChannels = downmixToStereoOrMono(decoded.channelData);
    const outChannels = pcmChannels.length;

    const scaledBaseDecodeTime =
      inTimescale === sampleRate || inTimescale <= 0
        ? Math.round(opts.baseMediaDecodeTime)
        : Math.round(opts.baseMediaDecodeTime * (sampleRate / inTimescale));

    const { samples, totalSamples } = encodePcmToFlacSamples(
      pcmChannels,
      sampleRate,
      this.runningSampleCounter,
    );
    if (samples.length === 0) return null;

    this.runningSampleCounter += totalSamples;
    this.expectedNextSamplePts = (scaledBaseDecodeTime + totalSamples) / sampleRate;

    const initKey = `${trackId}:${sampleRate}:${outChannels}:${lang}`;
    const shouldEmitInit = Boolean(opts.forceEmitInit) || this.emittedInitKey !== initKey;
    const init = shouldEmitInit
      ? buildFlacFmp4InitSegment({
          trackId,
          sampleRate,
          channels: outChannels,
          durationSeconds: opts.durationSeconds ?? 0,
          language: lang,
        })
      : null;
    this.emittedInitKey = initKey;

    const seq = opts.sequenceNumber ?? this.nextSequenceNumber++;
    if (opts.sequenceNumber !== undefined && opts.sequenceNumber >= this.nextSequenceNumber) {
      this.nextSequenceNumber = opts.sequenceNumber + 1;
    }

    const data = buildFlacFmp4MediaSegment({
      trackId,
      sequenceNumber: seq,
      baseMediaDecodeTime: scaledBaseDecodeTime,
      samples,
    });

    return {
      init,
      data,
      sampleRate,
      channels: outChannels,
    };
  }

  /**
   * Accepts an fMP4 segment (`moof`+`mdat`, optionally preceded by or paired with `ftyp`+`moov`)
   * containing `ec-3` or `ac-3` syncframes and transcodes it to FLAC-in-fMP4.
   */
  async transcodeFmp4Segment(
    mediaBytes: Uint8Array,
    initBytes?: Uint8Array | null,
    durationSeconds?: number,
    languageHint?: string | null,
  ): Promise<TranscodedAudioSegment | null> {
    if (initBytes && initBytes.byteLength > 0) {
      this.ingestFmp4Init(initBytes);
    }
    // Some transmuxers concatenate ftyp+moov+moof+mdat into a single Uint8Array
    const inlineInit = parseFmp4InitInfo(mediaBytes);
    if (inlineInit) {
      this.trackId = inlineInit.trackId;
      if (inlineInit.timescale > 0) this.inputTimescale = inlineInit.timescale;
      if (inlineInit.language && inlineInit.language !== "und") {
        this.language = inlineInit.language;
      }
    }

    const parsedMedia = parseFmp4MediaSegment(mediaBytes);
    if (!parsedMedia || parsedMedia.mdatPayload.byteLength === 0) {
      return null;
    }

    return this.decodeRawDolbyToFlacFmp4({
      rawDolbyBytes: parsedMedia.mdatPayload,
      baseMediaDecodeTime: parsedMedia.baseMediaDecodeTime,
      inputTimescale: this.inputTimescale,
      trackId: parsedMedia.trackId,
      sequenceNumber: parsedMedia.sequenceNumber,
      durationSeconds,
      language: languageHint || this.language,
    });
  }

  destroy(): void {
    this.destroyed = true;
    if (this.wasmDecoder) {
      try {
        this.wasmDecoder.free();
      } catch {
        // Ignore WASM teardown errors
      }
      this.wasmDecoder = null;
    }
    this.decoderInitPromise = null;
  }
}
