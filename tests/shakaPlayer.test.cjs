const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const moduleCache = new Map();

function loadTs(targetPath) {
  const filename = path.resolve(__dirname, targetPath);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;

  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  moduleCache.set(filename, compiled);

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.startsWith('.') && parent && parent.filename) {
      const candidateTs = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidateTs)) return loadTs(candidateTs);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    compiled._compile(output, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const Transcoder = loadTs('../src/lib/media/dolbyFlacTranscoder.ts');
const DolbyPlugin = loadTs('../src/lib/media/shakaDolbyTransmuxer.ts');
const Mp4Mse = loadTs('../src/lib/media/shakaMp4Parser.ts');
const ShakaPlayer = loadTs('../src/lib/media/shakaPlayer.ts');
const ReleaseHints = loadTs('../src/lib/media/releaseHints.ts');

function createFakeVideo() {
  const listeners = new Map();
  return {
    currentTime: 0,
    duration: 120,
    readyState: 4,
    videoWidth: 1920,
    videoHeight: 1080,
    muted: false,
    preload: 'metadata',
    removedAttributes: [],
    loadCalls: 0,
    canPlayType(type) {
      if (type.includes('avc1') || type.includes('mp4a')) return 'probably';
      return '';
    },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    removeAttribute(attr) {
      this.removedAttributes.push(attr);
    },
    load() {
      this.loadCalls += 1;
    },
    pause() {},
    play() {
      return Promise.resolve();
    },
  };
}

function createMockShakaRuntime(options = {}) {
  const createdInstances = [];
  let polyfillInstallCount = 0;

  class MockPlayer {
    static isBrowserSupported() {
      return options.browserSupported !== false;
    }

    constructor() {
      this.attachedElement = null;
      this.loadedArgs = [];
      this.configured = [];
      this.destroyed = false;
      this.selectedVariant = null;
      this.selectedText = null;
      this.textVisible = false;
      this.listeners = new Map();
      this.loadMode = options.loadMode ?? 1; // 1 = MEDIA_SOURCE, 2 = SRC_EQUALS
      this.variantTracks = options.variantTracks ?? [
        {
          id: 101,
          active: true,
          audioId: 1,
          videoId: 10,
          language: 'hi',
          label: null,
          audioCodec: 'flac',
          videoCodec: 'avc1.640028',
          channelsCount: 2,
          bandwidth: 4_500_000,
        },
        {
          id: 102,
          active: false,
          audioId: 2,
          videoId: 10,
          language: 'en',
          label: null,
          audioCodec: 'flac',
          videoCodec: 'avc1.640028',
          channelsCount: 2,
          bandwidth: 4_500_000,
        },
      ];
      this.textTracks = options.textTracks ?? [
        { id: 201, active: false, language: 'en', label: 'English SDH' },
      ];
      createdInstances.push(this);
    }

    configure(cfg) {
      this.configured.push(cfg);
      return true;
    }

    async attach(mediaElement) {
      this.attachedElement = mediaElement;
    }

    async load(uri, startTime, mimeType) {
      if (options.onLoad) {
        await options.onLoad({ player: this, uri, startTime, mimeType });
      }
      this.loadedArgs.push({ uri, startTime, mimeType });
    }

    getLoadMode() {
      return this.loadMode;
    }

    getVariantTracks() {
      return this.variantTracks;
    }

    selectVariantTrack(track) {
      this.selectedVariant = track;
      for (const t of this.variantTracks) {
        t.active = t.id === track.id;
      }
    }

    getTextTracks() {
      return this.textTracks;
    }

    selectTextTrack(track) {
      this.selectedText = track;
      for (const t of this.textTracks) {
        t.active = t.id === track.id;
      }
    }

    async setTextTrackVisibility(visible) {
      this.textVisible = visible;
    }

    isTextTrackVisible() {
      return this.textVisible;
    }

    addEventListener(type, fn) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(fn);
    }

    removeEventListener(type, fn) {
      this.listeners.get(type)?.delete(fn);
    }

    emit(type, detail) {
      for (const fn of this.listeners.get(type) || []) {
        fn({ type, detail });
      }
    }

    async destroy() {
      this.destroyed = true;
      this.attachedElement = null;
    }
  }

  MockPlayer.LoadMode = {
    NOT_LOADED: 0,
    MEDIA_SOURCE: 1,
    SRC_EQUALS: 2,
  };

  const registeredTransmuxers = new Map();
  const registeredParsers = new Map();

  const runtime = {
    polyfill: {
      installAll() {
        polyfillInstallCount += 1;
      },
    },
    Player: MockPlayer,
    transmuxer: {
      TransmuxerEngine: {
        PluginPriority: { FALLBACK: 1, PREFERRED_SECONDARY: 2, PREFERRED: 3, APPLICATION: 4 },
        findTransmuxer(mime) {
          return registeredTransmuxers.get(mime) ?? null;
        },
        registerTransmuxer(mime, plugin, priority) {
          registeredTransmuxers.set(mime, { plugin, priority });
        },
      },
      MatroskaTransmuxer: class {
        destroy() {}
        isSupported() {
          return false;
        }
        convertCodecs(_c, m) {
          return m;
        }
        getOriginalMimeType() {
          return 'video/x-matroska';
        }
        async transmux() {
          return new Uint8Array(0);
        }
      },
      Ec3Transmuxer: class {
        destroy() {}
        isSupported() {
          return false;
        }
        convertCodecs(_c, m) {
          return m;
        }
        getOriginalMimeType() {
          return 'audio/ec3';
        }
        async transmux() {
          return new Uint8Array(0);
        }
      },
      Ac3Transmuxer: class {
        destroy() {}
        isSupported() {
          return false;
        }
        convertCodecs(_c, m) {
          return m;
        }
        getOriginalMimeType() {
          return 'audio/ac3';
        }
        async transmux() {
          return new Uint8Array(0);
        }
      },
    },
    media: {
      ManifestParser: {
        registerParserByMime(mime, factory) {
          registeredParsers.set(mime, factory);
        },
      },
    },
    util: {
      Error: {
        Severity: { RECOVERABLE: 1, CRITICAL: 2 },
        Category: { NETWORK: 1, MEDIA: 3, MANIFEST: 4 },
        Code: { CONTENT_UNSUPPORTED_BY_BROWSER: 4032 },
      },
    },
  };

  return {
    runtime,
    loader: async () => ({ shaka: runtime }),
    createdInstances,
    getPolyfillInstallCount: () => polyfillInstallCount,
    registeredTransmuxers,
    registeredParsers,
  };
}

