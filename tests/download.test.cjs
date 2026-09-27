const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercises the chunked "Save to device / offline" downloader in clientApi.ts against a
// fake Range-aware /api/stream, without React, IndexedDB or a network.
function loadClientApi(fetchImpl, idb) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib/clientApi.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  const anyStub = new Proxy({}, { get: () => () => undefined });
  vm.runInNewContext(code, {
    exports, module: { exports }, console, fetch: fetchImpl, Blob, Uint8Array, URL, Response, Headers,
    setTimeout: (fn) => { fn(); return 1; }, clearTimeout() {}, Promise, Error, Date, JSON, Math, Number,
    encodeURIComponent, decodeURIComponent,
    require: (id) => {
      if (id === './offlineDb') return { idbPut: idb.put, idbClear: async () => {}, dropObjectUrl() {} };
      if (id === './localLibrary' || id.startsWith('./')) return anyStub;
      throw new Error(`unexpected import ${id}`);
    },
  });
  return exports;
}

const FILE_BYTES = 5 * 1024 * 1024 + 123; // 5 MB + change: three 2 MB chunks, last one short
const file = new Uint8Array(FILE_BYTES).map((_, i) => i % 251);
const track = { id: 't1', videoId: 'abcdefghijk', title: 'Song', artist: 'Singer', durationMs: 1000 };

function rangeServer({ hiccupOnce = false, ignoreRange = false } = {}) {
  const requests = [];
  let hiccuped = false;
  const fetchImpl = async (url, init) => {
    const range = init?.headers?.range || '';
    requests.push(range);
    if (hiccupOnce && !hiccuped) {
      hiccuped = true;
      return new Response('{"error":"stream_unavailable"}', { status: 503 });
    }
    if (ignoreRange || !range) {
      return new Response(file, { status: 200, headers: { 'content-type': 'audio/mp4', 'content-length': String(FILE_BYTES) } });
    }
    const m = /bytes=(\d+)-(\d+)?/.exec(range);
    const start = Number(m[1]);
    if (start >= FILE_BYTES) return new Response(null, { status: 416 });
    const end = Math.min(FILE_BYTES - 1, m[2] ? Number(m[2]) : FILE_BYTES - 1);
    return new Response(file.subarray(start, end + 1), {
      status: 206,
      headers: {
        'content-type': 'audio/mp4; codecs="mp4a.40.2"',
        'content-range': `bytes ${start}-${end}/${FILE_BYTES}`,
        'content-length': String(end - start + 1),
      },
    });
  };
  return { fetchImpl, requests };
}

async function bytesOf(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

test('fetchTrackAudio pulls the file in 2 MB Range chunks and reassembles it byte-for-byte', async () => {
  const server = rangeServer();
  const api = loadClientApi(server.fetchImpl, { put: async () => {} });
  const progress = [];
  const out = await api.fetchTrackAudio(track, (p) => progress.push(p));
  assert.equal(out.size, FILE_BYTES);
  assert.equal(out.mime, 'audio/mp4');
  assert.deepEqual(await bytesOf(out.blob), file);
  assert.deepEqual(server.requests, ['bytes=0-2097151', 'bytes=2097152-4194303', 'bytes=4194304-6291455']);
  assert.ok(progress.length >= 3 && progress.at(-1) === 99, 'progress reported per chunk');
});

test('a 503 from the resolver is retried and the download still completes', async () => {
  const server = rangeServer({ hiccupOnce: true });
  const api = loadClientApi(server.fetchImpl, { put: async () => {} });
  const out = await api.fetchTrackAudio(track);
  assert.equal(out.size, FILE_BYTES);
  assert.equal(server.requests.length, 4, 'one retry, then three chunks');
});

test('a proxy that answers 200 (no Range support) is accepted as the whole file', async () => {
  const server = rangeServer({ ignoreRange: true });
  const api = loadClientApi(server.fetchImpl, { put: async () => {} });
  const out = await api.fetchTrackAudio(track);
  assert.equal(out.size, FILE_BYTES);
  assert.equal(server.requests.length, 1);
});

test('downloadTrack stores the blob offline with its real MIME type and registers it', async () => {
  const server = rangeServer();
  const stored = {};
  const posted = [];
  const fetchImpl = async (url, init) => {
    if (url === '/api/downloads') { posted.push(JSON.parse(init.body)); return new Response('{"ok":true}'); }
    return server.fetchImpl(url, init);
  };
  const api = loadClientApi(fetchImpl, { put: async (id, blob) => { stored[id] = blob; } });
  const size = await api.downloadTrack(track, 'high');
  assert.equal(size, FILE_BYTES);
  assert.equal(stored.t1.type, 'audio/mp4');
  assert.equal(posted[0].track.id, 't1');
  assert.equal(posted[0].sizeBytes, FILE_BYTES);
});

test('tracks without a videoId are rejected up front', async () => {
  const api = loadClientApi(async () => { throw new Error('must not fetch'); }, { put: async () => {} });
  await assert.rejects(api.fetchTrackAudio({ ...track, videoId: undefined }), /not downloadable/);
});
