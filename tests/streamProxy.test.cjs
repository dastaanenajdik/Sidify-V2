const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const SRC = (p) => fs.readFileSync(path.resolve(__dirname, '..', p), 'utf8');

function transpile(file) {
  return ts.transpileModule(SRC(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: file,
  }).outputText;
}

/** Loads a TS module in a sandbox with its `@/lib/*` imports resolved for real. */
function loadModule(file, overrides = {}) {
  const exports = {};
  const module = { exports };
  const sandboxRequire = (id) => {
    if (overrides[id]) return overrides[id];
    if (id === 'next/server') return require('next/server');
    if (id.startsWith('@/lib/')) return loadModule(`src/lib/${id.slice('@/lib/'.length)}.ts`, overrides);
    throw new Error(`unexpected import ${id} (from ${file})`);
  };
  vm.runInThisContext(
    `(function (exports, module, require, fetch, URL, Response, Headers, Request, console, setTimeout, clearTimeout) {${transpile(file)}\n})`,
    { filename: file }
  )(exports, module, sandboxRequire, fetch, URL, Response, Headers, Request, console, setTimeout, clearTimeout);
  return exports;
}

/* ---------------------------- fake googlevideo ---------------------------- */

const FILE_BYTES = 4 * 1024 * 1024 + 777; // 4 MB: three Range chunks through the proxy
const media = new Uint8Array(FILE_BYTES).map((_, i) => (i * 7 + 3) % 251);
const cdnLog = [];

let cdn;
let cdnOrigin = '';
let cdnFailNext = false;

function startCdn() {
  return new Promise((resolve) => {
    cdn = http.createServer((req, res) => {
      const range = req.headers.range || '';
      cdnLog.push({ range, ua: req.headers['user-agent'] || '' });
      if (cdnFailNext) {
        cdnFailNext = false;
        res.writeHead(403).end('expired');
        return;
      }
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (!m) {
        res.writeHead(200, { 'content-type': 'audio/mp4', 'content-length': String(FILE_BYTES) });
        res.end(media);
        return;
      }
      const start = Number(m[1]);
      if (start >= FILE_BYTES) {
        res.writeHead(416, { 'content-range': `bytes */${FILE_BYTES}` }).end();
        return;
      }
      const end = m[2] ? Math.min(FILE_BYTES - 1, Number(m[2])) : FILE_BYTES - 1;
      res.writeHead(206, {
        'content-type': 'audio/mp4',
        'content-range': `bytes ${start}-${end}/${FILE_BYTES}`,
        'content-length': String(end - start + 1),
        'accept-ranges': 'bytes',
      });
      res.end(Buffer.from(media.subarray(start, end + 1)));
    });
    cdn.listen(0, '127.0.0.1', () => {
      cdnOrigin = `http://127.0.0.1:${cdn.address().port}`;
      resolve();
    });
  });
}

/* --------------------- the real /api/stream route handler --------------------- */

let resolveShouldFail = false;
let resolveCalls = 0;

const engineStub = {
  async resolveAudio(videoId, skipCache) {
    resolveCalls++;
    if (resolveShouldFail) return null;
    return {
      url: `${cdnOrigin}/videoplayback?id=${videoId}`,
      title: 'Test Song',
      artist: 'Test Artist',
      duration: 214,
      thumbnail: 'https://i.ytimg.com/x.jpg',
      itag: 140,
      mimeType: 'audio/mp4; codecs="mp4a.40.2"',
      contentLength: FILE_BYTES,
    };
  },
};

let proxy;
let proxyOrigin = '';

