const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const filename = path.resolve(__dirname, '../src/lib/lyrics.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { findLyrics, queryVariants, LyricsUnavailableError } = compiled.exports;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status });
const record = { trackName: 'Test Song', artistName: 'Singer', plainLyrics: 'Test fixture lyrics' };

test('cleans channel suffix and splits video credits', () => {
  const variants = queryVariants({ title: 'Singer - Test Song (Official Video) | Film', artist: 'Singer - Topic' });
  assert.equal(variants[0].artist, 'Singer');
  assert.ok(variants.some(v => v.title === 'Test Song' && v.artist === 'Singer'));
});
test('exact lookup returns lyrics and duration', async () => {
  const result = await findLyrics({ title: 'Test Song', artist: 'Singer', duration: 200 }, async url => {
    assert.ok(url.includes('duration=200'));
    return response(record);
  });
  assert.equal(result.lyrics, record.plainLyrics);
});
test('title search tolerates a label instead of singer; strips LRC timestamps', async () => {
  const result = await findLyrics({ title: 'Test Song', artist: 'Record Label' }, async url =>
    url.includes('/search?') ? response([{ ...record, plainLyrics: null, syncedLyrics: '[00:01.20]Test line' }]) : response({}, 404));
  assert.equal(result.lyrics, 'Test line');
});
test('does not select unrelated title or ambiguous artists', async () => {
  const result = await findLyrics({ title: 'Test Song' }, async url =>
    url.includes('/search?') ? response([record, { ...record, artistName: 'Other Singer' }, { ...record, trackName: 'Other Song' }]) : response({}, 404));
  assert.equal(result, null);
});
test('secondary provider works when primary fails', async () => {
  const result = await findLyrics({ title: 'Test Song', artist: 'Singer' }, async url =>
    url.includes('api.lyrics.ovh') ? response({ lyrics: 'Fallback fixture' }) : response({}, 503));
  assert.equal(result.source, 'lyrics.ovh');
});
test('instrumental is not reported as missing', async () => {
  const result = await findLyrics({ title: 'Test Song' }, async () => response({ ...record, plainLyrics: null, instrumental: true }));
  assert.equal(result.instrumental, true);
});
test('genuine misses return null', async () => {
  assert.equal(await findLyrics({ title: 'Missing', artist: 'Singer' }, async () => response({}, 404)), null);
});
test('network failures are retryable and requests have timeout signals', async () => {
  await assert.rejects(findLyrics({ title: 'Test Song', artist: 'Singer' }, async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    throw new Error('offline');
  }), LyricsUnavailableError);
});

/* ---------------- synced lyrics (LRC) ---------------- */
const { parseLrc, activeLineIndex, linesToText, usableSync } = compiled.exports;

