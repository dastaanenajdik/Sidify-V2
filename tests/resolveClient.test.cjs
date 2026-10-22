const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

/**
 * Regression: Download and Try Play (beta) both failed on the Vercel preview. The browser
 * resolve call used `credentials: "omit"`, so the deployment's protection cookie never went
 * with it and Vercel answered 401 before the route ran. Also covers what the UI does with
 * the resolve contract (landing pages, non-JSON answers) and how HLS failures are classified.
 */
const moduleCache = new Map();

function loadTs(targetPath) {
  const filename = path.resolve(__dirname, targetPath);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;

  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  moduleCache.set(filename, compiled);

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.startsWith('.') && parent && parent.filename) {
      const candidateTs = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidateTs)) return loadTs(candidateTs);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    compiled._compile(output, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const Client = loadTs('../src/lib/media/client.ts');
const Diag = loadTs('../src/lib/media/diagnostics.ts');
const Plan = loadTs('../src/lib/media/playbackPlan.ts');
const HlsPlayer = loadTs('../src/lib/media/hlsPlayer.ts');

const originalFetch = global.fetch;
const originalWarn = console.warn;
afterEach(() => {
  global.fetch = originalFetch;
  console.warn = originalWarn;
});

function captureWarnings() {
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  return warnings;
}

const MIRROR = 'https://greenmotors.club/?id=mv-720-hc';
const RESOLVED = {
  status: 'resolved',
  links: [{ server: 'FSL Server', url: 'https://cdn.example.net/Movie.720p.mkv', playable: false, delivery: 'download', container: 'MKV' }],
  externalFallbackUrl: 'https://hubcloud.one/drive/mv-720',
  hops: [{ step: 'shortlink', host: 'greenmotors.club', status: 'ok' }],
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/* ----------------------- the preview regression itself ---------------------- */

test('resolveMirror sends same-origin cookies, so a Vercel-protected preview lets the call reach /api/media/resolve', async () => {
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return jsonResponse(RESOLVED);
  };
  const controller = new AbortController();

  const result = await Client.mediaApi.resolveMirror({
    url: MIRROR,
    fileName: 'Movie.720p.mkv',
    label: 'Movie (720p)',
    signal: controller.signal,
  });

  assert.equal(result.status, 'resolved');
  assert.equal(result.links[0].url, 'https://cdn.example.net/Movie.720p.mkv', 'resolved URL is passed through untouched');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/media/resolve', 'relative path → same origin as the page');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(
    calls[0].init.credentials,
    'same-origin',
    '"omit" drops the _vercel_jwt cookie and Vercel answers 401 before the route runs'
  );
  assert.equal(calls[0].init.signal, controller.signal);
  assert.deepEqual(
    JSON.parse(calls[0].init.body),
    { url: MIRROR, fileName: 'Movie.720p.mkv', label: 'Movie (720p)' },
    'same request body as the old release cards (no signal, no refresh unless asked)'
  );
});

test('a 401 HTML page answering instead of the route (deployment protection) → non_json_response + console diagnostic', async () => {
  global.fetch = async () =>
    new Response('<!doctype html><title>Authentication Required</title><p>Vercel Authentication</p>', {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  const warnings = captureWarnings();

  await assert.rejects(Client.mediaApi.resolveMirror({ url: MIRROR }), (err) => {
    assert.ok(err instanceof Client.MediaApiError);
    assert.equal(err.status, 401);
    assert.equal(err.code, 'non_json_response');
    assert.doesNotMatch(err.message, /doctype|html|Vercel/i, 'the HTML body is never surfaced');
    return true;
  });

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0][0], `${Diag.DIAGNOSTIC_PREFIX} resolve API did not return a result`);
  const details = warnings[0][1];
  assert.equal(details.httpStatus, 401);
  assert.equal(details.contentType, 'text/html');
  assert.equal(details.code, 'non_json_response');
  assert.match(details.hint, /Deployment Protection/);
});

