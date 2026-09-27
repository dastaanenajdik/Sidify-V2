const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Same pattern as the other suites: compile the real module and exercise it directly.
const filename = path.resolve(__dirname, '../src/lib/playbackDiag.ts');
const compiled = new (require('node:module'))(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { diagLog, diagClear, diagEvents, stamp, formatEvents, buildReport } = compiled.exports;

test('stamp pads the wall clock down to milliseconds', () => {
  const at = new Date(2026, 8, 27, 4, 5, 6, 7).getTime();
  assert.equal(stamp(at), '04:05:06.007');
});

test('events keep their insertion order and survive a clear', () => {
  diagClear();
  diagLog('visibility', 'hidden');
  diagLog('mode');
  const list = diagEvents();
  assert.equal(list.length, 2);
  assert.deepEqual(list.map((e) => e.kind), ['visibility', 'mode']);
  assert.equal(list[0].detail, 'hidden');
  assert.equal(list[1].detail, undefined);
  diagClear();
  assert.equal(diagEvents().length, 0);
});

test('the ring buffer drops the oldest events instead of growing forever', () => {
  diagClear();
  for (let i = 0; i < 120; i++) diagLog('tick', String(i));
  const list = diagEvents();
  assert.equal(list.length, 90);
  assert.equal(list[0].detail, '30');
  assert.equal(list.at(-1).detail, '119');
  diagClear();
});

test('the report carries the header block and the event log, oldest first', () => {
  diagClear();
  const fixed = new Date(2026, 8, 27, 4, 5, 6, 7).getTime();
  const text = buildReport({
    fields: [['engine', 'native'], ['user-agent', 'Android Chrome']],
    list: [{ at: fixed, kind: 'PAUSE-WHILE-HIDDEN', detail: 'deck0 · engine=native' }],
    now: fixed,
  });
  const lines = text.split('\n');
  assert.equal(lines[0], 'Sidify playback report');
  assert.equal(lines[1], new Date(fixed).toISOString());
  assert.ok(text.includes('engine      : native'));
  assert.ok(text.includes('user-agent  : Android Chrome'));
  assert.ok(text.includes('--- events (oldest first) ---'));
  assert.ok(text.includes('04:05:06.007  PAUSE-WHILE-HIDDEN  · deck0 · engine=native'));
  diagClear();
});

test('an empty buffer says so instead of printing nothing', () => {
  assert.match(formatEvents([]), /no events recorded yet/);
  assert.match(buildReport({ fields: [['engine', 'idle']], list: [] }), /no events recorded yet/);
});