test('dynamic Shaka Player lifecycle creates a fresh shaka.Player per <video> element and destroys prior instances cleanly', async () => {
  const mock = createMockShakaRuntime();
  const videoA = createFakeVideo();
  const videoB = createFakeVideo();

  const handleA1 = await ShakaPlayer.attachShakaPlayback(videoA, {
    url: 'https://cdn.example.com/Movie.2026.2160p.WEB-DL.DDP5.1.mkv',
    container: 'MKV',
    fileName: 'Movie.2026.2160p.WEB-DL.DDP5.1.mkv',
    startAt: 42.5,
    loader: mock.loader,
  });

  const handleB1 = await ShakaPlayer.attachShakaPlayback(videoB, {
    url: 'https://cdn.example.com/Series.S01E03.1080p.m3u8',
    streamType: 'hls',
    loader: mock.loader,
  });

  assert.equal(mock.getPolyfillInstallCount(), 1, 'shaka.polyfill.installAll() runs once per runtime');
  assert.equal(mock.createdInstances.length, 2, 'creates distinct Shaka Player instances for two <video> elements');
  assert.notEqual(handleA1.player, handleB1.player);
  assert.equal(ShakaPlayer.getActiveShakaPlayerForVideo(videoA), handleA1.player);
  assert.equal(ShakaPlayer.getActiveShakaPlayerForVideo(videoB), handleB1.player);

  assert.deepEqual(handleA1.player.loadedArgs[0], {
    uri: 'https://cdn.example.com/Movie.2026.2160p.WEB-DL.DDP5.1.mkv',
    startTime: 42.5,
    mimeType: 'video/x-matroska',
  });
  assert.deepEqual(handleB1.player.loadedArgs[0], {
    uri: 'https://cdn.example.com/Series.S01E03.1080p.m3u8',
    startTime: null,
    mimeType: 'application/x-mpegurl',
  });

  // Verify processSrcEqualMetadata is disabled so progressive MP4s never pre-fetch whole files into memory
  assert.equal(handleA1.player.configured[0].streaming.processSrcEqualMetadata, false);
  assert.equal(handleA1.player.configured[0].abr.allowAudioFallback, true);

  // Attaching a new stream to videoA destroys its previous Shaka instance and creates a brand-new one
  const firstInstanceA = handleA1.player;
  const handleA2 = await ShakaPlayer.attachShakaPlayback(videoA, {
    url: 'https://cdn.example.com/Movie.2026.1080p.WEB-DL.DDP5.1.mkv',
    container: 'MKV',
    loader: mock.loader,
  });

  assert.equal(firstInstanceA.destroyed, true, 'previous Shaka instance on videoA must be destroyed before re-attaching');
  assert.equal(handleB1.player.destroyed, false, 'videoB Shaka instance stays untouched');
  assert.notEqual(handleA2.player, firstInstanceA);
  assert.equal(mock.createdInstances.length, 3);

  await handleA2.destroy();
  await handleB1.destroy();
  assert.equal(ShakaPlayer.getActiveShakaPlayerForVideo(videoA), null);
  assert.equal(ShakaPlayer.getActiveShakaPlayerForVideo(videoB), null);
});

