const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const filename = path.resolve(__dirname, '../src/lib/backGuard.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const {
  SIDIFY_GUARD_KEY,
  SIDIFY_PLAYER_KEY,
  BACK_EXIT_WINDOW_MS,
  isPlaybackGuardActive,
  decideBackAction,
  shouldParkSentinel,
  shouldConsumeSentinel,
} = compiled.exports;

// --- constants ---

test('exit window is 2.5s and history flags are stable strings', () => {
  assert.equal(BACK_EXIT_WINDOW_MS, 2500);
  assert.equal(SIDIFY_GUARD_KEY, 'sidifyGuard');
  assert.equal(SIDIFY_PLAYER_KEY, 'sidifyPlayer');
});

// --- isPlaybackGuardActive: sirf loaded + playing/buffering pe guard ---

test('guard active while a loaded song is playing', () => {
  assert.equal(isPlaybackGuardActive({ hasTrack: true, isPlaying: true, isLoading: false }), true);
});

test('guard stays active while buffering between tracks', () => {
  assert.equal(isPlaybackGuardActive({ hasTrack: true, isPlaying: true, isLoading: true }), true);
  assert.equal(isPlaybackGuardActive({ hasTrack: true, isPlaying: false, isLoading: true }), true);
});

test('paused state untouched: loaded but paused track does not arm the guard', () => {
  assert.equal(isPlaybackGuardActive({ hasTrack: true, isPlaying: false, isLoading: false }), false);
});

test('empty queue never arms the guard', () => {
  assert.equal(isPlaybackGuardActive({ hasTrack: false, isPlaying: true, isLoading: false }), false);
  assert.equal(isPlaybackGuardActive({ hasTrack: false, isPlaying: false, isLoading: false }), false);
  assert.equal(isPlaybackGuardActive({ hasTrack: false, isPlaying: false, isLoading: true }), false);
});

// --- decideBackAction ---

const base = {
  guardActive: true,
  urlChanged: false,
  destHasSentinel: false,
  programmatic: false,
  sinceLastAbsorbMs: Number.POSITIVE_INFINITY,
};

test('first Back while playing is absorbed (sentinel re-park + toast)', () => {
  assert.equal(decideBackAction({ ...base }), 'absorb');
});

test('second Back within 2.5s allows exit', () => {
  assert.equal(decideBackAction({ ...base, sinceLastAbsorbMs: 0 }), 'exit');
  assert.equal(decideBackAction({ ...base, sinceLastAbsorbMs: 1200 }), 'exit');
  assert.equal(decideBackAction({ ...base, sinceLastAbsorbMs: 2499 }), 'exit');
});

test('second Back after the window starts a fresh absorb cycle', () => {
  assert.equal(decideBackAction({ ...base, sinceLastAbsorbMs: 2500 }), 'absorb');
  assert.equal(decideBackAction({ ...base, sinceLastAbsorbMs: 5000 }), 'absorb');
});

test('paused/empty state: Back is always allowed (untouched)', () => {
  assert.equal(decideBackAction({ ...base, guardActive: false }), 'allow');
  assert.equal(decideBackAction({ ...base, guardActive: false, sinceLastAbsorbMs: 100 }), 'allow');
});

test('normal in-app navigation untouched: URL-changing Back always allowed', () => {
  assert.equal(decideBackAction({ ...base, urlChanged: true }), 'allow');
  // ...even right after an absorb, and even without a sentinel flag.
  assert.equal(decideBackAction({ ...base, urlChanged: true, sinceLastAbsorbMs: 100 }), 'allow');
});

test('Back landing on a buried sentinel is navigation, not an exit attempt', () => {
  assert.equal(decideBackAction({ ...base, destHasSentinel: true }), 'allow');
});

test('our own programmatic history.back() is always let through', () => {
  assert.equal(decideBackAction({ ...base, programmatic: true }), 'allow');
  assert.equal(decideBackAction({ ...base, programmatic: true, sinceLastAbsorbMs: 100 }), 'allow');
});

// --- shouldParkSentinel ---

test('park sentinel when playing with player closed and a clean stack top', () => {
  assert.equal(shouldParkSentinel({
    guardActive: true, playerOpen: false, topHasSentinel: false, topHasPlayerFlag: false,
  }), true);
});

test('never double-park and never park over the player entry', () => {
  assert.equal(shouldParkSentinel({
    guardActive: true, playerOpen: false, topHasSentinel: true, topHasPlayerFlag: false,
  }), false);
  assert.equal(shouldParkSentinel({
    guardActive: true, playerOpen: false, topHasSentinel: false, topHasPlayerFlag: true,
  }), false);
});

test('park is deferred while the player overlay is open', () => {
  assert.equal(shouldParkSentinel({
    guardActive: true, playerOpen: true, topHasSentinel: false, topHasPlayerFlag: false,
  }), false);
});

test('no park while paused or with an empty queue', () => {
  assert.equal(shouldParkSentinel({
    guardActive: false, playerOpen: false, topHasSentinel: false, topHasPlayerFlag: false,
  }), false);
});

// --- shouldConsumeSentinel ---

test('consume the sentinel on pause when it sits on the stack top', () => {
  assert.equal(shouldConsumeSentinel({
    guardActive: false, playerOpen: false, topHasSentinel: true, topHasPlayerFlag: false,
  }), true);
});

test('never consume while playing, while player open, or without a sentinel', () => {
  const yes = { guardActive: false, playerOpen: false, topHasSentinel: true, topHasPlayerFlag: false };
  assert.equal(shouldConsumeSentinel({ ...yes, guardActive: true }), false);
  assert.equal(shouldConsumeSentinel({ ...yes, playerOpen: true }), false);
  assert.equal(shouldConsumeSentinel({ ...yes, topHasSentinel: false }), false);
  assert.equal(shouldConsumeSentinel({ ...yes, topHasPlayerFlag: true }), false);
});
