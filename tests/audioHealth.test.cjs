const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const moduleCache = new Map();
function loadTs(targetPath) {
  const filename = path.resolve(__dirname, targetPath);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  moduleCache.set(filename, compiled);
  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request.startsWith('.') && parent && parent.filename) {
      const candidate = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidate)) return loadTs(path.relative(__dirname, candidate));
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    compiled._compile(out, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const audio = loadTs('../src/lib/media/audioHealth.ts');

test('decoded audio bytes mean the stream has sound', () => {
  assert.equal(audio.audioHealthVerdict({ progress: 3, audioBytes: 8192, frames: 72 }), 'ok');
  assert.equal(audio.audioHealthVerdict({ progress: 0.2, audioBytes: 512 }), 'ok', 'sound is sound, even early');
});

test('a stream is only called silent after video has moved without audio', () => {
  assert.equal(
    audio.audioHealthVerdict({ progress: 0.4, audioBytes: 0, frames: 10 }),
    'pending',
    'too early to judge'
  );
  assert.equal(
    audio.audioHealthVerdict({ progress: 3, audioBytes: 0, frames: 90 }),
    'silent',
    'video frames advanced while audio decoded nothing'
  );
  assert.equal(
    audio.audioHealthVerdict({ progress: 3, audioBytes: 0, videoBytes: 0, frames: 0 }),
    'pending',
    'a stalled picture is buffering, not a silent stream'
  );
});

test('without decoder counters the verdict is unknown, never a guess', () => {
  assert.equal(audio.audioHealthVerdict({ progress: 10 }), 'unknown');
  assert.equal(audio.audioHealthVerdict({ progress: 10, audioBytes: null, frames: 300 }), 'unknown');
});

test('recovery escalates: another track, then a reload, then stop', () => {
  assert.equal(audio.nextAudioRecovery(0), 'switch-track');
  assert.equal(audio.nextAudioRecovery(1), 'reload');
  assert.equal(audio.nextAudioRecovery(2), 'give-up');
  assert.equal(audio.nextAudioRecovery(9), 'give-up');
});

test('track labels read like a human wrote them', () => {
  assert.equal(audio.describeAudioTrack({ label: 'Hindi', channelsCount: 2, codec: 'mp4a.40.2' }), 'Hindi · Stereo · MP4A.40.2');
  assert.equal(audio.describeAudioTrack({ language: 'hi', channelsCount: 6 }), 'HI · 5.1');
  assert.equal(audio.describeAudioTrack({ language: 'und' }), 'Default audio');
});

test('the diagnosis explains the usual cause and the one-tap fix', () => {
  assert.equal(audio.audioDiagnosis('ok', 2), null);
  const multi = audio.audioDiagnosis('silent', 2);
  assert.match(multi, /another audio track/i);
  const single = audio.audioDiagnosis('silent', 1);
  assert.match(single, /Download|external player/i);
});

test('the player wires the watchdog to the engine and to the UI', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/components/exclusive/ExclusivePlayerSheet.tsx'),
    'utf8'
  );
  assert.match(source, /audioHealthVerdict/);
  assert.match(source, /nextAudioRecovery/);
  assert.match(source, /selectAudioTrack/);
  assert.match(source, /attachShakaPlayback/);
  assert.match(source, /getVideoQualities|selectVideoQuality/);
  assert.match(source, /webkitAudioDecodedByteCount/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /audio-diagnosis|audioDiagnosis/);
});