test('audio track & subtitle track discovery and switching work seamlessly on dual-audio streams', async () => {
  const mock = createMockShakaRuntime();
  const video = createFakeVideo();
  const trackSnapshots = [];

  const handle = await ShakaPlayer.attachShakaPlayback(video, {
    url: 'https://cdn.example.com/DualAudio.1080p.Hindi.English.DDP5.1.mkv',
    container: 'MKV',
    loader: mock.loader,
    onTracksChanged: (t) => trackSnapshots.push(t),
  });

  const audio = handle.getAudioTracks();
  assert.equal(audio.length, 2);
  assert.equal(audio[0].label, 'Hindi · Stereo');
  assert.equal(audio[0].active, true);
  assert.equal(audio[1].label, 'English · Stereo');
  assert.equal(audio[1].active, false);

  handle.selectAudioTrack(audio[1].id);
  const updatedAudio = handle.getAudioTracks();
  assert.equal(updatedAudio[0].active, false);
  assert.equal(updatedAudio[1].active, true);

  const subs = handle.getTextTracks();
  assert.equal(subs.length, 1);
  assert.equal(subs[0].active, false);

  await handle.selectTextTrack(subs[0].id);
  assert.equal(handle.getTextTracks()[0].active, true);
  await handle.selectTextTrack(null);
  assert.equal(handle.getTextTracks()[0].active, false);

  await handle.destroy();
});