test('resolver outcomes come back as data whatever the HTTP status; route errors keep their code', async () => {
  global.fetch = async () => jsonResponse({ status: 'blocked', links: [], reason: 'captcha', hops: [{ step: 'validate' }] }, 403);
  const blocked = await Client.mediaApi.resolveMirror({ url: MIRROR });
  assert.equal(blocked.status, 'blocked', 'a CAPTCHA mirror is a result for the UI to skip, not an exception');

  global.fetch = async () => jsonResponse({ error: 'Missing mirror URL.', code: 'invalid_input' }, 400);
  const warnings = captureWarnings();
  await assert.rejects(Client.mediaApi.resolveMirror({ url: '' }), (err) => {
    assert.equal(err.status, 400);
    assert.equal(err.code, 'invalid_input');
    return true;
  });
  assert.equal(warnings[0][1].httpStatus, 400);
  assert.equal(warnings[0][1].hint, undefined, 'JSON from our own route is not mistaken for an auth wall');
});

test('network failure → MediaApiError("network"); an aborted request rethrows AbortError untouched', async () => {
  global.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  const warnings = captureWarnings();
  await assert.rejects(Client.mediaApi.resolveMirror({ url: MIRROR }), (err) => {
    assert.ok(err instanceof Client.MediaApiError);
    assert.equal(err.code, 'network');
    assert.equal(err.status, 0);
    return true;
  });
  assert.equal(warnings[0][1].error, 'TypeError');

  const controller = new AbortController();
  controller.abort();
  global.fetch = async () => {
    throw new DOMException('The operation was aborted.', 'AbortError');
  };
  const before = warnings.length;
  await assert.rejects(Client.mediaApi.resolveMirror({ url: MIRROR, signal: controller.signal }), (err) => err.name === 'AbortError');
  assert.equal(warnings.length, before, 'closing the popup is not reported as a failure');
});

/* ------------------------- what the download popup offers ------------------------- */

test('a partial resolution (host page only) offers that page — the old cards showed it as "Open"', () => {
  const partial = {
    status: 'partial',
    links: [{ server: 'HubCloud Page', url: 'https://hubcloud.one/drive/mv-720', playable: false, delivery: 'external', container: 'PAGE' }],
    externalFallbackUrl: 'https://hubcloud.one/drive/mv-720',
    hops: [],
  };
  assert.equal(Plan.downloadLinks(partial.links).length, 0, 'not a direct file link');
  assert.equal(Plan.landingPageUrl(partial), 'https://hubcloud.one/drive/mv-720');

  assert.equal(Plan.landingPageUrl(RESOLVED), undefined, 'direct links win; no landing page needed');
  assert.equal(Plan.landingPageUrl({ status: 'blocked', links: [], hops: [] }), undefined);
  assert.equal(Plan.landingPageUrl({ links: [{ delivery: 'external', url: 'http://insecure.example/x' }] }), undefined);
  assert.equal(Plan.landingPageUrl(null), undefined);
});

test('download links keep the exact resolved URL (PixelDrain ?download is only stripped for inline playback)', () => {
  const links = [
    { server: 'FSL Server', url: 'https://cdn.example.net/a.mkv?token=abc', playable: false, delivery: 'download', container: 'MKV' },
    { server: 'PixelServer', url: 'https://pixeldrain.com/api/file/XYZ?download', playable: false, delivery: 'download', container: 'MKV' },
  ];
  assert.deepEqual(
    Plan.downloadLinks(links).map((l) => l.url),
    ['https://cdn.example.net/a.mkv?token=abc', 'https://pixeldrain.com/api/file/XYZ?download']
  );
  assert.equal(Plan.streamCandidates(links).find((c) => c.server === 'PixelServer').url, 'https://pixeldrain.com/api/file/XYZ');
  assert.equal(Plan.streamCandidates(links).find((c) => c.server === 'PixelServer').sourceUrl, 'https://pixeldrain.com/api/file/XYZ?download');
});

/* ------------------------------ HLS classification ----------------------------- */

function makeVideo() {
  return {
    src: '',
    canPlayType: () => '',
    pause() {},
    removeAttribute() {},
    load() {},
  };
}

function makeHls() {
  const state = { listener: null };
  class MockHls {
    static isSupported() {
      return true;
    }
    loadSource() {}
    attachMedia() {}
    on(event, fn) {
      if (event === MockHls.Events.ERROR) state.listener = fn;
    }
    startLoad() {}
    recoverMediaError() {}
    destroy() {}
  }
  MockHls.Events = { ERROR: 'hlsError' };
  MockHls.ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
  return { MockHls, state };
}

