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
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.startsWith('.') && parent && parent.filename) {
      const candidateTs = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidateTs)) {
        return loadTs(candidateTs);
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    compiled._compile(output, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const ProxyUrl = loadTs('../src/lib/media/streamProxyUrl.ts');
const StreamProxy = loadTs('../src/lib/media/streamProxy.ts');
const Resolver = loadTs('../src/lib/media/hubResolver.ts');
const ShakaPlayer = loadTs('../src/lib/media/shakaPlayer.ts');

const PUBLIC_DNS = async () => [{ address: '104.21.58.178', family: 4 }];

test('shouldProxyCrossOriginMediaUrl routes real 4KHDHub mirror CDNs via /api/media/stream and blocks unsafe/Telegram/same-origin URLs', () => {
  const origin = 'https://sidify.vercel.app';

  // Exact production mirror hosts from sidify.vercel.app playback logs
  for (const allowedUrl of [
    'https://87bc29edda9ac0f5591377cf744d9a37.r2.cloudflarestorage.com/hub/Mentalist.S01E01.1080p.DDP5.1.H.264.mkv?X-Amz-Algorithm=AWS4-HMAC-SHA256',
    'https://pixel.hubcloud.ist/?id=21b7868f51fc102b06b54f448fd79c6d63599a24',
    'https://gpdl.hubcloud.ist/?id=7983360fed52794769e8a9c61de5431c',
    'https://pixeldrain.com/api/file/negn6f?download',
    'https://ia800501.us.archive.org/12/items/demo/sample.mp4',
  ]) {
    assert.equal(
      ProxyUrl.shouldProxyCrossOriginMediaUrl(allowedUrl, origin),
      true,
      `Expected ${allowedUrl} to be proxied`,
    );
    const proxied = ProxyUrl.buildMediaStreamProxyUrl(allowedUrl, origin);
    assert.ok(proxied.startsWith('https://sidify.vercel.app/api/media/stream?url='));
    assert.equal(ProxyUrl.unwrapMediaStreamProxyUrl(proxied), allowedUrl);
    // Never double-wrap an already proxied URL
    assert.equal(ProxyUrl.shouldProxyCrossOriginMediaUrl(proxied, origin), false);
  }

  // Rejected / bypassed URLs
  for (const bypassedUrl of [
    'https://sidify.vercel.app/local-video.mp4',
    'blob:https://sidify.vercel.app/abc-123',
    'data:application/vnd.apple.mpegurl;base64,AAAA',
    'https://hubcloud.ist/tg/go?id=a2Rla1poaTRZY2dUWg==',
    'https://t.me/somechannel',
    'http://pub-demo.r2.dev/insecure.mkv',
    'https://127.0.0.1/secret.mkv',
    'https://google.com/not-a-media-cdn.mkv',
  ]) {
    assert.equal(
      ProxyUrl.shouldProxyCrossOriginMediaUrl(bypassedUrl, origin),
      false,
      `Expected ${bypassedUrl} NOT to be proxied`,
    );
  }
});

test('parseGeneratorLinks filters out "Download From Telegram" (/tg/go) links while preserving FSL, 10Gbps, and PixelServer', () => {
  const html = `
    <div class="buttons">
      <a href="https://87bc29edda9ac0f5591377cf744d9a37.r2.cloudflarestorage.com/hub/Ep01.mkv">Download [FSL Server]</a>
      <a href="https://gpdl.hubcloud.ist/?id=7983360fed527947">Download [Server : 10Gbps]</a>
      <a href="https://pixeldrain.com/u/negn6f">Download [PixelServer : 2]</a>
      <a href="https://hubcloud.ist/tg/go?id=a2Rla1poaTRZY2dUWg==">Download From Telegram</a>
      <a href="https://t.me/hubcloud_bot">Join Telegram</a>
    </div>
  `;

  const links = Resolver.parseGeneratorLinks(html, {
    fileName: 'The.Mentalist.S01E01.Pilot.1080p.AMZN.WEB-DL.English.DDP5.1.H.264.mkv',
    label: '1080p WEB-DL',
    baseUrl: 'https://gamerxyt.com/hubcloud.php',
  });

  assert.equal(links.length, 3);
  assert.deepEqual(
    links.map((l) => l.server),
    ['FSL Server', 'Download [Server : 10Gbps]', 'PixelServer'],
  );
  assert.ok(links.every((l) => !/\/tg\/go|telegram/i.test(l.url)));
});

test('proxyMediaStreamRequest streams bounded 206 Partial Content ranges, caps open-ended ranges, and follows validated 302 redirects', async () => {
  const mkvPayload = Buffer.alloc(1024, 0x42);
  mkvPayload.set([0x1a, 0x45, 0xdf, 0xa3], 0);

  const r2Url =
    'https://87bc29edda9ac0f5591377cf744d9a37.r2.cloudflarestorage.com/hub/Episode.DDP5.1.mkv?X-Amz-Signature=deadbeef';
  const redirectorUrl = 'https://gpdl.hubcloud.ist/?id=7983360fed527947';
  const googleCdnUrl = 'https://video-downloads.googleusercontent.com/AGQ3/Episode.DDP5.1.mkv';

  const seenCalls = [];
  const mockFetch = async (url, init) => {
    seenCalls.push({ url, headers: init.headers });
    if (url === redirectorUrl) {
      return new Response(null, {
        status: 302,
        headers: { location: googleCdnUrl },
      });
    }
    if (url === r2Url || url === googleCdnUrl) {
      const range = init.headers.Range;
      const m = /^bytes=(\d+)-(\d+)$/.exec(range || '');
      assert.ok(m, `Expected bounded Range header on upstream, got ${range}`);
      assert.equal(init.headers['Accept-Encoding'], 'identity');
      const start = Number(m[1]);
      const end = Math.min(Number(m[2]), mkvPayload.length - 1);
      const slice = mkvPayload.subarray(start, end + 1);
      return new Response(slice, {
        status: 206,
        headers: {
          'content-type': 'application/octet-stream',
          'content-length': String(slice.byteLength),
          'content-range': `bytes ${start}-${end}/1542389120`,
          'accept-ranges': 'bytes',
          'content-disposition': 'attachment; filename="Episode.DDP5.1.mkv"',
        },
      });
    }
    return new Response('Not Found', { status: 404 });
  };

  // 1. Direct Cloudflare R2 bounded Range request (MatroskaParser header probe)
  const req1 = new Request(
    `https://sidify.vercel.app/api/media/stream?url=${encodeURIComponent(r2Url)}`,
    {
      method: 'GET',
      headers: { Range: 'bytes=0-63' },
    },
  );
  const res1 = await StreamProxy.proxyMediaStreamRequest(req1, {
    fetchImpl: mockFetch,
    dnsLookup: PUBLIC_DNS,
  });

  assert.equal(res1.status, 206);
  assert.equal(res1.headers.get('content-range'), 'bytes 0-63/1542389120');
  assert.equal(res1.headers.get('accept-ranges'), 'bytes');
  assert.equal(res1.headers.get('content-type'), 'video/x-matroska');
  assert.equal(res1.headers.get('content-disposition'), null, 'Strips attachment header');
  assert.equal(res1.headers.get('x-sidify-final-url'), r2Url);
  const body1 = new Uint8Array(await res1.arrayBuffer());
  assert.equal(body1.byteLength, 64);
  assert.deepEqual(Array.from(body1.subarray(0, 4)), [0x1a, 0x45, 0xdf, 0xa3]);

  // 2. 302 redirector (`gpdl.hubcloud.ist` -> `video-downloads.googleusercontent.com`) preserves Range
  const req2 = new Request(
    `https://sidify.vercel.app/api/media/stream?url=${encodeURIComponent(redirectorUrl)}`,
    {
      method: 'GET',
      headers: { Range: 'bytes=0-127' },
    },
  );
  const res2 = await StreamProxy.proxyMediaStreamRequest(req2, {
    fetchImpl: mockFetch,
    dnsLookup: PUBLIC_DNS,
  });
  assert.equal(res2.status, 206);
  assert.equal(res2.headers.get('x-sidify-final-url'), googleCdnUrl);
  assert.equal((await res2.arrayBuffer()).byteLength, 128);

  // 3. Open-ended Range (`bytes=0-`) is capped to OPEN_ENDED_CHUNK_BYTES (4 MiB)
  const norm = StreamProxy.normalizeStreamRangeHeader('bytes=0-');
  assert.equal(norm.invalid, false);
  assert.equal(norm.upstreamRange, `bytes=0-${StreamProxy.OPEN_ENDED_CHUNK_BYTES - 1}`);
});

test('proxyMediaStreamRequest enforces SSRF, host allowlist, cross-site hotlink block, and non-HTML response guard', async () => {
  // 1. Disallowed arbitrary host blocked before fetch
  const rDisallowed = await StreamProxy.proxyMediaStreamRequest(
    new Request('https://sidify.vercel.app/api/media/stream?url=' + encodeURIComponent('https://example.com/movie.mkv')),
    {
      dnsLookup: PUBLIC_DNS,
      fetchImpl: async () => assert.fail('Must not fetch disallowed host'),
    },
  );
  assert.equal(rDisallowed.status, 403);

  // 2. Private / cloud-metadata IP blocked on DNS resolution (including on redirect hop!)
  const rMetadata = await StreamProxy.proxyMediaStreamRequest(
    new Request(
      'https://sidify.vercel.app/api/media/stream?url=' +
        encodeURIComponent('https://gpdl.hubcloud.ist/?id=rebind'),
    ),
    {
      dnsLookup: async (host) =>
        host === 'gpdl.hubcloud.ist'
          ? [{ address: '104.21.58.178', family: 4 }]
          : [{ address: '169.254.169.254', family: 4 }],
      fetchImpl: async (url) => {
        if (url.startsWith('https://gpdl.hubcloud.ist')) {
          return new Response(null, {
            status: 302,
            headers: { location: 'https://evil-cdn.net/internal' },
          });
        }
        assert.fail('Must not connect to metadata IP redirect target');
      },
    },
  );
  assert.equal(rMetadata.status, 403);

  // 3. Cross-site hotlinking blocked
  const rCrossSite = await StreamProxy.proxyMediaStreamRequest(
    new Request(
      'https://sidify.vercel.app/api/media/stream?url=' +
        encodeURIComponent('https://pixeldrain.com/api/file/abc'),
      { headers: { 'sec-fetch-site': 'cross-site' } },
    ),
    { dnsLookup: PUBLIC_DNS },
  );
  assert.equal(rCrossSite.status, 403);

  // 4. Upstream HTML landing page blocked with 415
  const rHtml = await StreamProxy.proxyMediaStreamRequest(
    new Request(
      'https://sidify.vercel.app/api/media/stream?url=' +
        encodeURIComponent('https://pixel.hubcloud.ist/?id=deadlink'),
    ),
    {
      dnsLookup: PUBLIC_DNS,
      fetchImpl: async () =>
        new Response('<!doctype html><html><body>File expired</body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
    },
  );
  assert.equal(rHtml.status, 415);
});

test('installPlayerCrossOriginProxy rewrites Shaka NetworkingEngine requests, restores response.uri, and caches 302 final CDN URLs', async () => {
  let reqFilter = null;
  let resFilter = null;

  const mockPlayer = {
    getNetworkingEngine() {
      return {
        registerRequestFilter(fn) {
          reqFilter = fn;
        },
        unregisterRequestFilter(fn) {
          if (reqFilter === fn) reqFilter = null;
        },
        registerResponseFilter(fn) {
          resFilter = fn;
        },
        unregisterResponseFilter(fn) {
          if (resFilter === fn) resFilter = null;
        },
      };
    },
  };

  const cleanup = ShakaPlayer.installPlayerCrossOriginProxy(
    mockPlayer,
    'https://sidify.vercel.app',
  );
  assert.equal(typeof reqFilter, 'function');
  assert.equal(typeof resFilter, 'function');

  const redirectorUri = 'https://gpdl.hubcloud.ist/?id=mentalist-s01e01';
  const finalR2Uri =
    'https://87bc29edda9ac0f5591377cf744d9a37.r2.cloudflarestorage.com/hub/Mentalist.S01E01.mkv';

  // Segment 1: rewritten to /api/media/stream?url=<redirectorUri>
  const req1 = { uris: [redirectorUri], method: 'GET', headers: { Range: 'bytes=0-65535' }, allowCrossSiteCredentials: false };
  reqFilter(1, req1);
  assert.equal(
    req1.uris[0],
    `https://sidify.vercel.app/api/media/stream?url=${encodeURIComponent(redirectorUri)}`,
  );

  // Response 1: restores response.uri to finalR2Uri and caches redirectorUri -> finalR2Uri
  const res1 = {
    uri: req1.uris[0],
    originalUri: req1.uris[0],
    data: new Uint8Array(64),
    headers: { 'x-sidify-final-url': finalR2Uri },
  };
  resFilter(1, res1);
  assert.equal(res1.uri, finalR2Uri);

  // Segment 2: skips redirectorUri and proxies straight to finalR2Uri!
  const req2 = { uris: [redirectorUri], method: 'GET', headers: { Range: 'bytes=65536-131071' }, allowCrossSiteCredentials: false };
  reqFilter(1, req2);
  assert.equal(
    req2.uris[0],
    `https://sidify.vercel.app/api/media/stream?url=${encodeURIComponent(finalR2Uri)}`,
  );

  cleanup();
  assert.equal(reqFilter, null);
  assert.equal(resFilter, null);
});
