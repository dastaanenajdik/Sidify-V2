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
  const savedLocally = [];
  const lib = {
    downloadSavedLocal: (...args) => savedLocally.push(args),
    mergeDownloads: (server) => server,
    backendLooksDown: () => false,
    markBackendDown() {},
    markBackendUp() {},
  };
  vm.runInNewContext(code, {
    exports, module: { exports }, console, fetch: fetchImpl, Blob, Uint8Array, URL, Response, Headers,
    // Real timers: the downloader's retry backoff and its inactivity watchdog are both
    // part of what these tests assert, and faking one of them breaks the other.
    setTimeout, clearTimeout,
    AbortController, DOMException, Promise, Error, Date, JSON, Math, Number,
    encodeURIComponent, decodeURIComponent,
    require: (id) => {
      if (id === './offlineDb') return { idbPut: idb.put, idbClear: async () => {}, dropObjectUrl() {} };
      if (id === './localLibrary') return lib;
      if (id.startsWith('./')) return anyStub;
      throw new Error(`unexpected import ${id}`);
    },
  });
  return { ...exports, savedLocally };
}

const FILE_BYTES = 5 * 1024 * 1024 + 123; // 5 MB + change: three 2 MB chunks, last one short
const file = new Uint8Array(FILE_BYTES).map((_, i) => i % 251);
const track = { id: 't1', videoId: 'abcdefghijk', title: 'Song', artist: 'Singer', durationMs: 1000 };

/**
 * Streams a slice in 64 kB pieces, the way a real transfer arrives — and optionally
 * dies `breakAfter` bytes in, the way a dropped mobile link does.
 */
function streamedResponse(slice, headers, { status = 206, breakAfter = Infinity } = {}) {
  let sent = 0;
  const body = new ReadableStream({
    pull(controller) {
      if (sent >= breakAfter) {
        controller.error(new TypeError('network error'));
        return;
      }
      const n = Math.min(64 * 1024, breakAfter - sent, slice.byteLength - sent);
      controller.enqueue(slice.slice(sent, sent + n));
      sent += n;
      if (sent >= slice.byteLength) controller.close();
    },
  });
  return new Response(body, { status, headers });
}