test('HLS: a fatal decode error is file-level ("decode"), never assumed to be a network failure', async () => {
  const { MockHls, state } = makeHls();
  const fatal = [];
  await HlsPlayer.attachPlaybackSource({
    video: makeVideo(),
    source: { url: 'https://cdn.example.net/master.m3u8', type: 'hls' },
    loadHlsModule: async () => ({ default: MockHls }),
    onFatalError: (reason, info) => fatal.push({ reason, info }),
  });
  state.listener('hlsError', { type: 'mediaError', fatal: true, details: 'bufferAppendError' });
  assert.equal(fatal.length, 0, 'first media error gets one recovery attempt');
  state.listener('hlsError', { type: 'mediaError', fatal: true, details: 'bufferAppendError' });
  assert.equal(fatal.length, 1);
  assert.deepEqual(fatal[0].info, { kind: 'media', details: 'bufferAppendError', httpStatus: undefined });
  assert.equal(Plan.classifyHlsFatal(fatal[0].info.kind), 'decode');
  assert.equal(Plan.isFileLevelFailure(Plan.classifyHlsFatal(fatal[0].info.kind)), true);
});

test('HLS: manifest/segment request failures stay network-level and carry the HTTP status', async () => {
  const { MockHls, state } = makeHls();
  const fatal = [];
  await HlsPlayer.attachPlaybackSource({
    video: makeVideo(),
    source: { url: 'https://cdn.example.net/master.m3u8', type: 'hls' },
    loadHlsModule: async () => ({ default: MockHls }),
    onFatalError: (reason, info) => fatal.push({ reason, info }),
  });
  state.listener('hlsError', { type: 'networkError', fatal: true, details: 'manifestLoadError', response: { code: 403 } });
  state.listener('hlsError', { type: 'networkError', fatal: true, details: 'manifestLoadError', response: { code: 403 } });
  assert.deepEqual(fatal[0].info, { kind: 'network', details: 'manifestLoadError', httpStatus: 403 });
  assert.equal(Plan.classifyHlsFatal('network'), 'network');
  assert.equal(Plan.classifyHlsFatal(undefined), 'network');

  const unsupported = [];
  await HlsPlayer.attachPlaybackSource({
    video: makeVideo(),
    source: { url: 'https://cdn.example.net/master.m3u8', type: 'hls' },
    loadHlsModule: async () => ({ default: Object.assign(function NoMse() {}, { isSupported: () => false, Events: MockHls.Events, ErrorTypes: MockHls.ErrorTypes }) }),
    onFatalError: (reason, info) => unsupported.push(info),
  });
  assert.deepEqual(unsupported, [{ kind: 'unsupported' }]);
  assert.equal(Plan.classifyHlsFatal('unsupported'), 'decode', 'no HLS support here → other servers of the same stream fail too');
});

/* --------------------------------- diagnostics --------------------------------- */

test('diagnostics never log query strings (resolved links carry signed tokens)', () => {
  assert.equal(
    Diag.redactUrl('https://pub-abc.r2.dev/bucket/Movie.2026.1080p.mkv?X-Amz-Signature=secret&X-Amz-Credential=key'),
    'pub-abc.r2.dev/…/Movie.2026.1080p.mkv'
  );
  assert.equal(Diag.redactUrl('https://pixeldrain.com/api/file/AbC123?download'), 'pixeldrain.com/…/AbC123');
  assert.equal(Diag.redactUrl('https://greenmotors.club/?id=mv-720-hc'), 'greenmotors.club');
  assert.equal(Diag.redactUrl('https://cdn.example.net/x.mkv#t=10'), 'cdn.example.net/x.mkv');
  assert.equal(Diag.redactUrl('not a url'), '');
  assert.equal(Diag.redactUrl(undefined), '');

  const warnings = captureWarnings();
  Diag.reportMediaDiagnostic('Try Play: link did not play', { failure: 'decode', mediaErrorCode: 4, hlsErrorKind: undefined });
  assert.deepEqual(warnings[0], ['[Sidify media] Try Play: link did not play', { failure: 'decode', mediaErrorCode: 4 }]);
});
