const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const filename = path.resolve(__dirname, '../src/lib/engineMode.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { decideEngineAction, needsPlainElement, decideHiddenPauseRecovery } = compiled.exports;

const video = {
  playing: true, loading: false, engine: 'native', videoMode: true,
  playerOpen: true, appVisible: true, hasVideo: true, iframePaused: false, videoBlocked: false,
};

for (const [name, override] of [
  ['paused', { playing: false }], ['loading', { loading: true }], ['no engine', { engine: null }],
]) {
  test(`${name}: never switch or resume either engine`, () => {
    for (const engine of ['native', 'iframe']) {
      assert.equal(decideEngineAction({ ...video, engine, iframePaused: true, ...override }), 'none');
      assert.equal(decideEngineAction({ ...video, engine, playerOpen: false, ...override }), 'none');
    }
  });
}

test('visible open video preference switches native to video', () => {
  assert.equal(decideEngineAction(video), 'play-video');
});
test('wanted iframe stays playing or resumes when paused', () => {
  assert.equal(decideEngineAction({ ...video, engine: 'iframe' }), 'none');
  assert.equal(decideEngineAction({ ...video, engine: 'iframe', iframePaused: true }), 'resume-video');
});

for (const [name, override] of [
  ['audio preference', { videoMode: false }],
  ['Back closes full player', { playerOpen: false }],
  ['screen off / hidden app', { appVisible: false }],
  ['no video', { hasVideo: false }],
  ['embed failure cooldown', { videoBlocked: true }],
]) {
  test(`${name}: iframe hands off to native, native stays put`, () => {
    assert.equal(decideEngineAction({ ...video, ...override }), 'none');
    for (const iframePaused of [false, true]) {
      assert.equal(decideEngineAction({ ...video, engine: 'iframe', iframePaused, ...override }), 'play-native');
    }
  });
}

test('plain element for hidden native audio: always on mobile, only when the graph stalls on desktop', () => {
  for (const hidden of [false, true]) {
    for (const playing of [false, true]) {
      for (const engine of [null, 'iframe', 'native']) {
        for (const ctxRunning of [false, true]) {
          for (const mobile of [false, true]) {
            const state = { hidden, playing, engine, ctxRunning, mobile };
            const wanted = hidden && playing && engine === 'native' && (mobile || !ctxRunning);
            assert.equal(needsPlainElement(state), wanted, JSON.stringify(state));
          }
        }
      }
    }
  }
});

test('hidden-pause recovery: only off-screen playback intent is rescued, twice per hidden window', () => {
  const base = { hidden: true, wantedPlaying: true, engine: 'native', plainActive: false, plainPaused: false, attempts: 0 };
  assert.equal(decideHiddenPauseRecovery(base), 'plain-handoff');
  assert.equal(decideHiddenPauseRecovery({ ...base, plainActive: true, plainPaused: true }), 'plain-resume');
  assert.equal(decideHiddenPauseRecovery({ ...base, plainActive: true, plainPaused: false }), 'none');
  assert.equal(decideHiddenPauseRecovery({ ...base, engine: 'iframe' }), 'iframe-resume');
  assert.equal(decideHiddenPauseRecovery({ ...base, attempts: 2 }), 'none');
  assert.equal(decideHiddenPauseRecovery({ ...base, attempts: 1, maxAttempts: 1 }), 'none');
});

test('hidden-pause recovery never fights the user or the foreground', () => {
  const base = { hidden: true, wantedPlaying: true, engine: 'native', plainActive: false, plainPaused: false, attempts: 0 };
  assert.equal(decideHiddenPauseRecovery({ ...base, hidden: false }), 'none');
  assert.equal(decideHiddenPauseRecovery({ ...base, wantedPlaying: false }), 'none');
  assert.equal(decideHiddenPauseRecovery({ ...base, engine: null }), 'plain-handoff');
});
