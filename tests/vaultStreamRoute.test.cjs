const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const ROUTE = path.join(SRC, 'app', 'api', 'media', 'vault-stream', '[...path]', 'route.ts');

/**
 * The byte relay at `/api/media/vault-stream/<token>[/<segment…>]` is the one place the
 * app still touches media bytes (a browser cannot attach the CDN's signed cookie to a
 * cross-origin DASH request). Its routing — token, then trailer segments resolved
 * against the manifest directory — is covered here without any network: the real
 * token codec, segment resolver and manifest rewriter run, only the upstream hop is
 * replaced by a recorder.
 */

function createLoader() {
  const cache = new Map();

  function resolveTarget(request, parentFilename) {
    let base;
    if (request.startsWith('@/')) base = path.join(SRC, request.slice(2));
    else if (request.startsWith('.') && parentFilename) base = path.resolve(path.dirname(parentFilename), request);
    else return null;
    for (const ext of ['', '.ts', '.tsx', '.js']) {
      const full = base + ext;
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    }
    return null;
  }

  function loadModule(targetFile) {
    if (cache.has(targetFile)) return cache.get(targetFile).exports;
    const compiled = new Module(targetFile, module);
    compiled.filename = targetFile;
    compiled.paths = Module._nodeModulePaths(path.dirname(targetFile));
    cache.set(targetFile, compiled);

    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
      const resolved = resolveTarget(request, parent && parent.filename);
      if (resolved) return loadModule(resolved);
      return originalLoad.call(this, request, parent, isMain);
    };

    try {
      const output = ts.transpileModule(fs.readFileSync(targetFile, 'utf8'), {
        fileName: targetFile,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText;
      compiled._compile(output, targetFile);
      return compiled.exports;
    } finally {
      Module._load = originalLoad;
    }
  }

  return { load: loadModule };
}

const MANIFEST = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT1M">',
  '  <Period id="0"><AdaptationSet id="0" mimeType="video/mp4"><Representation id="0" bandwidth="900000">',
  '    <SegmentTemplate media="1_video_$Number$.m4s" initialization="1_init.mp4" />',
  '  </Representation></AdaptationSet></Period>',
  '</MPD>',
].join('\n');

/** Loads the route with the upstream hop replaced by a recorder. */
function harness({ manifest = MANIFEST } = {}) {
  const { load } = createLoader();
  const stream = load(path.join(SRC, 'lib', 'media', 'vaultStream.ts'));

  const calls = [];
  stream.fetchVaultStream = async (url, headers, range) => {
    calls.push({ url, headers, range });
    const isManifest = url.split('?')[0].endsWith('.mpd');
    const body = isManifest ? manifest : 'segment-bytes';
    return {
      status: 200,
      headers: new Headers({ 'content-type': isManifest ? 'application/dash+xml' : 'video/mp4' }),
      body: new Response(body).body,
    };
  };

  const route = load(ROUTE);

  /** Builds the request object the App Router hands the handler. */
  function request({ site = 'same-origin', range = null, headers = {} } = {}) {
    const h = new Headers(headers);
    if (site) h.set('sec-fetch-site', site);
    if (range) h.set('range', range);
    return { headers: h, nextUrl: { origin: 'https://site.test' } };
  }

  function call(pathSegments, options) {
    return route.GET(request(options), { params: Promise.resolve({ path: pathSegments }) });
  }

  function tokenFor(extra = {}) {
    return stream
      .buildVaultStreamUrl(
        'https://sbcdn3.hakunaymatata.com/dash/1/index.mpd',
        [['Cookie', 'CloudFront-Policy=abc'], ['Referer', 'https://sportslive.wine']],
        'https://site.test',
        'https://sbcdn3.hakunaymatata.com/dash/1/'
      )
      .split('/api/media/vault-stream/')[1];
  }

  return { calls, call, request, tokenFor, stream, route };
}

const HOST = 'https://sbcdn3.hakunaymatata.com';