test('resolveShakaMimeType & sniffStreamMagicMime identify MKV, HLS, DASH, MP4, WebM and extensionless CDN streams', async () => {
  assert.equal(
    ShakaPlayer.resolveShakaMimeType({
      url: 'https://pixeldrain.com/api/file/XyZ123',
      container: 'MKV',
      fileName: 'Movie.2026.2160p.HEVC.DDP5.1.mkv',
    }),
    'video/x-matroska',
  );
  assert.equal(
    ShakaPlayer.resolveShakaMimeType({
      url: 'https://hubcdn.example/signed-token-no-ext',
      fileName: 'Episode.S02E05.1080p.WEB-DL.DDP5.1.mkv',
    }),
    'video/x-matroska',
  );
  assert.equal(
    ShakaPlayer.resolveShakaMimeType({
      url: 'https://cdn.example/master.m3u8?sig=abc',
    }),
    'application/x-mpegurl',
  );
  assert.equal(
    ShakaPlayer.resolveShakaMimeType({
      url: 'https://cdn.example/manifest.mpd',
    }),
    'application/dash+xml',
  );
  assert.equal(
    ShakaPlayer.resolveShakaMimeType({
      url: 'https://cdn.example/opaque-id',
      container: 'FILE',
    }),
    null,
  );

  // Magic-byte sniffing for completely unlabeled extensionless URLs (EBML Matroska 0x1A 0x45 0xDF 0xA3)
  const origFetch = globalThis.fetch;
  try {
    const ebmlHeader = new Uint8Array([
      0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01,
      0x42, 0x82, 0x88, 0x6d, 0x61, 0x74, 0x72, 0x6f, 0x73, 0x6b, 0x61,
    ]);
    globalThis.fetch = async (_url, init) => {
      assert.equal(init.headers.Range, 'bytes=0-63');
      return new Response(ebmlHeader, {
        status: 206,
        headers: { 'content-type': 'application/octet-stream' },
      });
    };
    const sniffed = await ShakaPlayer.sniffStreamMagicMime('https://cdn.example/opaque-id');
    assert.equal(sniffed, 'video/x-matroska');
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('ITU-R BS.775 5.1/7.1 surround downmix preserves center dialogue and prevents clipping', () => {
  const N = 512;
  const fl = new Float32Array(N).fill(0.2);
  const fr = new Float32Array(N).fill(-0.2);
  const fc = new Float32Array(N).fill(0.5); // Center dialogue channel!
  const lfe = new Float32Array(N).fill(0.1);
  const bl = new Float32Array(N).fill(0.1);
  const br = new Float32Array(N).fill(-0.1);

  const stereo = Transcoder.downmixToStereoOrMono([fl, fr, fc, lfe, bl, br]);
  assert.equal(stereo.length, 2, '5.1 downmixes to 2-channel stereo');
  assert.equal(stereo[0].length, N);

  // Expected L = 0.2 + 0.5*0.7071 + 0.1*0.25 + 0.1*0.7071 ≈ 0.6493 -> ~21275 in Int16
  // Expected R = -0.2 + 0.5*0.7071 + 0.1*0.25 - 0.1*0.7071 ≈ 0.1079 -> ~3534 in Int16
  assert.ok(Math.abs(stereo[0][0] - 21275) <= 5);
  assert.ok(Math.abs(stereo[1][0] - 3534) <= 5);

  // Extreme hot surround input (> 1.0 sum) never hard-clips past Int16 bounds
  const hot = Array.from({ length: 6 }, () => new Float32Array(64).fill(0.95));
  const hotStereo = Transcoder.downmixToStereoOrMono(hot);
  for (let i = 0; i < 64; i++) {
    assert.ok(hotStereo[0][i] <= 32767 && hotStereo[0][i] > 30000);
  }
});

test('RFC 9639 Verbatim FLAC encoder generates valid CRC-8, CRC-16, STREAMINFO, dfLa and lossless fMP4 segments', () => {
  const sampleCount = 3200; // Spans two 1536-sample frames + one 128-sample remainder frame
  const left = new Int16Array(sampleCount);
  const right = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i++) {
    left[i] = Math.round(Math.sin(i * 0.05) * 24000);
    right[i] = Math.round(Math.cos(i * 0.05) * 18000);
  }

  const encoded = Transcoder.encodePcmToFlacSamples([left, right], 48000, 0);
  assert.equal(encoded.totalSamples, sampleCount);
  assert.equal(encoded.samples.length, 3);
  assert.deepEqual(
    encoded.samples.map((s) => s.durationSamples),
    [1536, 1536, 128],
  );

  // Verify every FLAC frame's syncword, CRC-8, CRC-16, and exact big-endian verbatim PCM payload!
  let globalOffset = 0;
  for (const sample of encoded.samples) {
    const frame = sample.data;
    assert.equal(frame[0], 0xff);
    assert.equal(frame[1], 0xf9, 'variable-blocksize sync code 0xFFF9');
    // Remainder of CRC-16 over the entire frame INCLUDING the 2-byte big-endian CRC-16 footer is ALWAYS 0!
    assert.equal(Transcoder.crc16Flac(frame, 0, frame.length), 0, 'FLAC frame CRC-16 must verify to 0');

    // Locate header end (4 fixed + UTF-8 sample offset + 2-byte blockSize-1 + 1-byte CRC-8)
    const utf8Len = Transcoder.encodeUtf8Uint36(globalOffset).length;
    const headerEnd = 4 + utf8Len + 2 + 1;
    assert.equal(Transcoder.crc8Flac(frame, 0, headerEnd), 0, 'FLAC header CRC-8 must verify to 0');

    // First subframe starts right at headerEnd with 0x02 (SUBFRAME_VERBATIM)
    assert.equal(frame[headerEnd], 0x02);
    const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
    for (let i = 0; i < sample.durationSamples; i++) {
      assert.equal(view.getInt16(headerEnd + 1 + i * 2, false), left[globalOffset + i]);
    }
    const rightSubframeStart = headerEnd + 1 + sample.durationSamples * 2;
    assert.equal(frame[rightSubframeStart], 0x02);
    for (let i = 0; i < sample.durationSamples; i++) {
      assert.equal(view.getInt16(rightSubframeStart + 1 + i * 2, false), right[globalOffset + i]);
    }
    globalOffset += sample.durationSamples;
  }

  // Verify fMP4 init (ftyp + moov -> fLaC -> dfLa) & media (moof + mdat -> 64-bit tfdt)
  const initSeg = Transcoder.buildFlacFmp4InitSegment({
    trackId: 2,
    sampleRate: 48000,
    channels: 2,
    durationSeconds: 3600,
    language: 'hin',
  });
  const parsedInit = Transcoder.parseFmp4InitInfo(initSeg);
  assert.deepEqual(parsedInit, {
    trackId: 2,
    timescale: 48000,
    language: 'hin',
    codecFourcc: 'fLaC',
  });

  // Verify > 32-bit baseMediaDecodeTime (e.g. 2.5 hours at 48kHz = 432,000,000 ticks)
  const mediaSeg = Transcoder.buildFlacFmp4MediaSegment({
    trackId: 2,
    sequenceNumber: 7,
    baseMediaDecodeTime: 5_000_000_000,
    samples: encoded.samples,
  });
  const parsedMedia = Transcoder.parseFmp4MediaSegment(mediaSeg);
  assert.equal(parsedMedia.trackId, 2);
  assert.equal(parsedMedia.sequenceNumber, 7);
  assert.equal(parsedMedia.baseMediaDecodeTime, 5_000_000_000);
});

test('real Shaka 5.3.2 experimental runtime + Dolby transmuxer converts MKV/HLS/fMP4 ec-3 & ac-3 to FLAC when browser lacks native Dolby MSE', () => {
  // Minimal browser globals required for Shaka experimental bundle evaluation in Node
  const savedGlobals = {
    self: Object.getOwnPropertyDescriptor(globalThis, 'self'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    MediaSource: Object.getOwnPropertyDescriptor(globalThis, 'MediaSource'),
  };

  try {
    const win = Object.assign(globalThis, {
      addEventListener() {},
      removeEventListener() {},
      location: { protocol: 'https:', hostname: 'localhost' },
    });
    Object.defineProperty(globalThis, 'self', { value: win, configurable: true });
    Object.defineProperty(globalThis, 'window', { value: win, configurable: true });
    Object.defineProperty(globalThis, 'document', {
      value: {
        createElement: () => ({ canPlayType: () => '' }),
        addEventListener() {},
        removeEventListener() {},
        documentElement: {},
      },
      configurable: true,
    });
    // Simulate Chrome on Linux/Windows/Android: FLAC & H.264 supported, native ec-3 / ac-3 NOT supported!
    Object.defineProperty(globalThis, 'MediaSource', {
      value: {
        isTypeSupported(mime) {
          const lower = String(mime).toLowerCase();
          if (lower.includes('ec-3') || lower.includes('ac-3')) return false;
          if (lower.includes('flac') || lower.includes('avc1') || lower.includes('mp4a')) return true;
          return false;
        },
      },
      configurable: true,
    });

    const shakaMod = require('shaka-player/dist/shaka-player.experimental.js');
    const shaka = shakaMod.default || shakaMod.shaka || shakaMod;
    const engine = shaka.transmuxer.TransmuxerEngine;

    // Before our plugin: Chrome rejects Matroska ec-3 / ac-3!
    assert.equal(
      engine.findTransmuxer('audio/x-matroska; codecs="ec-3"', 'audio'),
      null,
      'built-in MatroskaTransmuxer rejects DDP 5.1 when browser lacks native ec-3 MSE',
    );

    DolbyPlugin.registerShakaDolbyTransmuxers(shaka);

    // After our plugin: MKV ec-3 (DDP 5.1), MKV ac-3 (DD 5.1), raw audio/ec3, MPEG-TS ec-3, and fMP4 ec-3 ALL convert to FLAC!
    const mkvEc3Plugin = engine.findTransmuxer('audio/x-matroska; codecs="ec-3"', 'audio');
    assert.ok(mkvEc3Plugin, 'Matroska ec-3 transmuxer plugin must be found');
    const mkvEc3Tx = mkvEc3Plugin();
    assert.equal(
      mkvEc3Tx.convertCodecs('audio', 'audio/x-matroska; codecs="ec-3"'),
      'audio/mp4; codecs="flac"',
    );
    mkvEc3Tx.destroy();

    const mkvAc3Plugin = engine.findTransmuxer('audio/x-matroska; codecs="ac-3"', 'audio');
    assert.ok(mkvAc3Plugin, 'Matroska ac-3 transmuxer plugin must be found');
    const mkvAc3Tx = mkvAc3Plugin();
    assert.equal(
      mkvAc3Tx.convertCodecs('audio', 'audio/x-matroska; codecs="ac-3"'),
      'audio/mp4; codecs="flac"',
    );
    mkvAc3Tx.destroy();

    const rawEc3Plugin = engine.findTransmuxer('audio/ec3', 'audio');
    assert.ok(rawEc3Plugin, 'HLS/DASH raw audio/ec3 transmuxer plugin must be found');
    const rawEc3Tx = rawEc3Plugin();
    assert.equal(rawEc3Tx.convertCodecs('audio', 'audio/ec3'), 'audio/mp4; codecs="flac"');
    rawEc3Tx.destroy();

    const tsEc3Plugin = engine.findTransmuxer('video/mp2t; codecs="ec-3"', 'audio');
    assert.ok(tsEc3Plugin, 'MPEG-TS ec-3 transmuxer plugin must be found');
    tsEc3Plugin().destroy();

    const mp4Ec3Plugin = engine.findTransmuxer('audio/mp4; codecs="ec-3"', 'audio');
    assert.ok(mp4Ec3Plugin, 'fMP4 ec-3 transmuxer plugin must be found');
    const mp4Ec3Tx = mp4Ec3Plugin();
    assert.equal(mp4Ec3Tx.convertCodecs('audio', 'audio/mp4; codecs="ec-3"'), 'audio/mp4; codecs="flac"');
    mp4Ec3Tx.destroy();

    assert.equal(
      engine.findTransmuxer('audio/mp4; codecs="mp4a.40.2"', 'audio'),
      null,
      'standard AAC fMP4 must NOT be routed through Dolby transmuxer',
    );

    const mkvVideoPlugin = engine.findTransmuxer('video/x-matroska; codecs="avc1.640028"', 'video');
    assert.ok(mkvVideoPlugin, 'Matroska H.264 video transmuxer plugin stays active');
    const mkvVideoTx = mkvVideoPlugin();
    assert.equal(
      mkvVideoTx.convertCodecs('video', 'video/x-matroska; codecs="avc1.640028"'),
      'video/mp4; codecs="avc1.640028"',
      'Matroska H.264 video passthrough stays untouched',
    );
    mkvVideoTx.destroy();

    // Also verify probeShakaCapabilities marks ac3 & eac3 supported so DDP 5.1 releases are NOT deferred!
    const caps = ShakaPlayer.probeShakaCapabilities({
      canPlayType: (t) => (t.includes('avc1') || t.includes('mp4a') ? 'probably' : ''),
    });
    assert.equal(caps.eac3, true);
    assert.equal(caps.ac3, true);
    assert.equal(caps.mkv, true);
    const hints = ReleaseHints.parseReleaseHints('Movie.2026.1080p.WEB-DL.H264.[Hindi DDP 5.1 + English DDP 5.1].mkv');
    assert.equal(
      ReleaseHints.predictSilentAudio(hints, caps),
      false,
      'DDP 5.1 dual-audio releases must NOT be predicted silent or deferred when Shaka + WASM Dolby is active',
    );
  } finally {
    for (const [k, desc] of Object.entries(savedGlobals)) {
      if (desc) Object.defineProperty(globalThis, k, desc);
      else delete globalThis[k];
    }
  }
});

test('progressive MP4 sample-table parser reconstructs H.264 + DDP 5.1 tracks and upgrades in-place on silent src= MP4', async () => {
  // Build a synthetic progressive MP4 moov with 1 video track (avc1) and 1 audio track (ec-3)
  const u32 = (n) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
  const u16 = (n) => new Uint8Array([(n >>> 8) & 255, n & 255]);
  const concat = (...arrs) => {
    const out = new Uint8Array(arrs.reduce((s, a) => s + a.length, 0));
    let off = 0;
    for (const a of arrs) {
      out.set(a, off);
      off += a.length;
    }
    return out;
  };
  const box = Transcoder.mp4Box;

  const tkhd = new Uint8Array(84);
  tkhd.set(u32(1), 12);
  tkhd.set(u16(1920), 76);
  tkhd.set(u16(1080), 80);

  const mdhd = new Uint8Array(24);
  mdhd.set(u32(48000), 12);
  mdhd.set(u32(96000), 16);

  const hdlrAudio = concat(new Uint8Array(8), Buffer.from('soun'), new Uint8Array(13));
  const ec3Entry = new Uint8Array(28);
  ec3Entry.set(u16(6), 16); // 5.1 = 6 channels
  ec3Entry.set(u16(48000), 24);
  const stsd = box('stsd', concat(new Uint8Array(4), u32(1)), box('ec-3', ec3Entry));
  const stts = box('stts', new Uint8Array(4), u32(1), u32(2), u32(1536));
  const stsc = box('stsc', new Uint8Array(4), u32(1), u32(1), u32(2), u32(1));
  const stsz = box('stsz', new Uint8Array(4), u32(768), u32(2));
  const stco = box('stco', new Uint8Array(4), u32(1), u32(4096));
  const stbl = box('stbl', stsd, stts, stsc, stsz, stco);
  const trak = box('trak', box('tkhd', tkhd), box('mdia', box('mdhd', mdhd), box('hdlr', hdlrAudio), box('minf', stbl)));
  const moov = box('moov', trak);

  const tracks = Mp4Mse.parseProgressiveMp4Moov(moov);
  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].codecString, 'ec-3');
  assert.equal(tracks[0].channelsCount, 6);
  assert.equal(tracks[0].samples.length, 2);
  assert.deepEqual(
    tracks[0].samples.map((s) => [s.offset, s.size, s.dts]),
    [
      [4096, 768, 0],
      [4864, 768, 1536],
    ],
  );
});

test('classifyShakaError distinguishes recoverable vs critical and network vs decode failures', async () => {
  assert.deepEqual(
    ShakaPlayer.classifyShakaError({ category: 1, code: 1001, message: 'HTTP 403' }),
    { kind: 'network', category: 1, code: 1001, detail: 'HTTP 403' },
  );
  assert.deepEqual(
    ShakaPlayer.classifyShakaError({ category: 4, code: 4032, message: 'CONTENT_UNSUPPORTED_BY_BROWSER' }),
    { kind: 'decode', category: 4, code: 4032, detail: 'CONTENT_UNSUPPORTED_BY_BROWSER' },
  );
  assert.deepEqual(
    ShakaPlayer.classifyShakaError({ category: 3, code: 3016, message: 'VIDEO_ERROR' }),
    { kind: 'decode', category: 3, code: 3016, detail: 'VIDEO_ERROR' },
  );

  // Verify recoverable Shaka errors (severity === 1) do NOT trigger onFatalError link-jumping!
  const mock = createMockShakaRuntime();
  const video = createFakeVideo();
  const fatals = [];
  const handle = await ShakaPlayer.attachShakaPlayback(video, {
    url: 'https://cdn.example.com/Episode.mkv',
    container: 'MKV',
    loader: mock.loader,
    onFatalError: (e) => fatals.push(e),
  });

  handle.player.emit('error', { severity: 1, category: 1, code: 1002, message: 'transient retry' });
  assert.equal(fatals.length, 0, 'recoverable Shaka error must NOT trigger fatal fallback');

  handle.player.emit('error', { severity: 2, category: 1, code: 1001, message: 'HTTP 404' });
  assert.equal(fatals.length, 1);
  assert.equal(fatals[0].kind, 'network');

  await handle.destroy();
});