test('parseLrc reads timestamps, fractions of different precision and repeated stamps', () => {
  const lines = parseLrc('[00:12.43]First line\n[00:16.1][01:02.80]Chorus line\n[00:20]Whole second');
  assert.deepEqual(lines, [
    { startMs: 12430, text: 'First line' },
    { startMs: 16100, text: 'Chorus line' },
    { startMs: 20000, text: 'Whole second' },
    { startMs: 62800, text: 'Chorus line' },
  ]);
});
test('parseLrc ignores metadata tags, empty lines and stamp-only instrumental breaks', () => {
  const lines = parseLrc('[ar:Singer]\n[ti:Song]\n[00:00.00]\n[00:04.20]Verse one\n\n[00:09.00]  Verse   two  ');
  assert.deepEqual(lines, [
    { startMs: 4200, text: 'Verse one' },
    { startMs: 9000, text: 'Verse two' },
  ]);
});
test('parseLrc applies the offset tag and never returns negative times', () => {
  assert.deepEqual(parseLrc('[offset:500]\n[00:10.00]Late by half a second'), [{ startMs: 10500, text: 'Late by half a second' }]);
  assert.deepEqual(parseLrc('[offset:-9000]\n[00:05.00]Clamped'), [{ startMs: 0, text: 'Clamped' }]);
});
test('parseLrc strips enhanced-LRC word markers so line sync still works', () => {
  const lines = parseLrc('[00:12.43]<00:12.43>Tum<00:12.90> hi<00:13.20> ho');
  assert.deepEqual(lines, [{ startMs: 12430, text: 'Tum hi ho' }]);
});
test('parseLrc sorts out-of-order timestamps and tolerates junk', () => {
  assert.deepEqual(parseLrc('not lrc at all\n[00:30.00]Later\n[00:10.00]Earlier'), [
    { startMs: 10000, text: 'Earlier' },
    { startMs: 30000, text: 'Later' },
  ]);
  assert.deepEqual(parseLrc(''), []);
  assert.deepEqual(parseLrc(null), []);
  assert.deepEqual(parseLrc(undefined), []);
});
test('usableSync rejects payloads without real timing', () => {
  assert.equal(usableSync(parseLrc('[00:00.00]Only line')), false);
  assert.equal(usableSync(parseLrc('[00:00.00]A\n[00:05.00]B')), true);
  assert.equal(linesToText(parseLrc('[00:01.00]A\n[00:05.00]B')), 'A\nB');
});
test('activeLineIndex finds the current line and -1 before the first one', () => {
  const lines = parseLrc('[00:05.00]A\n[00:10.00]B\n[00:15.00]C');
  assert.equal(activeLineIndex(lines, 0), -1);
  assert.equal(activeLineIndex(lines, 4999), -1);
  assert.equal(activeLineIndex(lines, 5000), 0);
  assert.equal(activeLineIndex(lines, 12345), 1);
  assert.equal(activeLineIndex(lines, 99999), 2);
  assert.equal(activeLineIndex([], 1000), -1);
});
test('synced payload keeps plain lyrics for copying and exposes timed lines', async () => {
  const result = await findLyrics({ title: 'Test Song', artist: 'Singer' }, async () =>
    response({ trackName: 'Test Song', artistName: 'Singer', plainLyrics: 'Plain text', syncedLyrics: '[00:01.20]Timed line one\n[00:04.80]Timed line two' }));
  assert.equal(result.lyrics, 'Plain text');
  assert.deepEqual(result.lines, [{ startMs: 1200, text: 'Timed line one' }, { startMs: 4800, text: 'Timed line two' }]);
});
test('synced-only payload falls back to its own text for copying', async () => {
  const result = await findLyrics({ title: 'Test Song', artist: 'Singer' }, async () =>
    response({ trackName: 'Test Song', artistName: 'Singer', plainLyrics: null, syncedLyrics: '[00:01.20]Line one\n[00:04.80]Line two' }));
  assert.equal(result.lyrics, 'Line one\nLine two');
  assert.equal(result.lines.length, 2);
});
test('plain-only and fallback providers report no timed lines', async () => {
  const plain = await findLyrics({ title: 'Test Song', artist: 'Singer' }, async () => response(record));
  assert.deepEqual(plain.lines, []);
  const fallback = await findLyrics({ title: 'Test Song', artist: 'Singer' }, async url =>
    url.includes('api.lyrics.ovh') ? response({ lyrics: 'Fallback fixture' }) : response({}, 503));
  assert.deepEqual(fallback.lines, []);
  const instrumental = await findLyrics({ title: 'Test Song' }, async () => response({ ...record, plainLyrics: null, instrumental: true }));
  assert.deepEqual(instrumental.lines, []);
});
test('a single stray timestamp does not enable the synced view', async () => {
  const result = await findLyrics({ title: 'Test Song', artist: 'Singer' }, async () =>
    response({ trackName: 'Test Song', artistName: 'Singer', plainLyrics: null, syncedLyrics: '[00:00.00]Whole song on one stamp' }));
  assert.equal(result.lyrics, 'Whole song on one stamp');
  assert.deepEqual(result.lines, []);
});
