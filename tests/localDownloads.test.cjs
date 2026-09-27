const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

/**
 * The Downloads page used to be fed only by `/api/downloads`, so a deployment without a
 * database (or an offline phone) saved the audio into IndexedDB and then showed an empty
 * page — which reads exactly like "the download never happened". These tests pin the
 * local mirror that fixed it.
 */
/** Arrays/objects handed back from the sandbox belong to its realm; `deepStrictEqual`
 *  compares prototypes, so results are copied into this realm before asserting. */
function loadLocalLibrary(storage) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib/localLibrary.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    module: { exports },
    window: { localStorage: storage },
    JSON, Date, Object, Array, Set, Number, String, console,
  });
  return exports;
}

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    raw: map,
  };
}

const track = (id, title) => ({
  id, videoId: `vid-${id}`, title, artist: 'Artist', artwork: '', previewUrl: '', durationMs: 200000,
});

let lib;
beforeEach(() => {
  lib = loadLocalLibrary(fakeStorage());
});

test('a save is remembered on the device and merges into the list', () => {
  lib.downloadSavedLocal(track('a', 'Song A'), 'high', 4_200_000);
  assert.deepEqual(Array.from(lib.downloadedIdsLocal()), ['a']);

  const rows = lib.mergeDownloads([]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].trackId, 'a');
  assert.equal(rows[0].track.title, 'Song A');
  assert.equal(rows[0].sizeBytes, 4_200_000);
  assert.equal(rows[0].quality, 'high');
});

test('the server list wins for a track it knows, local-only saves are kept', () => {
  lib.downloadSavedLocal(track('a', 'Song A'), 'high', 1);
  lib.downloadSavedLocal(track('b', 'Song B'), 'high', 2);

  const merged = lib.mergeDownloads([
    { trackId: 'a', track: track('a', 'Song A (server)'), quality: 'medium', sizeBytes: 99, downloadedAt: '2026-09-27T00:00:00.000Z' },
  ]);
  const byId = Object.fromEntries(Array.from(merged).map((r) => [r.trackId, r]));
  assert.deepEqual(Object.keys(byId).sort(), ['a', 'b']);
  assert.equal(byId.a.track.title, 'Song A (server)', 'server metadata wins for a track it knows');
  assert.equal(byId.a.sizeBytes, 99);
  assert.equal(byId.b.track.title, 'Song B', 'a local-only save is still listed');
});

test('the list is ordered newest download first', () => {
  const rows = lib.mergeDownloads([
    { trackId: 'old', track: track('old', 'Old'), quality: 'high', sizeBytes: 1, downloadedAt: '2020-01-01T00:00:00.000Z' },
    { trackId: 'new', track: track('new', 'New'), quality: 'high', sizeBytes: 1, downloadedAt: '2026-01-01T00:00:00.000Z' },
  ]);
  assert.deepEqual(Array.from(rows).map((r) => r.trackId), ['new', 'old']);
});

test('re-saving a track moves it to the top instead of duplicating it', () => {
  lib.downloadSavedLocal(track('a', 'Song A'), 'high', 1);
  lib.downloadSavedLocal(track('b', 'Song B'), 'high', 2);
  lib.downloadSavedLocal(track('a', 'Song A'), 'high', 5);
  const rows = Array.from(lib.mergeDownloads([]));
  assert.deepEqual(rows.map((r) => r.trackId), ['a', 'b'], 're-saved track is on top, not duplicated');
  assert.equal(rows[0].sizeBytes, 5);
});

test('removing and clearing behave, and both survive a reload of the store', () => {
  const storage = fakeStorage();
  const first = loadLocalLibrary(storage);
  first.downloadSavedLocal(track('a', 'Song A'), 'high', 1);
  first.downloadSavedLocal(track('b', 'Song B'), 'high', 2);

  // A second instance reads the same localStorage — i.e. the mirror is durable.
  const second = loadLocalLibrary(storage);
  assert.deepEqual(Array.from(second.downloadedIdsLocal()), ['b', 'a'], 'newest save first');

  second.downloadRemovedLocal('a');
  assert.deepEqual(Array.from(loadLocalLibrary(storage).downloadedIdsLocal()), ['b']);

  loadLocalLibrary(storage).clearDownloadsLocal();
  assert.deepEqual(Array.from(loadLocalLibrary(storage).downloadsLocal()), []);
});

test('a stored payload without a downloads key does not break reads', () => {
  const legacy = loadLocalLibrary(
    fakeStorage({ 'sidify-local-library': JSON.stringify({ liked: [], recent: [], nextLocalId: -3 }) })
  );
  assert.deepEqual(Array.from(legacy.downloadsLocal()), []);
  assert.deepEqual(Array.from(legacy.mergeDownloads([])), []);
  legacy.downloadSavedLocal(track('a', 'Song A'), 'high', 1);
  assert.deepEqual(Array.from(legacy.downloadedIdsLocal()), ['a']);
});

test('a corrupt stored payload is discarded instead of throwing', () => {
  const broken = loadLocalLibrary(fakeStorage({ 'sidify-local-library': '{not json' }));
  assert.deepEqual(Array.from(broken.downloadsLocal()), []);
  broken.downloadSavedLocal(track('a', 'Song A'), 'high', 1);
  assert.deepEqual(Array.from(broken.downloadedIdsLocal()), ['a']);
});