function startProxy() {
  const route = loadModule('src/app/api/stream/route.ts', { '@/lib/engine': engineStub });
  return new Promise((resolve) => {
    proxy = http.createServer(async (req, res) => {
      const url = new URL(req.url, `http://127.0.0.1`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
      const nextReq = new (require('next/server').NextRequest)(`http://localhost${url.pathname}${url.search}`, {
        method: req.method,
        headers,
      });
      const out = await route.GET(nextReq);
      const h = {};
      out.headers.forEach((v, k) => { h[k] = v; });
      res.writeHead(out.status, h);
      if (!out.body) return res.end();
      try {
        const reader = out.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
      } catch {
        // The downloader went away mid-stream (exactly what a real client does).
        res.destroy();
      }
    });
    proxy.listen(0, '127.0.0.1', () => {
      proxyOrigin = `http://127.0.0.1:${proxy.address().port}`;
      resolve();
    });
  });
}

/* ------------------------------ the real client ------------------------------ */

function loadClient() {
  const code = transpile('src/lib/clientApi.ts');
  const exports = {};
  const noop = new Proxy({}, { get: () => () => undefined });
  vm.runInNewContext(code, {
    exports,
    module: { exports },
    console,
    // The browser would resolve "/api/stream?…" against the page origin.
    fetch: (url, init) => fetch(`${proxyOrigin}${url}`, init),
    Blob, Uint8Array, URL, Response, Headers, AbortController, setTimeout, clearTimeout, Promise, Error, Date, JSON, Math, Number,
    encodeURIComponent, decodeURIComponent,
    require: (id) => {
      if (id === './offlineDb') return { idbPut: async () => {}, idbClear: async () => {}, dropObjectUrl() {} };
      if (id.startsWith('./')) return noop;
      throw new Error(`unexpected import ${id}`);
    },
  });
  return exports;
}

const track = { id: 'song1', videoId: 'abcdefghijk', title: 'Test Song', artist: 'Test Artist', durationMs: 214000 };

before(async () => {
  await startCdn();
  await startProxy();
});

after(() => {
  cdn?.close();
  proxy?.close();
});

test('JSON mode answers with the size the downloader needs for its percentage', async () => {
  const res = await fetch(`${proxyOrigin}/api/stream?video_id=abcdefghijk`);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.content_length, FILE_BYTES);
  assert.equal(data.mime_type, 'audio/mp4; codecs="mp4a.40.2"');
  assert.equal(data.audio_url, '/api/stream?video_id=abcdefghijk&play=1');
  assert.ok(data.download_url.includes('download=1'));
});

test('the proxy passes Range through and the downloader reassembles the file', async () => {
  cdnLog.length = 0;
  const api = loadClient();
  const progress = [];
  const out = await api.fetchTrackAudio(track, (p) => progress.push(p));

  assert.equal(out.size, FILE_BYTES);
  assert.equal(out.mime, 'audio/mp4');
  assert.deepEqual(new Uint8Array(await out.blob.arrayBuffer()), media);

  // Every byte request reached the CDN as the same Range the client asked for.
  const ranges = cdnLog.map((r) => r.range);
  assert.deepEqual(ranges, ['bytes=0-2097151', 'bytes=2097152-4194303', 'bytes=4194304-6291455']);
  assert.ok(ranges.length && cdnLog.every((r) => r.ua.length > 0), 'a user-agent is forwarded upstream');
  assert.ok(progress.length > 10, `live percentage, got ${progress.length} updates`);
  assert.equal(progress.at(-1), 99);
});

test('a stale CDN URL (403) is re-resolved and the download still finishes', async () => {
  cdnFailNext = true;
  resolveCalls = 0;
  const api = loadClient();
  const out = await api.fetchTrackAudio(track);
  assert.equal(out.size, FILE_BYTES);
  assert.ok(resolveCalls >= 2, `expected a re-resolve after the 403, saw ${resolveCalls} resolve calls`);
});

test('an unresolvable video surfaces as a real error, not a silent 0-byte file', async () => {
  resolveShouldFail = true;
  try {
    const api = loadClient();
    await assert.rejects(api.fetchTrackAudio(track), /Download failed \(503\)/);
  } finally {
    resolveShouldFail = false;
  }
});

test('download=1 serves an attachment with an honest file name', async () => {
  const res = await fetch(`${proxyOrigin}/api/stream?video_id=abcdefghijk&play=1&download=1&title=Test%20Song&artist=Test%20Artist`);
  assert.equal(res.status, 200);
  const cd = res.headers.get('content-disposition') || '';
  assert.match(cd, /attachment/);
  assert.match(cd, /\.m4a/, 'AAC in mp4 is saved as .m4a, never as .mp3');
  assert.equal((await res.arrayBuffer()).byteLength, FILE_BYTES);
});