function rangeServer({
  hiccupOnce = false,
  ignoreRange = false,
  breakBodyOnceAt = null, // byte offset inside the slice where the transfer dies once
  totalOverride = null, // lie about the file size in Content-Range
  changeTotalAfter = null, // switch to a different length mid-download
  metaContentLength = FILE_BYTES,
  noMeta = false,
} = {}) {
  const requests = [];
  let hiccuped = false;
  let broke = false;
  let bytesServed = 0;

  const fetchImpl = async (url, init) => {
    // JSON mode (metadata probe) — no `play=1`.
    if (!String(url).includes('play=1')) {
      requests.push({ kind: 'meta', url: String(url) });
      if (noMeta) return new Response('{"success":false}', { status: 503 });
      return new Response(
        JSON.stringify({ success: true, content_length: metaContentLength, mime_type: 'audio/mp4' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }

    const range = init?.headers?.range || '';
    requests.push({ kind: 'bytes', range });

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
    const slice = file.subarray(start, end + 1);
    const total = changeTotalAfter && start >= changeTotalAfter ? totalOverride ?? FILE_BYTES + 999 : FILE_BYTES;
    const headers = {
      'content-type': 'audio/mp4; codecs="mp4a.40.2"',
      'content-range': `bytes ${start}-${end}/${total}`,
      'content-length': String(end - start + 1),
    };

    bytesServed += slice.byteLength;
    if (breakBodyOnceAt !== null && !broke && start <= breakBodyOnceAt && breakBodyOnceAt <= end) {
      broke = true;
      return streamedResponse(slice, headers, { breakAfter: breakBodyOnceAt - start });
    }
    return streamedResponse(slice, headers);
  };

  return { fetchImpl, requests, byteRequests: () => requests.filter((r) => r.kind === 'bytes'), bytesServed: () => bytesServed };
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
  assert.deepEqual(server.byteRequests().map((r) => r.range), [
    'bytes=0-2097151',
    'bytes=2097152-4194303',
    'bytes=4194304-6291455',
  ]);
  assert.equal(server.requests[0].kind, 'meta', 'the size probe goes out alongside the first chunk');
  assert.ok(progress.length >= 3 && progress.at(-1) === 99, 'progress reported per chunk');
});

test('progress is reported while the bytes are still arriving, not once per chunk', async () => {
  const server = rangeServer();
  const api = loadClientApi(server.fetchImpl, { put: async () => {} });
  const progress = [];
  await api.fetchTrackAudio(track, (p) => progress.push(p));
  // Three chunks, but the body is drained slice by slice: the UI gets far more than
  // three updates, and they only ever move forward.
  assert.ok(progress.length > 20, `expected a fine-grained percentage, got ${progress.length} updates`);
  for (let i = 1; i < progress.length; i++) assert.ok(progress[i] >= progress[i - 1], 'percentage never goes backwards');
  assert.equal(progress.at(-1), 99);
});

test('the size probe alone is enough to show a percentage before the first chunk lands', async () => {
  const server = rangeServer();
  const api = loadClientApi(server.fetchImpl, { put: async () => {} });
  const progress = [];
  await api.fetchTrackAudio(track, (p) => progress.push(p));
  assert.ok(progress[0] > 0, `first update was ${progress[0]}`);
});

test('a connection that dies mid-chunk resumes where it stopped instead of failing', async () => {
  // Breaks 900 kB into the second chunk — the classic "downloading… then Download failed".
  const breakAt = 2 * 1024 * 1024 + 900 * 1024;
  const server = rangeServer({ breakBodyOnceAt: breakAt });
  const api = loadClientApi(server.fetchImpl, { put: async () => {} });
  const out = await api.fetchTrackAudio(track);
  assert.equal(out.size, FILE_BYTES);
  assert.deepEqual(await bytesOf(out.blob), file, 'the file is still byte-perfect after the drop');
  const ranges = server.byteRequests().map((r) => r.range);
  assert.deepEqual(ranges, [
    'bytes=0-2097151',
    'bytes=2097152-4194303', // dies 900 kB in
    `bytes=${breakAt}-${breakAt + 2 * 1024 * 1024 - 1}`, // resumes exactly where it stopped
    `bytes=${breakAt + 2 * 1024 * 1024}-${breakAt + 4 * 1024 * 1024 - 1}`,
  ]);
});

test('a 503 from the resolver is retried and the download still completes', async () => {
  const server = rangeServer({ hiccupOnce: true });
  const api = loadClientApi(server.fetchImpl, { put: async () => {} });
  const out = await api.fetchTrackAudio(track);
  assert.equal(out.size, FILE_BYTES);
  assert.equal(server.byteRequests().length, 4, 'one retry, then three chunks');
});

test('a proxy that answers 200 (no Range support) is accepted as the whole file', async () => {
  const server = rangeServer({ ignoreRange: true });
  const api = loadClientApi(server.fetchImpl, { put: async () => {} });
  const out = await api.fetchTrackAudio(track);
  assert.equal(out.size, FILE_BYTES);
  assert.equal(server.byteRequests().length, 1);
});

test('an upstream that changes format mid-download does not splice two files together', async () => {
  const server = rangeServer({ changeTotalAfter: 2 * 1024 * 1024, totalOverride: FILE_BYTES + 4096 });
  const api = loadClientApi(server.fetchImpl, { put: async () => {} });
  await assert.rejects(api.fetchTrackAudio(track), /length changed|jumped/);
});

test('a truncated transfer is reported instead of being cached as a song', async () => {
  const server = rangeServer({ metaContentLength: FILE_BYTES });
  const fetchImpl = async (url, init) => {
    if (String(url).includes('play=1')) {
      const range = init?.headers?.range || '';
      if (/bytes=4194304-/.test(range)) return new Response(null, { status: 416 }); // early EOF
    }
    return server.fetchImpl(url, init);
  };
  const api = loadClientApi(fetchImpl, { put: async () => {} });
  await assert.rejects(api.fetchTrackAudio(track), /incomplete/i);
});

test('the size probe failing is harmless — Content-Range carries the same number', async () => {
  const server = rangeServer({ noMeta: true });
  const api = loadClientApi(server.fetchImpl, { put: async () => {} });
  const progress = [];
  const out = await api.fetchTrackAudio(track, (p) => progress.push(p));
  assert.equal(out.size, FILE_BYTES);
  assert.ok(progress.length > 0 && progress.at(-1) === 99);
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
  assert.deepEqual(api.savedLocally[0].slice(0, 3), [track, 'high', FILE_BYTES], 'kept in the local mirror too');
});

test('a download that never registers on the server still counts as saved', async () => {
  const server = rangeServer();
  const stored = {};
  const fetchImpl = async (url, init) => {
    if (url === '/api/downloads') throw new TypeError('Failed to fetch');
    return server.fetchImpl(url, init);
  };
  const api = loadClientApi(fetchImpl, { put: async (id, blob) => { stored[id] = blob; } });
  const size = await api.downloadTrack(track, 'high');
  assert.equal(size, FILE_BYTES);
  assert.ok(stored.t1, 'the audio is in IndexedDB even though the metadata POST failed');
});

test('tracks without a videoId are rejected up front', async () => {
  const api = loadClientApi(async () => { throw new Error('must not fetch'); }, { put: async () => {} });
  await assert.rejects(api.fetchTrackAudio({ ...track, videoId: undefined }), /not downloadable/);
});

/**
 * A response that opens and then never delivers a byte. Like a real fetch, it honours
 * the request signal — that is what lets the inactivity watchdog kill it.
 */
function silentResponse(headers, init) {
  return new Response(
    new ReadableStream({
      start(controller) {
        init?.signal?.addEventListener('abort', () => {
          try { controller.error(new DOMException('This operation was aborted', 'AbortError')); } catch { /* already done */ }
        });
      },
    }),
    { status: 206, headers }
  );
}

test('a transfer that goes silent is aborted and resumed, not left hanging', async () => {
  // The second request accepts the connection and then never sends a byte.
  const server = rangeServer();
  let hung = false;
  const fetchImpl = async (url, init) => {
    if (String(url).includes('play=1') && !hung && /bytes=2097152-/.test(init?.headers?.range || '')) {
      hung = true;
      return silentResponse(
        { 'content-type': 'audio/mp4', 'content-range': `bytes 2097152-4194303/${FILE_BYTES}` },
        init
      );
    }
    return server.fetchImpl(url, init);
  };
  const api = loadClientApi(fetchImpl, { put: async () => {} });
  const out = await api.fetchTrackAudio(track, undefined, undefined, { inactivityMs: 120 });
  assert.equal(out.size, FILE_BYTES, 'the silent attempt was abandoned and the rest downloaded');
  assert.deepEqual(await bytesOf(out.blob), file);
});

test('every attempt going silent fails the download instead of spinning forever', async () => {
  const fetchImpl = async (url, init) => {
    if (String(url).includes('play=1')) {
      return silentResponse(
        { 'content-type': 'audio/mp4', 'content-range': `bytes 0-2097151/${FILE_BYTES}` },
        init
      );
    }
    return new Response(JSON.stringify({ content_length: FILE_BYTES }), { status: 200 });
  };
  const api = loadClientApi(fetchImpl, { put: async () => {} });
  await assert.rejects(api.fetchTrackAudio(track, undefined, undefined, { inactivityMs: 60 }), /stalled/i);
});

test('a caller-side cancel stops the download instead of retrying forever', async () => {
  let calls = 0;
  const fetchImpl = async (url, init) => {
    if (String(url).includes('play=1')) {
      calls++;
      return silentResponse({ 'content-type': 'audio/mp4', 'content-range': `bytes 0-2097151/${FILE_BYTES}` }, init);
    }
    return new Response(JSON.stringify({ content_length: FILE_BYTES }), { status: 200 });
  };
  const api = loadClientApi(fetchImpl, { put: async () => {} });
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 40);
  await assert.rejects(api.fetchTrackAudio(track, undefined, ctrl.signal), /abort/i);
  assert.ok(calls <= 2, `a cancelled download stops trying (made ${calls} requests)`);
});

test('a 4xx verdict is not retried into a long wait', async () => {
  let bytes = 0;
  const fetchImpl = async (url) => {
    if (!String(url).includes('play=1')) return new Response(JSON.stringify({ content_length: FILE_BYTES }), { status: 200 });
    bytes++;
    return new Response('{"error":"nope"}', { status: 403 });
  };
  const api = loadClientApi(fetchImpl, { put: async () => {} });
  await assert.rejects(api.fetchTrackAudio(track), /Download failed \(403\)/);
  assert.equal(bytes, 1, 'a blocked/private video fails on the first answer');
});
