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
      for (const ext of ['.ts', '.js']) {
        const candidate = path.resolve(path.dirname(parent.filename), `${request}${ext}`);
        if (fs.existsSync(candidate)) return loadTs(path.relative(__dirname, candidate));
      }
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

const snapshots = loadTs('../src/lib/media/exclusiveSnapshot.ts');

/** A localStorage stand-in: same contract, controllable failure and quota. */
function memoryStorage({ failWrites = false, quotaAfterBytes = Infinity } = {}) {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      if (failWrites) throw new Error('SecurityError: storage is disabled');
      if (value.length > quotaAfterBytes) {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        throw error;
      }
      data.set(key, value);
    },
    removeItem: (key) => data.delete(key),
  };
}

const TITLE = { slug: 'vault-101-night-train', title: 'Night Train', kind: 'movie' };

test('a snapshot round-trips through storage', () => {
  const storage = memoryStorage();
  assert.equal(snapshots.writeSnapshot('home', [TITLE], storage, 1_000), true);

  const read = snapshots.readSnapshot('home', 60_000, storage, 2_000);
  assert.ok(read, 'the snapshot must be readable back');
  assert.equal(read.at, 1_000);
  assert.deepEqual(read.value, [TITLE]);
  assert.deepEqual(snapshots.snapshotKeys(storage), ['home']);
});

test('a missing or empty store reads as "no snapshot", never throws', () => {
  assert.equal(snapshots.readSnapshot('home', 60_000, memoryStorage()), null);
  assert.equal(snapshots.readSnapshot('home', 60_000, null), null);
  assert.equal(snapshots.writeSnapshot('home', [TITLE], null), false);

  const broken = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(snapshots.readSnapshot('home', 60_000, broken), null);
  assert.equal(snapshots.writeSnapshot('home', [TITLE], broken), false);
});

test('a snapshot older than the allowed age is ignored, not rendered', () => {
  const storage = memoryStorage();
  snapshots.writeSnapshot('home', [TITLE], storage, 1_000);
  assert.equal(snapshots.readSnapshot('home', 500, storage, 1_000 + 501), null, 'expired snapshots are dropped');
  assert.ok(snapshots.readSnapshot('home', 60_000, storage, 1_000 + 501), 'fresh ones survive');
});

test('a snapshot stamped in the future is treated as invalid', () => {
  const storage = memoryStorage();
  snapshots.writeSnapshot('home', [TITLE], storage, 10_000);
  assert.equal(snapshots.readSnapshot('home', 60_000, storage, 5_000), null);
});

test('a payload from an older version is discarded and pruned on the next write', () => {
  const storage = memoryStorage();
  storage.setItem(
    snapshots.SNAPSHOT_KEY,
    JSON.stringify({
      home: { v: 0, at: Date.now(), value: [TITLE] },
      stale: { v: 0, at: Date.now(), value: [] },
    })
  );
  assert.equal(snapshots.readSnapshot('home', 60_000, storage), null, 'v0 payloads are not rendered');
  assert.deepEqual(snapshots.snapshotKeys(storage), [], 'unknown versions are dropped while parsing');

  snapshots.writeSnapshot('home', [TITLE], storage);
  const stored = JSON.parse(storage.getItem(snapshots.SNAPSHOT_KEY));
  assert.deepEqual(Object.keys(stored), ['home']);
  assert.equal(stored.home.v, snapshots.SNAPSHOT_VERSION);
});

test('corrupt JSON is treated as an empty store', () => {
  const storage = memoryStorage();
  storage.setItem(snapshots.SNAPSHOT_KEY, '{not json');
  assert.equal(snapshots.readSnapshot('home', 60_000, storage), null);
  assert.equal(snapshots.writeSnapshot('home', [TITLE], storage), true, 'a corrupt store is replaced, not fatal');
  assert.ok(snapshots.readSnapshot('home', 60_000, storage));
});

test('an oversized entry is refused instead of filling the store', () => {
  const storage = memoryStorage();
  const huge = Array.from({ length: 6_000 }, (_, index) => ({ ...TITLE, slug: `vault-${index}`, blurb: 'x'.repeat(100) }));
  assert.equal(snapshots.writeSnapshot('big', huge, storage), false);
  assert.equal(storage.getItem(snapshots.SNAPSHOT_KEY), null, 'nothing is written');
});

test('the store is bounded: the oldest entries are evicted first', () => {
  const storage = memoryStorage();
  for (let index = 0; index < 30; index += 1) {
    snapshots.writeSnapshot(`search:${index}`, [TITLE], storage, 1_000 + index);
  }
  const keys = snapshots.snapshotKeys(storage);
  assert.ok(keys.length <= 24, `expected at most 24 entries, got ${keys.length}`);
  // The newest must survive; the oldest must not.
  assert.ok(keys.includes('search:29'), 'the newest entry is kept');
  assert.ok(!keys.includes('search:0'), 'the oldest entry is evicted');
});

test('a quota error retries with only the newest entries', () => {
  const storage = memoryStorage({ quotaAfterBytes: 1_400 });
  // Small enough to pass the per-entry cap, large enough that several of them
  // together exceed the fake quota.
  const payload = [{ ...TITLE, blurb: 'y'.repeat(200) }];
  for (let index = 0; index < 8; index += 1) {
    snapshots.writeSnapshot(`k${index}`, payload, storage, 1_000 + index);
  }
  const keys = snapshots.snapshotKeys(storage);
  assert.ok(keys.length > 0, 'at least one entry survives the quota error');
  assert.ok(keys.length <= 4, `the retry keeps at most the newest few, got ${keys.length}`);
  assert.ok(keys.length >= 2, `the retry must keep more than the newest one, got ${keys.length}`);
  assert.ok(keys.includes('k7'), 'the newest entry is the one kept');
});

test('clearing removes every exclusive snapshot', () => {
  const storage = memoryStorage();
  snapshots.writeSnapshot('home', [TITLE], storage);
  snapshots.writeSnapshot('search:night', [TITLE], storage);
  snapshots.clearSnapshots(storage);
  assert.deepEqual(snapshots.snapshotKeys(storage), []);
  assert.equal(storage.getItem(snapshots.SNAPSHOT_KEY), null);
});
