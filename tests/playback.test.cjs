const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

/**
 * "Try Play (beta)", quality picker, season tabs and external-player helpers. All of it is
 * framework-free, so it compiles and runs here without React or a DOM.
 */
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
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    compiled._compile(output, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const Hints = loadTs('../src/lib/media/releaseHints.ts');
const Caps = loadTs('../src/lib/media/browserCaps.ts');
const Ext = loadTs('../src/lib/media/externalPlayers.ts');
const Launch = loadTs('../src/lib/media/externalLaunch.ts');
const ExtStream = loadTs('../src/lib/media/externalStream.ts');
const Plan = loadTs('../src/lib/media/playbackPlan.ts');
const Tabs = loadTs('../src/lib/media/seasonTabs.ts');
const Resolver = loadTs('../src/lib/media/hubResolver.ts');
const UserError = loadTs('../src/lib/media/userError.ts');
const Resume = loadTs('../src/lib/media/resumePoints.ts');

/* -------------------------------- fixtures ------------------------------- */

let seq = 0;
function release(over = {}) {
  seq += 1;
  const id = over.id || `rel-${seq}`;
  return {
    id,
    title: over.title || `Release ${id}`,
    fileName: over.fileName || `Show.${over.quality || ''}.mkv`,
    quality: over.quality,
    size: over.size,
    sizeBytes: over.sizeBytes,
    container: over.container ?? 'MKV',
    isPack: over.isPack,
    seasonNumber: over.seasonNumber,
    mirrors:
      over.mirrors ||
      [
        { id: `${id}-m1`, label: 'HubCloud', shortUrl: `https://greenmotors.club/?id=${id}-hc`, host: 'greenmotors.club' },
        { id: `${id}-m2`, label: 'HubDrive', shortUrl: `https://greenmotors.club/?id=${id}-hd`, host: 'greenmotors.club' },
      ],
  };
}

function link(url, over = {}) {
  return { server: over.server || 'FSL Server', url, playable: Boolean(over.playable), delivery: over.delivery || 'download', container: over.container ?? 'MKV', streamType: over.streamType };
}

function resolved(links) {
  return { status: 'resolved', links, hops: [] };
}

/* ------------------------------ release hints ---------------------------- */

test('parseReleaseHints reads codec hints from real 4KHDHub-style file names', () => {
  const h = Hints.parseReleaseHints(
    'Marvels The Punisher S02E07 2160p NF WEB-DL DoVi HDR 10bit HEVC [Hindi DDP 5.1 + English DDP 5.1 Atmos] x265 (SiC-4kHDHub.com).mkv'
  );
  assert.equal(h.video, 'hevc');
  assert.equal(h.tenBit, true);
  assert.equal(h.hdr, 'dv');
  assert.deepEqual(h.audio, ['eac3']);
  assert.equal(h.atmos, true);
  assert.equal(h.container, 'MKV');
  assert.deepEqual(Hints.hintChips(h), ['HEVC', '10-bit', 'DV', 'DDP', 'Atmos']);

  const mixed = Hints.parseReleaseHints("Marvel's The Punisher S01 1080p NF WEB-DL 10bit HEVC [Hindi DDP 5.1 + English DD 5.1] x265.zip");
  assert.deepEqual(mixed.audio, ['eac3', 'ac3']);
  assert.equal(mixed.container, 'ZIP');

  const web = Hints.parseReleaseHints('Movie.2024.1080p.WEB-DL.AAC2.0.H.264.mp4');
  assert.equal(web.video, 'h264');
  assert.deepEqual(web.audio, ['aac']);
  assert.equal(web.container, 'MP4');

  const remux = Hints.parseReleaseHints('Film (2026) 2160p UHD BluRay REMUX DV HDR10P HEVC TrueHD 7.1 Atmos');
  assert.equal(remux.remux, true);
  assert.equal(remux.hdr, 'dv');
  assert.deepEqual(remux.audio, ['truehd']);

  assert.deepEqual(Hints.parseReleaseHints('Show S01E01 720p x264 DD+5.1').audio, ['eac3']);
  assert.deepEqual(Hints.parseReleaseHints('Show E-AC-3 vs EAC3').audio, ['eac3']);
  assert.deepEqual(Hints.parseReleaseHints('Film DTS-HD MA 5.1 x264').audio, ['dts']);
  assert.equal(Hints.parseReleaseHints('Old.DVDRip.XviD').hdr, undefined, 'DVD is not Dolby Vision');
});

test('compatibilityNotes are hedged hints built from file names + reported capabilities', () => {
  const chrome = { h264: true, hevc: false, av1: true, vp9: true, aac: true, ac3: false, eac3: false, opus: true, mkv: true };
  const edge = { ...chrome, hevc: true, ac3: true, eac3: true };
  const hints = Hints.parseReleaseHints('S02E01 2160p HEVC [Hindi DDP 5.1]');

  const chromeNotes = Hints.compatibilityNotes(hints, chrome);
  assert.equal(chromeNotes.length, 2);
  assert.ok(chromeNotes.every((n) => /may/.test(n)), 'never a definitive claim');
  assert.ok(chromeNotes.some((n) => /HEVC/.test(n)));
  assert.ok(chromeNotes.some((n) => /Dolby/.test(n)));

  assert.deepEqual(Hints.compatibilityNotes(hints, edge), []);
  assert.deepEqual(Hints.compatibilityNotes(hints, null), []);
  assert.equal(Hints.compatibilityNotes(Hints.parseReleaseHints('x264 AAC'), chrome).length, 0);
});

test('probeBrowserCapabilities maps canPlayType self-reports; MKV "" stays unknown', () => {
  const chromeLike = {
    canPlayType(type) {
      if (/avc1|mp4a|vp9|vp09|av01|opus/.test(type)) return 'probably';
      if (type === 'video/x-matroska') return 'maybe';
      return '';
    },
  };
  const caps = Caps.probeBrowserCapabilities(chromeLike);
  assert.deepEqual(caps, { h264: true, hevc: false, av1: true, vp9: true, aac: true, ac3: false, eac3: false, opus: true, mkv: true, audioCounters: false });

  const safariLike = { canPlayType: (type) => (/hvc1|avc1|mp4a|ac-3|ec-3/.test(type) ? 'probably' : '') };
  const safari = Caps.probeBrowserCapabilities(safariLike);
  assert.equal(safari.hevc, true);
  assert.equal(safari.eac3, true);
  assert.equal(safari.mkv, null, '"" is unknown, not a verdict');
});

/* ---------------------------- external players --------------------------- */

test('detectClientPlatform covers Android, iPhone, iPadOS desktop mode, Mac and Windows', () => {
  assert.equal(Ext.detectClientPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/130' }), 'android');
  assert.equal(Ext.detectClientPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), 'ios');
  assert.equal(
    Ext.detectClientPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605', maxTouchPoints: 5 }),
    'ios'
  );
  assert.equal(Ext.detectClientPlatform({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }), 'mac');
  assert.equal(Ext.detectClientPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130' }), 'desktop');
  assert.equal(Ext.detectClientPlatform(null), 'desktop');
});

test('external player links are platform-specific, encoded, and never offered for non-HTTPS URLs', () => {
  const url = 'https://cdn.example.com/files/Show.S01E01.mkv?token=a1b2#frag';
  assert.equal(
    Ext.androidIntentUrl(url, {
      packageName: 'org.videolan.vlc',
      title: 'My Show S01E01',
      browserFallbackUrl: 'https://play.google.com/store/apps/details?id=org.videolan.vlc',
    }),
    'intent://cdn.example.com/files/Show.S01E01.mkv?token=a1b2#Intent;scheme=https;action=android.intent.action.VIEW;type=video/*;package=org.videolan.vlc;S.title=My%20Show%20S01E01;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dorg.videolan.vlc;end'
  );

  const android = Ext.externalPlayerOptions(url, { platform: 'android', title: 'My Show' });
  assert.deepEqual(android.map((o) => o.id), ['vlc', 'mx', 'android-chooser']);
  assert.ok(android[1].href.includes('package=com.mxtech.videoplayer.ad'));
  assert.ok(!android[2].href.includes('package='), 'chooser lets Android pick any player');

  const ios = Ext.externalPlayerOptions(url, { platform: 'ios' });
  assert.equal(ios[0].href, `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent('https://cdn.example.com/files/Show.S01E01.mkv?token=a1b2')}`);
  assert.ok(ios[1].href.startsWith('infuse://x-callback-url/play?url=https%3A%2F%2F'));

  const desktop = Ext.externalPlayerOptions(url, { platform: 'desktop', title: 'My Show: S01E01' });
  assert.equal(desktop.length, 1);
  assert.equal(desktop[0].file.fileName, 'My.Show.S01E01.m3u');
  assert.equal(desktop[0].file.content, '#EXTM3U\n#EXTINF:-1,My Show: S01E01\nhttps://cdn.example.com/files/Show.S01E01.mkv?token=a1b2\n');

  assert.deepEqual(Ext.externalPlayerOptions('http://insecure.example.com/a.mkv', { platform: 'android' }), []);
  assert.deepEqual(Ext.externalPlayerOptions('javascript:alert(1)', { platform: 'desktop' }), []);
});

/* --------------------------- "Play with VLC" ----------------------------- */

test('detectClientPlatform keeps an Apple Silicon laptop on the desktop path, iPad on iOS', () => {
  const macUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605';
  // Apple Silicon Macs report touch AND the same UA as an iPad in desktop mode: the pointer
  // is what tells them apart.
  assert.equal(Ext.detectClientPlatform({ userAgent: macUa, maxTouchPoints: 5, hasFinePointer: true }), 'mac');
  assert.equal(Ext.detectClientPlatform({ userAgent: macUa, maxTouchPoints: 5, hasFinePointer: false }), 'ios');
  assert.equal(Ext.detectClientPlatform({ userAgent: macUa, maxTouchPoints: 5 }), 'ios', 'unknown pointer stays on the touch path');
});

test('vlcLaunchPlan opens the app on phones and saves a playlist on computers', () => {
  const url = 'https://cdn.example.com/files/Show.S01E01.mkv?token=a1b2';

  const android = Ext.vlcLaunchPlan(url, { platform: 'android', title: 'My Show S01E01' });
  assert.equal(android.mode, 'app');
  assert.ok(android.href.startsWith('intent://cdn.example.com/files/Show.S01E01.mkv?token=a1b2#Intent;'));
  assert.ok(android.href.includes('package=org.videolan.vlc'), 'only VLC answers this intent');
  assert.ok(android.href.includes('S.browser_fallback_url=https%3A%2F%2Fplay.google.com'), 'Play Store when VLC is missing');

  const ios = Ext.vlcLaunchPlan(url, { platform: 'ios' });
  assert.equal(ios.mode, 'app');
  assert.equal(ios.href, `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(url)}`);

  const desktop = Ext.vlcLaunchPlan(url, { platform: 'desktop', title: 'My Show' });
  assert.equal(desktop.mode, 'playlist');
  assert.equal(desktop.file.fileName, 'My.Show.m3u');
  assert.equal(desktop.file.content, `#EXTM3U\n#EXTINF:-1,My Show\n${url}\n`);
  assert.equal(Ext.vlcLaunchPlan('http://plain.example.com/a.mkv', { platform: 'android' }), null);
  assert.equal(Ext.vlcLaunchPlan('javascript:alert(1)', { platform: 'ios' }), null);
});

test('isDirectMediaUrl accepts only https links without embedded credentials', () => {
  assert.equal(Ext.isDirectMediaUrl('https://cdn.example.com/a.mkv?token=1'), true);
  assert.equal(Ext.isDirectMediaUrl('https://user:pass@cdn.example.com/a.mkv'), false);
  assert.equal(Ext.isDirectMediaUrl('http://cdn.example.com/a.mkv'), false);
  assert.equal(Ext.isDirectMediaUrl('blob:https://cdn.example.com/x'), false);
  assert.equal(Ext.isDirectMediaUrl(''), false);
  assert.equal(Ext.isDirectMediaUrl(null), false);
});

test('a player app may be pointed at any single file, packs and mirror-less rows never', () => {
  const mkv = release({ quality: '1080p' });
  const mp4 = release({ quality: '720p', container: 'MP4' });
  const pack = release({ quality: '2160p', isPack: true, container: 'ZIP' });
  const noMirrors = release({ quality: '480p', mirrors: [] });

  const queue = Plan.externalPlayerReleases([pack, mp4, noMirrors, mkv]);
  assert.deepEqual(queue.map((r) => r.id), [mkv.id, mp4.id], 'best first, MKV included, ZIP excluded');
});

test('externalPlayerLink picks a streamable file, skips landing pages and archives', () => {
  const onlyPage = [link('https://hubcloud.one/drive/page', { delivery: 'external', container: 'PAGE' })];
  assert.equal(Plan.externalPlayerLink(onlyPage), undefined, 'a landing page is not a stream');

  const direct = Plan.externalPlayerLink([
    link('https://pub-x.r2.dev/Show.S01.zip', { container: 'ZIP' }),
    link('https://fsl.example.net/Show.mkv', { server: 'FSL Server' }),
    link('https://cdn.example.com/master.m3u8', { server: 'HLS', playable: true, delivery: 'stream', container: 'HLS', streamType: 'hls' }),
  ]);
  assert.equal(direct.url, 'https://cdn.example.com/master.m3u8', 'verified stream first, archives never');
  assert.equal(direct.streamType, 'hls');

  const downloadOnly = Plan.externalPlayerLink([link('https://pixeldrain.com/api/file/AbC?download', { server: 'PixelServer' })]);
  assert.equal(downloadOnly.url, 'https://pixeldrain.com/api/file/AbC?download', 'the exact resolved link for a player app');
});

test('detectClientPlatform keeps Android Chrome "Desktop site" mode on android while keeping Linux PCs on desktop', () => {
  const linuxDesktopModeUa = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36';
  assert.equal(
    Ext.detectClientPlatform({ userAgent: linuxDesktopModeUa, maxTouchPoints: 5, hasFinePointer: false }),
    'android',
    'coarse touch Linux is an Android phone in Desktop-site mode'
  );
  assert.equal(
    Ext.detectClientPlatform({ userAgent: linuxDesktopModeUa, uaDataPlatform: 'Android', maxTouchPoints: 5, hasFinePointer: true }),
    'android',
    'Client Hints Android stays on android'
  );
  assert.equal(
    Ext.detectClientPlatform({ userAgent: linuxDesktopModeUa, maxTouchPoints: 5, hasFinePointer: true }),
    'desktop',
    'touchscreen Linux laptop with mouse/trackpad stays desktop'
  );
  assert.equal(Ext.detectClientPlatform({ userAgent: linuxDesktopModeUa, maxTouchPoints: 0 }), 'desktop');
});

test('externalPlayerLinks returns EVERY streamable server link per quality with direct CDN ahead of two-step/rate-limited hosts', () => {
  const links = Plan.externalPlayerLinks([
    link('https://hubcloud.one/drive/page', { delivery: 'external', container: 'PAGE' }),
    link('https://pub-x.r2.dev/Show.S01.zip', { container: 'ZIP' }),
    link('https://pixeldrain.com/api/file/AbC?download', { server: 'PixelServer', container: 'MKV' }),
    link('https://gpdl.hubcdn.fans/?id=tok123', { server: 'Download [10Gbps]', container: 'MKV' }),
    link('https://pub-abc.r2.dev/Movie.2026.1080p.mkv', { server: 'FSL Server', container: 'MKV' }),
  ]);

  assert.deepEqual(
    links.map((item) => item.server),
    ['FSL Server', 'Download [10Gbps]', 'PixelServer'],
    'FSL / R2 direct CDN leads, all valid stream links kept, landing pages & archives dropped'
  );
});

test('resolveAllReleaseStreams resolves every quality concurrently, skips blocked mirrors, and keeps every server link', async () => {
  const q480 = release({ id: 'q480', quality: '480p', mirrors: [{ label: 'M1', shortUrl: 'https://m.example/480' }] });
  const q2160 = release({
    id: 'q2160',
    quality: '2160p',
    mirrors: [
      { label: 'Blocked', shortUrl: 'https://m.example/2160-blocked' },
      { label: 'Backup', shortUrl: 'https://m.example/2160-ok' },
    ],
  });
  const q1080 = release({ id: 'q1080', quality: '1080p', mirrors: [{ label: 'M1', shortUrl: 'https://m.example/1080' }] });
  const q720 = release({ id: 'q720', quality: '720p', mirrors: [{ label: 'M1', shortUrl: 'https://m.example/720-manual' }] });
  const pack = release({ id: 'pack', quality: '2160p', isPack: true, container: 'ZIP' });

  const calls = [];
  const fakeResolve = async ({ url }) => {
    calls.push(url);
    if (url.endsWith('/2160-blocked')) {
      return { status: 'blocked', reason: 'captcha', links: [], hops: [] };
    }
    if (url.endsWith('/2160-ok')) {
      return {
        status: 'resolved',
        links: [
          link('https://pixeldrain.com/api/file/2160?download', { server: 'PixelServer' }),
          link('https://pub-1.r2.dev/Movie.2160p.mkv', { server: 'FSL Server' }),
        ],
        hops: [],
      };
    }
    if (url.endsWith('/1080')) {
      return {
        status: 'resolved',
        links: [link('https://pub-1.r2.dev/Movie.1080p.mkv', { server: 'FSL Server' })],
        hops: [],
      };
    }
    if (url.endsWith('/720-manual')) {
      return {
        status: 'partial',
        links: [link('https://hubcloud.one/drive/720', { delivery: 'external', container: 'PAGE' })],
        hops: [],
      };
    }
    return {
      status: 'resolved',
      links: [link('https://pub-1.r2.dev/Movie.480p.mp4', { server: 'Direct MP4', container: 'MP4', playable: true })],
      hops: [],
    };
  };

  const seen = [];
  const outcomes = await ExtStream.resolveAllReleaseStreams([q480, pack, q720, q2160, q1080], {
    label: 'My Movie',
    resolve: fakeResolve,
    onResult: (rel, res) => seen.push([rel.id, res.status]),
  });

  assert.equal(outcomes.size, 4, 'all 4 non-archive qualities resolved (not capped at 3), ZIP pack excluded');
  assert.deepEqual(
    outcomes.get('q2160').links.map((l) => l.server),
    ['FSL Server', 'PixelServer'],
    'blocked mirror skipped, backup mirror resolved with all server links'
  );
  assert.equal(outcomes.get('q1080').status, 'ready');
  assert.deepEqual(outcomes.get('q720'), { status: 'manual', url: 'https://hubcloud.one/drive/720' });
  assert.equal(outcomes.get('q480').links[0].url, 'https://pub-1.r2.dev/Movie.480p.mp4');
  assert.equal(calls.filter((u) => u.endsWith('/2160-blocked')).length, 1, 'blocked mirror hit at most once');

  // Every resolved link builds a pure, side-effect-free <a href> handoff on mobile.
  const handoff = Launch.buildVlcHandoff(outcomes.get('q1080').links[0].url, {
    title: 'My Movie (1080p)',
    env: { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131.0', maxTouchPoints: 5 },
  });
  assert.equal(handoff.plan.mode, 'app');
  assert.ok(handoff.plan.href.startsWith('intent://pub-1.r2.dev/Movie.1080p.mkv#Intent;'));
  assert.ok(handoff.plan.href.includes('package=org.videolan.vlc'));
  assert.deepEqual(handoff.others.map((o) => o.id), ['mx', 'android-chooser']);
});

/* ------------------------------ ordering --------------------------------- */

test('releases sort best quality first, keep page order within a tier, and packs never play', () => {
  const r720 = release({ quality: '720p' });
  const r2160a = release({ quality: '2160p' });
  const r1080 = release({ quality: '1080p' });
  const r2160b = release({ quality: '2160p' });
  const unknown = release({ quality: undefined });
  const pack = release({ quality: '2160p', isPack: true, container: 'ZIP' });
  const zipNoFlag = release({ quality: '1080p', container: 'ZIP' });
  const noMirrors = release({ quality: '2160p', mirrors: [] });

  const sorted = Plan.sortByQuality([r720, r2160a, r1080, unknown, r2160b]);
  assert.deepEqual(sorted.map((r) => r.id), [r2160a.id, r2160b.id, r1080.id, r720.id, unknown.id]);

  const playable = Plan.playableReleases([r720, pack, r2160a, zipNoFlag, noMirrors, r1080]);
  assert.deepEqual(playable.map((r) => r.id), [r2160a.id, r1080.id, r720.id]);

  const downloadable = Plan.downloadableReleases([r720, pack, noMirrors]);
  assert.deepEqual(downloadable.map((r) => r.id), [pack.id, r720.id]);

  assert.deepEqual(Plan.qualityTiers([r720, r2160a, r2160b, unknown]), ['2160p', '720p', 'Other']);
  assert.equal(
    Plan.sizeRangeLabel([{ sizeBytes: 1.19 * 1024 ** 3 }, { sizeBytes: 6.94 * 1024 ** 3 }, { size: '?' }]),
    '1.19 GB – 6.94 GB'
  );
  assert.equal(Plan.sizeRangeLabel([{ size: '700 MB' }]), '700 MB');
});

test('streamCandidates keep direct files + HLS, drop landing pages/archives, dedupe, verified first, PixelDrain last', () => {
  const candidates = Plan.streamCandidates([
    link('https://pixeldrain.com/api/file/AbC?download', { server: 'PixelServer' }),
    link('https://hubcloud.one/drive/page', { server: 'HubCloud Page', delivery: 'external', container: 'PAGE' }),
    link('https://pub-x.r2.dev/Show.S01.zip', { container: 'ZIP' }),
    link('https://fsl.example.net/Show.mkv', { server: 'FSL Server' }),
    link('https://fsl.example.net/Show.mkv', { server: 'FSL Server (dup)' }),
    link('https://cdn.example.com/master.m3u8', { server: 'HLS', playable: true, delivery: 'stream', container: 'HLS', streamType: 'hls' }),
    link('http://plain.example.com/a.mkv'),
  ]);

  assert.deepEqual(
    candidates.map((c) => [c.server, c.kind, c.verified]),
    [
      ['HLS', 'hls', true],
      ['FSL Server', 'file', false],
      ['PixelServer', 'file', false],
    ]
  );
  const pixel = candidates[2];
  assert.equal(pixel.url, 'https://pixeldrain.com/api/file/AbC', 'inline form for the media element');
  assert.equal(pixel.sourceUrl, 'https://pixeldrain.com/api/file/AbC?download', 'original kept for download / copy');
  assert.equal(Plan.inlineStreamUrl('https://cdn.example.com/a.mkv?download'), 'https://cdn.example.com/a.mkv?download');
});

test('classifyMediaError separates file-level (decode) from server-level (network) failures', () => {
  assert.equal(Plan.classifyMediaError(3, false), 'decode');
  assert.equal(Plan.classifyMediaError(4, true), 'decode');
  assert.equal(Plan.classifyMediaError(4, false), 'network');
  assert.equal(Plan.classifyMediaError(2, false), 'network');
  assert.equal(Plan.classifyMediaError(undefined, false), 'network');
  // Real Chromium messages (captured from headless Chrome 153 against generated media):
  assert.equal(
    Plan.classifyMediaError(4, false, 'PipelineStatus::DEMUXER_ERROR_NO_SUPPORTED_STREAMS: FFmpegDemuxer: no supported streams'),
    'decode',
    'HEVC + E-AC-3 MKV: same encode on another server will not decode either'
  );
  assert.equal(Plan.classifyMediaError(4, false, 'MEDIA_ELEMENT_ERROR: Format error'), 'network', '403 / 404 / DNS failure');
  assert.equal(
    Plan.classifyMediaError(4, false, 'PipelineStatus::DEMUXER_ERROR_COULD_NOT_OPEN: FFmpegDemuxer: open context failed'),
    'network',
    'non-media body (e.g. an HTML page) is the server, not the encode'
  );
  assert.equal(Plan.isFileLevelFailure('no-picture'), true);
  assert.equal(Plan.isFileLevelFailure('timeout'), false);
});

/* --------------------------- fallback controller ------------------------- */

function harness({ links, outcomes = {}, blocked = new Set(), refreshLinks = {}, throwOn = new Set() }) {
  const calls = { resolve: [], attempts: [], statuses: [] };
  return {
    calls,
    options: {
      resolve: async (mirror, rel, { refresh }) => {
        calls.resolve.push(`${mirror.shortUrl}${refresh ? ' (refresh)' : ''}`);
        if (throwOn.has(mirror.shortUrl)) throw new Error('network down');
        if (blocked.has(mirror.shortUrl)) return { status: 'blocked', reason: 'captcha', links: [], hops: [] };
        const table = refresh && refreshLinks[mirror.shortUrl] ? refreshLinks : links;
        return resolved((table[mirror.shortUrl] || []).map((u) => link(u)));
      },
      attempt: async (candidate) => {
        calls.attempts.push(candidate.url);
        const outcome = outcomes[candidate.url];
        return outcome ? { ok: false, failure: outcome } : { ok: true };
      },
      onStatus: (s) => calls.statuses.push(s.phase),
    },
  };
}

test('Try Play starts at the highest quality and falls back when a file cannot be decoded', async () => {
  const uhd = release({ id: 'uhd', quality: '2160p' });
  const fhd = release({ id: 'fhd', quality: '1080p' });
  const hd = release({ id: 'hd', quality: '720p' });
  const { calls, options } = harness({
    links: {
      [uhd.mirrors[0].shortUrl]: ['https://fsl.example/uhd.mkv', 'https://pixeldrain.com/api/file/UHD?download'],
      [uhd.mirrors[1].shortUrl]: ['https://other.example/uhd.mkv'],
      [fhd.mirrors[0].shortUrl]: ['https://fsl.example/fhd.mkv'],
      [hd.mirrors[0].shortUrl]: ['https://fsl.example/hd.mkv'],
    },
    outcomes: { 'https://fsl.example/uhd.mkv': 'no-picture' },
  });

  const session = new Plan.PlaybackSession();
  const result = await Plan.runPlaybackFallback(session, Plan.playableReleases([hd, uhd, fhd]), options);

  assert.equal(result.status, 'playing');
  assert.equal(result.release.id, 'fhd');
  assert.equal(result.releaseIndex, 1);
  // A file-level failure skips the other servers AND the other mirror of the same encode.
  assert.deepEqual(calls.attempts, ['https://fsl.example/uhd.mkv', 'https://fsl.example/fhd.mkv']);
  assert.deepEqual(calls.resolve, [uhd.mirrors[0].shortUrl, fhd.mirrors[0].shortUrl]);
  assert.equal(calls.statuses.at(-1), 'playing');
  assert.equal(session.reResolveUsed, false);
});

test('server-level failures try the next server, then the next mirror, with only ONE re-resolve per session', async () => {
  const uhd = release({ id: 'u2', quality: '2160p' });
  const fhd = release({ id: 'f2', quality: '1080p' });
  const [m1, m2] = uhd.mirrors;
  const { calls, options } = harness({
    links: {
      [m1.shortUrl]: ['https://a.example/u.mkv', 'https://b.example/u.mkv'],
      [m2.shortUrl]: ['https://c.example/u.mkv'],
      [fhd.mirrors[0].shortUrl]: ['https://d.example/f.mkv'],
      [fhd.mirrors[1].shortUrl]: ['https://e.example/f.mkv'],
    },
    refreshLinks: { [m1.shortUrl]: ['https://a.example/u.mkv', 'https://a2.example/u-fresh.mkv'] },
    outcomes: {
      'https://a.example/u.mkv': 'network',
      'https://b.example/u.mkv': 'timeout',
      'https://a2.example/u-fresh.mkv': 'network',
      'https://c.example/u.mkv': 'network',
      'https://d.example/f.mkv': 'network',
    },
  });

  const session = new Plan.PlaybackSession();
  const result = await Plan.runPlaybackFallback(session, [uhd, fhd], options);

  assert.equal(result.status, 'playing');
  assert.equal(result.candidate.url, 'https://e.example/f.mkv');
  assert.deepEqual(calls.attempts, [
    'https://a.example/u.mkv',
    'https://b.example/u.mkv',
    'https://a2.example/u-fresh.mkv', // the single refresh, already-tried URL skipped
    'https://c.example/u.mkv',
    'https://d.example/f.mkv',
    'https://e.example/f.mkv',
  ]);
  assert.equal(calls.resolve.filter((r) => r.endsWith('(refresh)')).length, 1, 'max one re-resolve');
  assert.equal(session.reResolveUsed, true);
});

test('CAPTCHA / access-controlled mirrors are skipped — never re-resolved or retried', async () => {
  const fhd = release({ id: 'f3', quality: '1080p' });
  const [gated, open] = fhd.mirrors;
  const { calls, options } = harness({
    blocked: new Set([gated.shortUrl]),
    links: { [open.shortUrl]: ['https://ok.example/f.mkv'] },
  });

  const session = new Plan.PlaybackSession();
  const result = await Plan.runPlaybackFallback(session, [fhd], options);
  assert.equal(result.status, 'playing');
  assert.deepEqual(calls.resolve, [gated.shortUrl, open.shortUrl]);
  assert.ok(session.blockedMirrors.has(gated.shortUrl));
  assert.equal(session.reResolveUsed, false);

  // Later runs in the same session don't touch the blocked mirror at all.
  calls.resolve.length = 0;
  await Plan.runPlaybackFallback(session, [fhd], options);
  assert.ok(!calls.resolve.includes(gated.shortUrl));
});

test('a link that dies mid-playback is refreshed once and resumed in the same session', async () => {
  const fhd = release({ id: 'f4', quality: '1080p', mirrors: [{ id: 'x', label: 'HubCloud', shortUrl: 'https://greenmotors.club/?id=f4', host: 'greenmotors.club' }] });
  const { calls, options } = harness({
    links: { 'https://greenmotors.club/?id=f4': ['https://cdn.example/f4.mkv?token=old'] },
    refreshLinks: { 'https://greenmotors.club/?id=f4': ['https://cdn.example/f4.mkv?token=new'] },
  });

  const session = new Plan.PlaybackSession();
  const first = await Plan.runPlaybackFallback(session, [fhd], options);
  assert.equal(first.candidate.url, 'https://cdn.example/f4.mkv?token=old');

  // The token expires: recovery re-runs the same session from the same release.
  const recovery = await Plan.runPlaybackFallback(session, [fhd], { ...options, startIndex: 0 });
  assert.equal(recovery.status, 'playing');
  assert.equal(recovery.candidate.url, 'https://cdn.example/f4.mkv?token=new');
  assert.deepEqual(calls.resolve, [
    'https://greenmotors.club/?id=f4',
    'https://greenmotors.club/?id=f4',
    'https://greenmotors.club/?id=f4 (refresh)',
  ]);

  // A second expiry in the same session does NOT trigger another re-resolve.
  const again = await Plan.runPlaybackFallback(session, [fhd], options);
  assert.equal(again.status, 'failed');
  assert.equal(calls.resolve.filter((r) => r.endsWith('(refresh)')).length, 1);
});

test('fallback stops on abort, on the attempt cap, and reports when nothing was playable', async () => {
  const releases = ['2160p', '1080p', '720p', '480p'].map((quality, i) =>
    release({ id: `cap${i}`, quality, mirrors: [{ id: `m${i}`, label: 'M', shortUrl: `https://greenmotors.club/?id=cap${i}`, host: 'greenmotors.club' }] })
  );
  const links = Object.fromEntries(releases.map((r, i) => [r.mirrors[0].shortUrl, [`https://a.example/${i}.mkv`, `https://b.example/${i}.mkv`]]));
  const outcomes = Object.fromEntries(Object.values(links).flat().map((u) => [u, 'network']));

  // Attempt cap
  const capped = harness({ links, outcomes });
  const capSession = new Plan.PlaybackSession(Date.now(), 3);
  const capResult = await Plan.runPlaybackFallback(capSession, releases, capped.options);
  assert.deepEqual(capResult, { status: 'failed', reason: 'limit' });
  assert.equal(capped.calls.attempts.length, 3);

  // Abort during the first attempt
  const controller = new AbortController();
  const aborting = harness({ links, outcomes });
  const abortResult = await Plan.runPlaybackFallback(new Plan.PlaybackSession(), releases, {
    ...aborting.options,
    signal: controller.signal,
    attempt: async () => {
      controller.abort();
      return { ok: false, failure: 'aborted' };
    },
  });
  assert.deepEqual(abortResult, { status: 'aborted' });

  // Wall-clock budget
  let clock = 0;
  const slow = harness({ links, outcomes });
  const budgetSession = new Plan.PlaybackSession(0, 50, 1000);
  const budgetResult = await Plan.runPlaybackFallback(budgetSession, releases, {
    ...slow.options,
    now: () => clock,
    attempt: async () => {
      clock += 600;
      return { ok: false, failure: 'network' };
    },
  });
  assert.equal(budgetResult.status, 'failed');
  assert.equal(budgetResult.reason, 'limit');

  // Nothing resolvable at all (and resolver throwing) → no-sources, never an exception
  const empty = harness({ links: {}, throwOn: new Set([releases[0].mirrors[0].shortUrl]) });
  const none = await Plan.runPlaybackFallback(new Plan.PlaybackSession(), releases, empty.options);
  assert.deepEqual(none, { status: 'failed', reason: 'no-sources' });

  // startIndex: "try the next quality" starts lower
  const fromIndex = harness({ links });
  const lower = await Plan.runPlaybackFallback(new Plan.PlaybackSession(), releases, { ...fromIndex.options, startIndex: 2 });
  assert.equal(lower.release.quality, '720p');
});

/* ------------------------------ season tabs ------------------------------ */

test('buildSeasonTabs keeps each season’s downloads inside its own tab', () => {
  const s1Pack1080 = release({ id: 'p1', quality: '1080p', isPack: true, container: 'ZIP', seasonNumber: 1 });
  const s1Pack2160 = release({ id: 'p2', quality: '2160p', isPack: true, container: 'ZIP', seasonNumber: 1 });
  const s3Pack = release({ id: 'p3', quality: '720p', isPack: true, container: 'ZIP', seasonNumber: 3 });
  const loose = release({ id: 'p4', quality: '1080p', container: 'MKV' });
  const seasons = [
    { id: 's2', seasonNumber: 2, name: 'Season 2', episodes: [{ id: 'e1', seasonNumber: 2, episodeNumber: 1, title: 'Episode 1' }] },
    { id: 's1', seasonNumber: 1, name: 'Season 1', episodes: [] },
  ];

  const tabs = Tabs.buildSeasonTabs(seasons, [s1Pack1080, loose, s3Pack, s1Pack2160]);
  assert.deepEqual(tabs.map((t) => [t.key, t.label]), [
    ['s1', 'Season 1'],
    ['s2', 'Season 2'],
    ['s3', 'Season 3'],
    ['other', 'More downloads'],
  ]);
  assert.deepEqual(tabs[0].packs.map((p) => p.id), ['p2', 'p1'], 'best quality first');
  assert.equal(tabs[1].packs.length, 0);
  assert.equal(tabs[1].season.episodes.length, 1);
  assert.equal(tabs[2].season, null, 'pack-only season still gets a tab');
  assert.deepEqual(tabs[3].packs.map((p) => p.id), ['p4']);

  assert.equal(Tabs.buildSeasonTabs([], []).length, 0);
  assert.equal(Tabs.seasonLabel(0), 'Specials');
  assert.equal(Tabs.episodeCode(2, 5), 'S02E05');
});

/* --------------------------- resolver refresh ---------------------------- */

test('resolve refresh skips a cached result only once it is old enough (no upstream tight loops)', async () => {
  Resolver.clearMirrorResolveCache();
  const PUBLIC_DNS = async () => [{ address: '104.21.58.178', family: 4 }];
  let fetches = 0;
  let generation = 0;
  const fetchImpl = async (url) => {
    fetches += 1;
    if (url.startsWith('https://hubcloud.one/drive/')) {
      generation += 1;
      return new Response(`<a href="https://fsl.example.net/file-${generation}.mkv">Download [FSL Server]</a>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    return new Response('nope', { status: 404 });
  };
  let clock = 1_000_000;
  const deps = { fetchImpl, dnsLookup: PUBLIC_DNS, now: () => clock };
  const input = { shortUrl: 'https://hubcloud.one/drive/abc', fileName: 'Show.S01E01.1080p.mkv' };

  const first = await Resolver.resolveHubMirror(input, deps);
  assert.equal(first.links[0].url, 'https://fsl.example.net/file-1.mkv');
  assert.equal(first.links[0].playable, false, 'MKV is still never claimed verified-playable');
  assert.equal(fetches, 1);

  await Resolver.resolveHubMirror(input, deps);
  assert.equal(fetches, 1, 'plain repeat is served from cache');

  clock += 5_000;
  const tooSoon = await Resolver.resolveHubMirror(input, { ...deps, refresh: true });
  assert.equal(fetches, 1, `refresh within ${Resolver.MIN_REFRESH_AGE_MS}ms returns the cached result`);
  assert.equal(tooSoon.links[0].url, 'https://fsl.example.net/file-1.mkv');

  clock += Resolver.MIN_REFRESH_AGE_MS;
  const fresh = await Resolver.resolveHubMirror(input, { ...deps, refresh: true });
  assert.equal(fetches, 2);
  assert.equal(fresh.links[0].url, 'https://fsl.example.net/file-2.mkv');

  const cachedAgain = await Resolver.resolveHubMirror(input, deps);
  assert.equal(cachedAgain.links[0].url, 'https://fsl.example.net/file-2.mkv', 'fresh result replaced the cache');
  assert.equal(fetches, 2);
  Resolver.clearMirrorResolveCache();
});

test('user-facing failure copy is a single plain sentence', () => {
  assert.equal(UserError.SOMETHING_WENT_WRONG, 'Something went wrong');
});

/* ------------------------- sound: runtime + order ------------------------- */

test('live decoder counters are trusted only in Chromium (userAgentData + numeric counters)', () => {
  const counters = { webkitAudioDecodedByteCount: 0, webkitVideoDecodedByteCount: 0 };
  assert.equal(Caps.hasLiveDecoderCounters(counters, { userAgentData: {} }), true);
  assert.equal(Caps.hasLiveDecoderCounters(counters, { userAgent: 'Safari' }), false, 'WebKit has the props, but AVFoundation leaves them at 0');
  assert.equal(Caps.hasLiveDecoderCounters({}, { userAgentData: {} }), false, 'Firefox: no counters');
  assert.equal(Caps.hasLiveDecoderCounters(null, { userAgentData: {} }), false);
});

test('predictSilentAudio: only when EVERY audio codec named is one the browser reports it cannot decode', () => {
  const chrome = { h264: true, hevc: false, av1: true, vp9: true, aac: true, ac3: false, eac3: false, opus: true, mkv: null };
  const edge = { ...chrome, ac3: true, eac3: true };
  const ddOnly = Hints.parseReleaseHints('Movie.2026.1080p.WEB-DL.[Hindi DD 5.1 + English DDP 5.1].x264.mkv');
  assert.equal(Hints.predictSilentAudio(ddOnly, chrome), true);
  assert.equal(Hints.predictSilentAudio(ddOnly, edge), false, 'Edge reports AC-3 / E-AC-3 support');
  assert.equal(Hints.predictSilentAudio(Hints.parseReleaseHints('Movie.720p.[Hindi AAC 2.0 + English DDP 5.1].mkv'), chrome), false);
  assert.equal(Hints.predictSilentAudio(Hints.parseReleaseHints('Movie.2160p.REMUX.TrueHD.7.1.Atmos.mkv'), edge), true, 'no browser decodes TrueHD');
  assert.equal(Hints.predictSilentAudio(Hints.parseReleaseHints('Movie.1080p.WEB-DL.x264.mkv'), chrome), false, 'no audio named → no guess');
  assert.equal(Hints.predictSilentAudio(ddOnly, null), false);
});

test('audioVerdict: decoding bytes = sound; video decoding with zero audio for 2 s = silent; dead counters = unknown', () => {
  assert.equal(Plan.audioVerdict({ progress: 0.3, audioBytes: 11178, videoBytes: 165585 }), 'audio');
  assert.equal(Plan.audioVerdict({ progress: 0.5, audioBytes: 0, videoBytes: 200159 }), 'pending');
  assert.equal(Plan.audioVerdict({ progress: 2.1, audioBytes: 0, videoBytes: 861599 }), 'silent');
  assert.equal(Plan.audioVerdict({ progress: 0.4, audioBytes: 0, videoBytes: 500000, frames: 61 }), 'silent', 'frame count keeps working through stalls');
  assert.equal(Plan.audioVerdict({ progress: 3, audioBytes: 0, videoBytes: 0 }), 'unknown', 'counters not live → cannot judge');
  assert.equal(Plan.audioVerdict({ progress: 3, audioBytes: undefined, videoBytes: undefined }), 'unknown');
  assert.equal(Plan.isFileLevelFailure('no-audio'), true, 'the same encode has the same audio on every server');
});

test('a file with picture but no sound is skipped like a decode failure; the next quality plays', async () => {
  const fhd = release({ id: 'dd', quality: '1080p' });
  const hd = release({ id: 'aac', quality: '720p' });
  const { calls, options } = harness({
    links: {
      [fhd.mirrors[0].shortUrl]: ['https://fsl.example/dd.mkv', 'https://pixeldrain.com/api/file/DD?download'],
      [fhd.mirrors[1].shortUrl]: ['https://other.example/dd.mkv'],
      [hd.mirrors[0].shortUrl]: ['https://fsl.example/aac.mkv'],
    },
    outcomes: { 'https://fsl.example/dd.mkv': 'no-audio' },
  });
  const result = await Plan.runPlaybackFallback(new Plan.PlaybackSession(), [fhd, hd], options);
  assert.equal(result.status, 'playing');
  assert.equal(result.release.id, 'aac');
  assert.deepEqual(calls.attempts, ['https://fsl.example/dd.mkv', 'https://fsl.example/aac.mkv'], 'no other server / mirror of the silent encode');
});

test('when nothing plays with sound, the best silent link is reported for "Play without sound"', async () => {
  const uhd = release({ id: 'u', quality: '2160p' });
  const fhd = release({ id: 'f', quality: '1080p' });
  const hd = release({ id: 'h', quality: '720p' });
  const { options } = harness({
    links: {
      [uhd.mirrors[0].shortUrl]: ['https://fsl.example/u.mkv'],
      [fhd.mirrors[0].shortUrl]: ['https://fsl.example/f.mkv'],
      [hd.mirrors[0].shortUrl]: ['https://fsl.example/h.mkv'],
    },
    outcomes: { 'https://fsl.example/u.mkv': 'decode', 'https://fsl.example/f.mkv': 'no-audio', 'https://fsl.example/h.mkv': 'no-audio' },
  });
  const result = await Plan.runPlaybackFallback(new Plan.PlaybackSession(), [uhd, fhd, hd], options);
  assert.equal(result.status, 'failed');
  assert.equal(result.reason, 'exhausted');
  assert.equal(result.silent.releaseIndex, 1, 'highest quality that showed a picture');
  assert.equal(result.silent.candidate.url, 'https://fsl.example/f.mkv');

  const { options: noVideo } = harness({
    links: { [uhd.mirrors[0].shortUrl]: ['https://fsl.example/u.mkv'] },
    outcomes: { 'https://fsl.example/u.mkv': 'decode' },
  });
  const nothing = await Plan.runPlaybackFallback(new Plan.PlaybackSession(), [uhd], noVideo);
  assert.deepEqual(nothing, { status: 'failed', reason: 'exhausted' }, 'no silent candidate when no picture ever showed');

  // Deferred order tries 720p first, but "Play without sound" still offers the better 1080p.
  const { options: deferredOpts } = harness({
    links: { [fhd.mirrors[0].shortUrl]: ['https://fsl.example/f.mkv'], [hd.mirrors[0].shortUrl]: ['https://fsl.example/h.mkv'] },
    outcomes: { 'https://fsl.example/f.mkv': 'no-audio', 'https://fsl.example/h.mkv': 'no-audio' },
  });
  const both = await Plan.runPlaybackFallback(new Plan.PlaybackSession(), [fhd, hd], { ...deferredOpts, isDeferred: (r) => r.id === 'f' });
  assert.equal(both.silent.release.id, 'f');
});

test('attemptOrder tries releases with browser-friendly sound first (order only), a picked quality stays first', () => {
  const rels = ['2160p', '1080p', '720p', '480p'].map((quality) => release({ quality }));
  const dolby = new Set([rels[0].id, rels[1].id]);
  const isDeferred = (r) => dolby.has(r.id);
  assert.deepEqual(Plan.attemptOrder(rels), [0, 1, 2, 3]);
  assert.deepEqual(Plan.attemptOrder(rels, { isDeferred }), [2, 3, 0, 1], 'nothing is dropped');
  assert.deepEqual(Plan.attemptOrder(rels, { isDeferred, startIndex: 1, pinStart: true }), [1, 2, 3], 'user picked 1080p');
  assert.deepEqual(Plan.attemptOrder(rels, { isDeferred, startIndex: 1 }), [2, 3, 1]);
});

test('deferred releases are tried after the others in the real fallback loop', async () => {
  const fhd = release({ id: 'dolby', quality: '1080p' });
  const hd = release({ id: 'aac2', quality: '720p' });
  const { calls, options } = harness({
    links: { [fhd.mirrors[0].shortUrl]: ['https://fsl.example/dolby.mkv'], [hd.mirrors[0].shortUrl]: ['https://fsl.example/aac2.mkv'] },
  });
  const result = await Plan.runPlaybackFallback(new Plan.PlaybackSession(), [fhd, hd], { ...options, isDeferred: (r) => r.id === 'dolby' });
  assert.equal(result.release.id, 'aac2');
  assert.equal(result.releaseIndex, 1, 'indices still point into the quality-sorted list');
  assert.deepEqual(calls.attempts, ['https://fsl.example/aac2.mkv']);
});

/* ------------------------- continue where you stopped ------------------------- */

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), data };
}

test('resume points: saved per item, resumed from 10 s on, cleared near the end, never stale', () => {
  const store = memoryStorage();
  const now = 1_800_000_000_000;
  Resume.saveResumePoint('movie-x', 1390.4, 7200, store, now);
  const point = Resume.loadResumePoint('movie-x', store);
  assert.deepEqual(point, { t: 1390.4, d: 7200, at: now });
  assert.equal(Resume.resumePosition(point, now + 1000), 1390.4);
  assert.equal(Resume.loadResumePoint('movie-y', store), null, 'per item');

  Resume.saveResumePoint('movie-x', 7100, 7200, store, now);
  assert.equal(Resume.loadResumePoint('movie-x', store), null, 'within the last 3% (credits) = finished → start over next time');

  Resume.saveResumePoint('ep-1', 6, 2400, store, now);
  assert.equal(Resume.loadResumePoint('ep-1', store), null, 'under 10 s is not worth resuming');

  Resume.saveResumePoint('ep-2', 600, undefined, store, now);
  assert.equal(Resume.resumePosition(Resume.loadResumePoint('ep-2', store), now), 600, 'unknown duration still resumes');
  assert.equal(Resume.resumePosition(Resume.loadResumePoint('ep-2', store), now + 121 * 86_400_000), null, 'stale after 120 days');

  Resume.clearResumePoint('ep-2', store, now);
  assert.equal(Resume.loadResumePoint('ep-2', store), null);

  const raw = JSON.parse(store.data.get(Resume.RESUME_STORAGE_KEY));
  assert.ok(Object.values(raw).every((p) => Object.keys(p).every((k) => ['t', 'd', 'at'].includes(k))), 'only numbers — no URLs or tokens');
});

test('resume store tolerates junk, caps its size and formats times', () => {
  const store = memoryStorage();
  store.setItem(Resume.RESUME_STORAGE_KEY, '{not json');
  assert.equal(Resume.loadResumePoint('a', store), null);
  store.setItem(Resume.RESUME_STORAGE_KEY, JSON.stringify({ a: { t: 'x' }, b: { t: 50, at: 1 } }));
  assert.equal(Resume.loadResumePoint('a', store), null);
  assert.equal(Resume.loadResumePoint('b', store).t, 50);

  const big = memoryStorage();
  for (let i = 0; i < 230; i++) Resume.saveResumePoint(`k${i}`, 100 + i, 3600, big, 1_000_000 + i);
  const kept = Object.keys(JSON.parse(big.data.get(Resume.RESUME_STORAGE_KEY)));
  assert.equal(kept.length, 200);
  assert.ok(kept.includes('k229') && !kept.includes('k0'), 'newest kept');

  assert.equal(Resume.formatPlaybackTime(1390.4), '23:10');
  assert.equal(Resume.formatPlaybackTime(3723), '1:02:03');
  assert.equal(Resume.formatPlaybackTime(9), '0:09');
  assert.equal(Resume.isNearEnd(50, 60), true);
  assert.equal(Resume.isNearEnd(50, undefined), false);
});
