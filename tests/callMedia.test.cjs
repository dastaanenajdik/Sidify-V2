const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const filename = path.resolve(__dirname, '../src/lib/rooms/media.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const M = compiled.exports;

const SDP = [
  'v=0',
  'o=- 123 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=group:BUNDLE 0 1',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:111 opus/48000/2',
  'a=fmtp:111 minptime=20;useinbandfec=1;maxaveragebitrate=64000',
  'a=sendrecv',
  'm=video 9 UDP/TLS/RTP/SAVPF 98',
  'c=IN IP4 0.0.0.0',
  'a=rtpmap:98 VP9/90000',
  'a=sendrecv',
  '',
].join('\r\n');

test('4K camera ladder targets 3840x2160/60 first and degrades gracefully', () => {
  assert.equal(M.VIDEO_WIDTH, 3840);
  assert.equal(M.VIDEO_HEIGHT, 2160);
  assert.equal(M.VIDEO_FPS, 60);
  const first = M.VIDEO_CONSTRAINTS[0];
  assert.equal(first.width.ideal, 3840);
  assert.equal(first.height.ideal, 2160);
  assert.equal(first.frameRate.ideal, 60);
  // Every rung uses `ideal`, never `exact`/`min`, so a 1080p webcam still connects.
  for (const c of M.VIDEO_CONSTRAINTS) {
    for (const key of ['width', 'height', 'frameRate']) {
      if (!c[key]) continue;
      assert.equal(c[key].exact, undefined);
      assert.equal(c[key].min, undefined);
    }
  }
  assert.ok(M.VIDEO_MAX_BITRATE >= 20_000_000, '4K needs a real bitrate ceiling');
  assert.equal(M.VIDEO_BANDWIDTH_KBPS, Math.floor(M.VIDEO_MAX_BITRATE / 1000));
});

test('codec preference puts 4K-capable VP9/H.264 first and keeps every codec', () => {
  const codecs = [
    { mimeType: 'video/VP8' },
    { mimeType: 'video/AV1' },
    { mimeType: 'video/H264' },
    { mimeType: 'video/VP9' },
  ];
  const ordered = M.orderVideoCodecs(codecs).map((c) => c.mimeType.toLowerCase());
  assert.equal(ordered.length, 4);
  assert.equal(ordered[0], 'video/vp9');
  assert.equal(ordered[1], 'video/h264');
  assert.ok(ordered.indexOf('video/av1') < ordered.indexOf('video/vp8'));
  assert.deepEqual(codecs.map((c) => c.mimeType), ['video/VP8', 'video/AV1', 'video/H264', 'video/VP9'], 'input is not mutated');
});

test('SDP tuning gives audio 10ms Opus frames with FEC off', () => {
  const out = M.tuneSdp(SDP, 'video');
  assert.ok(out.startsWith('v=0\r\n'), 'session-level preamble is preserved');
  assert.ok(out.endsWith('\r\n'));
  assert.equal((out.match(/a=ptime:/g) || []).length, 1);
  assert.ok(out.includes('a=ptime:10'));
  assert.ok(out.includes('a=fmtp:111 maxaveragebitrate=64000;minptime=10;useinbandfec=0;stereo=0;cbr=0'));
  assert.ok(!out.includes('minptime=20'), 'the old 20ms frame is replaced');
  assert.ok(!out.includes('useinbandfec=1'), 'FEC is disabled to shave a frame of delay');
  assert.ok(out.includes('a=rtpmap:98 VP9/90000'), 'video codecs survive the rewrite');
});

test('SDP tuning advertises a 4K bandwidth ceiling only for video calls', () => {
  const video = M.tuneSdp(SDP, 'video');
  assert.ok(video.includes(`b=AS:${M.VIDEO_BANDWIDTH_KBPS}`));
  assert.ok(video.includes(`b=TIAS:${M.VIDEO_MAX_BITRATE}`));
  assert.equal((video.match(/b=AS:/g) || []).length, 1, 'no duplicate bandwidth lines');
  const videoSection = video.slice(video.indexOf('m=video '));
  assert.ok(videoSection.indexOf('c=IN IP4') < videoSection.indexOf('b=AS:'), 'b= follows c= per RFC 4566');
  assert.ok(videoSection.indexOf('b=AS:') < videoSection.indexOf('a=rtpmap:98'), 'bandwidth precedes attributes');
  assert.ok(video.indexOf('m=audio ') < video.indexOf('a=ptime:10'), 'ptime sits in the audio attribute block');

  const voice = M.tuneSdp(SDP, 'voice');
  assert.ok(!voice.includes('b=AS:'), 'an audio-only call is not given a video bitrate');
  assert.ok(voice.includes('a=ptime:10'), 'low-latency audio applies to voice calls too');
});

test('SDP tuning replaces an existing low ceiling and is idempotent', () => {
  const withOld = SDP.replace(
    'm=video 9 UDP/TLS/RTP/SAVPF 98\r\n',
    'm=video 9 UDP/TLS/RTP/SAVPF 98\r\nb=AS:1000\r\n'
  );
  const once = M.tuneSdp(withOld, 'video');
  assert.equal((once.match(/b=AS:/g) || []).length, 1);
  assert.ok(once.includes(`b=AS:${M.VIDEO_BANDWIDTH_KBPS}`));
  assert.ok(!once.includes('b=AS:1000'));
  assert.equal(M.tuneSdp(once, 'video'), once, 're-tuning a description changes nothing');
  assert.equal(M.tuneSdp('', 'video'), '');
});

test('adaptive bitrate aims for 4K, backs off on congestion and avoids thrash', () => {
  const max = M.VIDEO_MAX_BITRATE;
  assert.equal(M.targetBitrate(0, max), max, 'no estimate yet → aim for 4K');
  assert.equal(M.targetBitrate(2_000_000, max), M.VIDEO_MIN_BITRATE, 'congested link → floor');
  assert.equal(M.targetBitrate(200_000_000, M.VIDEO_MIN_BITRATE), max, 'fast link → full 4K');
  // An estimate that only moves the target by ~5% must not call setParameters.
  assert.equal(M.targetBitrate((max * 0.95) / 0.85, max), max);
  assert.ok(M.targetBitrate(100_000_000, max) <= max, 'never exceed the ceiling');
});

test('quality labels report the resolution actually arriving', () => {
  assert.equal(M.qualityLabel(3840, 2160), '4K UHD');
  assert.equal(M.qualityLabel(2560, 1440), 'QHD');
  assert.equal(M.qualityLabel(1920, 1080), '1080p');
  assert.equal(M.qualityLabel(1280, 720), '720p');
  assert.equal(M.qualityLabel(640, 480), 'SD');
  assert.equal(M.qualityLabel(0, 0), 'Connecting');
});
