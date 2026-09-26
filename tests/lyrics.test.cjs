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