test('the manifest request relays the signed URL with its cookie', async () => {
  const { calls, call, tokenFor } = harness();
  const res = await call([tokenFor()]);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${HOST}/dash/1/index.mpd`);
  assert.deepEqual(calls[0].headers, [['Cookie', 'CloudFront-Policy=abc'], ['Referer', 'https://sportslive.wine']]);
  assert.equal(res.headers.get('content-type'), 'application/dash+xml; charset=utf-8');
  const body = await res.text();
  assert.ok(body.includes(`<BaseURL>https://site.test/api/media/vault-stream/${tokenFor()}/</BaseURL>`), body);
});

test('a trailing segment path resolves against the manifest directory', async () => {
  const { calls, call, tokenFor } = harness();
  const res = await call([tokenFor(), '1_video_1.m4s']);
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, `${HOST}/dash/1/1_video_1.m4s`);
  assert.equal(await res.text(), 'segment-bytes');
  assert.equal(res.headers.get('content-type'), 'video/mp4');
});

test('a multi-level segment path keeps every folder below the token', async () => {
  const { calls, call, tokenFor } = harness();
  await call([tokenFor(), 'video', '1080', 'chunk-00001.m4s']);
  assert.equal(calls[0].url, `${HOST}/dash/1/video/1080/chunk-00001.m4s`);
});

test('the query string a player carries onto a segment is dropped', async () => {
  const { calls, call, tokenFor } = harness();
  await call([tokenFor(), '1_init.mp4?token=stale&x=1']);
  assert.equal(calls[0].url, `${HOST}/dash/1/1_init.mp4`);
});

test('the byte range of a segment request is forwarded upstream', async () => {
  const { calls, call, tokenFor } = harness();
  await call([tokenFor(), '1_video_1.m4s'], { range: 'bytes=0-1023' });
  assert.equal(calls[0].range, 'bytes=0-1023');
});

test('a traversal or absolute segment is refused before any upstream call', async () => {
  const { calls, call, tokenFor } = harness();
  for (const segment of ['..', 'a/../../secret.m4s', 'https://evil.test/x.m4s']) {
    const res = await call([tokenFor(), segment]);
    assert.equal(res.status, 400, segment);
    assert.equal((await res.json()).code, 'malformed_url', segment);
  }
  assert.equal(calls.length, 0, 'nothing reaches the CDN');
});

test('a missing or tampered token is refused', async () => {
  const { calls, call } = harness();
  const empty = await call([]);
  assert.equal(empty.status, 400);
  assert.equal((await empty.json()).code, 'malformed_url');

  const tampered = await call(['not-a-real-token']);
  assert.equal(tampered.status, 400);
  assert.equal((await tampered.json()).code, 'malformed_url');

  const insecure = await call([Buffer.from('{"u":"http://sbcdn3.hakunaymatata.com/dash/1/index.mpd"}').toString('base64url')]);
  assert.equal(insecure.status, 400, 'http upstreams are not relayable');
  assert.equal(calls.length, 0);
});

test('a cross-site hotlink is refused without decoding or fetching', async () => {
  const { calls, call, tokenFor } = harness();
  const res = await call([tokenFor(), '1_video_1.m4s'], { site: 'cross-site' });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).code, 'disallowed_host');
  assert.equal(calls.length, 0);
});

test('a manifest already carrying a BaseURL has it rewritten to the relay', async () => {
  const { call, tokenFor } = harness({
    manifest: '<MPD><BaseURL>https://cdn.example.com/dash/1/</BaseURL><Period /></MPD>',
  });
  const res = await call([tokenFor()]);
  const body = await res.text();
  assert.ok(body.includes(`<BaseURL>https://site.test/api/media/vault-stream/${tokenFor()}/</BaseURL>`), body);
  assert.ok(!body.includes('cdn.example.com'), 'the upstream base must not survive');
});

test('the handler answers HEAD through the same path', async () => {
  const { calls, request, tokenFor, route } = harness();
  const res = await route.HEAD(request(), { params: Promise.resolve({ path: [tokenFor(), '1_video_1.m4s'] }) });
  assert.equal(res.status, 200);
  assert.equal(calls[0].url, `${HOST}/dash/1/1_video_1.m4s`);
});
