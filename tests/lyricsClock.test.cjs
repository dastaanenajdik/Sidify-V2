const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

/* The clock maths lives in its own framework-free module, so it can be
   transpiled and unit-tested without React or a DOM. */
const filename = path.resolve(__dirname, '../src/lib/lyricsClock.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { advanceMediaClock, needsResync, RESYNC_THRESHOLD_MS } = compiled.exports;

test('clock advances with elapsed wall time at 1x', () => {
  assert.equal(advanceMediaClock(10000, 16, 1, 240000), 10016);
});
test('clock honours playback speed in both directions', () => {
  assert.equal(advanceMediaClock(10000, 100, 2, 240000), 10200);
  assert.equal(advanceMediaClock(10000, 100, 0.5, 240000), 10050);
});
test('clock never passes the end of the track', () => {
  assert.equal(advanceMediaClock(239990, 500, 1, 240000), 240000);
  assert.equal(advanceMediaClock(300000, 16, 1, 240000), 240000);
});
test('unknown duration leaves the clock unclamped', () => {
  assert.equal(advanceMediaClock(1000, 16, 1, 0), 1016);
});
test('a stalled frame (background tab) cannot teleport the highlight', () => {
  assert.equal(advanceMediaClock(1000, 60000, 1, 240000), 1500);
  assert.equal(advanceMediaClock(1000, -50, 1, 240000), 1000);
});
test('resync is needed on seeks, pauses and track changes but not on store latency', () => {
  assert.equal(RESYNC_THRESHOLD_MS, 900);
  // Store ticks every ~220-240 ms: at 2x that is ~480 ms of media time — must NOT resync.
  assert.equal(needsResync(10480, 10000, true), false);
  // A 10 s seek backwards, or the position resetting for the next track, must resync.
  assert.equal(needsResync(10000, 500, true), true);
  assert.equal(needsResync(10000, 0, true), true);
  // Paused: freeze exactly where the engine says we are.
  assert.equal(needsResync(10016, 10000, false), true);
});
