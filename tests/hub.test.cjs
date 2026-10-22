const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

/**
 * Compile and load TypeScript modules directly in Node's test runner, wiring relative
 * `.ts` imports cleanly without executing a dev server.
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

const SafeFetch = loadTs('../src/lib/media/safeFetch.ts');
const Scraper = loadTs('../src/lib/media/hubScraper.ts');
const Resolver = loadTs('../src/lib/media/hubResolver.ts');
const HlsPlayer = loadTs('../src/lib/media/hlsPlayer.ts');
const ProviderMod = loadTs('../src/lib/media/hubProvider.ts');
const ServiceMod = loadTs('../src/lib/media/service.ts');

const PUBLIC_DNS = async () => [{ address: '104.21.58.178', family: 4 }];

function htmlResponse(body, init = {}) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      ...(init.headers || {}),
    },
  });
}

/* --------------------- 1. URL Normalization & Slugs ---------------------- */

test('normalizeHubPageUrl handles root-relative, path-relative, protocol-relative and rejects unsafe schemes/hosts', () => {
  assert.equal(
    Scraper.normalizeHubPageUrl('/moana-movie-8014/', 'https://4khdhub.one'),
    'https://4khdhub.one/moana-movie-8014/'
  );
  // Path-relative without leading slash (bug in raw string concatenation `${BASE_URL}${rawHref}`)
  assert.equal(
    Scraper.normalizeHubPageUrl('moana-movie-8014/', 'https://4khdhub.one'),
    'https://4khdhub.one/moana-movie-8014/'
  );
  // Protocol-relative URL
  assert.equal(
    Scraper.normalizeHubPageUrl('//4khdhub.one/inception-movie-509/#comments', 'https://4khdhub.one'),
    'https://4khdhub.one/inception-movie-509/'
  );
  // Rejects non-HTTPS, XSS schemes, non-catalogue hosts
  assert.equal(Scraper.normalizeHubPageUrl('http://4khdhub.one/moana-movie-8014/', 'https://4khdhub.one'), null);
  assert.equal(Scraper.normalizeHubPageUrl('javascript:alert(1)', 'https://4khdhub.one'), null);
  assert.equal(Scraper.normalizeHubPageUrl('https://evil.example.com/moana-movie-8014/', 'https://4khdhub.one'), null);
});

test('hub slugs prevent path traversal and round-trip cleanly', () => {
  assert.equal(Scraper.pathToHubSlug('https://4khdhub.one/moana-movie-8014/'), 'hub-moana-movie-8014');
  assert.equal(Scraper.pathToHubSlug('https://4khdhub.one/category/movies/'), null, 'category paths are not item slugs');
  assert.equal(Scraper.hubSlugSegment('hub-moana-movie-8014'), 'moana-movie-8014');
  assert.equal(Scraper.hubSlugSegment('moana-movie-8014'), 'moana-movie-8014');
  assert.equal(Scraper.hubSlugSegment('hub-../../etc/passwd'), null);
  assert.equal(Scraper.hubSlugSegment('hub-a/b'), null);
  assert.equal(
    Scraper.hubDetailUrlFromSlug('hub-moana-movie-8014', 'https://4khdhub.one'),
    'https://4khdhub.one/moana-movie-8014/'
  );
});

test('buildHubListUrl constructs search, category and multi-page URLs cleanly', () => {
  assert.equal(Scraper.buildHubListUrl('movie', {}, 'https://4khdhub.one'), 'https://4khdhub.one/category/movies/');
  assert.equal(Scraper.buildHubListUrl('movie', { page: 3 }, 'https://4khdhub.one'), 'https://4khdhub.one/category/movies/page/3/');
  assert.equal(Scraper.buildHubListUrl('series', { genre: 'crime', page: 2 }, 'https://4khdhub.one'), 'https://4khdhub.one/category/crime/page/2/');
  assert.equal(Scraper.buildHubListUrl('all', { q: 'john wick' }, 'https://4khdhub.one'), 'https://4khdhub.one/?s=john%20wick');
  assert.equal(Scraper.buildHubListUrl('all', { q: 'john wick', page: 2 }, 'https://4khdhub.one'), 'https://4khdhub.one/page/2/?s=john%20wick');
});

/* ---------------- 2. Search / Detail / Episode HTML Fixtures ------------- */

const SEARCH_FIXTURE = `
<!doctype html>
<html>
<body>
  <script>window.__UNTRUSTED__ = "never execute";</script>
  <div class="movies-grid">
    <a href="moana-movie-8014/" class="movie-card">
      <div class="poster">
        <img src="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" data-src="https://image.tmdb.org/t/p/w500/zKVgiv5qHCvCLT4A2ymJi5QeXDH.jpg" alt="Moana" />
      </div>
      <div class="badges">
        <span class="movie-card-format">Movies</span>
        <span class="badge">2160p</span>
        <span class="badge">Adventure</span>
        <span class="badge">Hindi</span>
        <span class="badge">English</span>
      </div>
      <h3 class="movie-card-title">Moana</h3>
      <p class="movie-card-meta">2026</p>
    </a>

    <a href="/marvels-the-punisher-series-2288/" class="movie-card">
      <img data-lazy-src="https://catimages.org/images/2026/10/07/poster_dfb2cf9b_labeled.jpg" src="/blank.gif" alt="Punisher" />
      <span class="movie-card-format">Series</span>
      <span class="badge">Crime</span>
      <span class="badge">Drama</span>
      <h3 class="movie-card-title">Marvel's The Punisher</h3>
      <p class="movie-card-meta">2017 • S01-S02 EP07</p>
    </a>

    <a href="javascript:alert(1)" class="movie-card">
      <h3 class="movie-card-title">Malicious Card</h3>
    </a>
  </div>

  <nav class="pagination">
    <span class="page-numbers current">1</span>
    <a class="page-numbers" href="https://4khdhub.one/page/2/">2</a>
    <a class="page-numbers" href="https://4khdhub.one/page/403/">403</a>
  </nav>
</body>
</html>
`;

test('parseHubSearchHtml handles relative hrefs, lazy-loaded posters, series detection, XSS stripping and pagination', () => {
  const parsed = Scraper.parseHubSearchHtml(SEARCH_FIXTURE, 'https://4khdhub.one');
  assert.equal(parsed.totalPages, 403);
  assert.equal(parsed.items.length, 2, 'malicious card is dropped');

  const movie = parsed.items[0];
  assert.equal(movie.slug, 'hub-moana-movie-8014');
  assert.equal(movie.kind, 'movie');
  assert.equal(movie.title, 'Moana');
  assert.equal(movie.year, 2026);
  assert.equal(movie.poster, 'https://image.tmdb.org/t/p/w500/zKVgiv5qHCvCLT4A2ymJi5QeXDH.jpg');
  assert.equal(movie.language, 'hi');
  assert.ok(movie.genres.some((g) => g.id === 'adventure'));

  const series = parsed.items[1];
  assert.equal(series.slug, 'hub-marvels-the-punisher-series-2288');
  assert.equal(series.kind, 'series');
  assert.equal(series.year, 2017);
  assert.equal(series.poster, 'https://catimages.org/images/2026/10/07/poster_dfb2cf9b_labeled.jpg');
});

const MOVIE_DETAIL_FIXTURE = `
<!doctype html>
<html>
<head>
  <meta property="og:image" content="https://image.tmdb.org/t/p/w780/zKVgiv5qHCvCLT4A2ymJi5QeXDH.jpg" />
</head>
<body>
  <h1>Moana (2026)</h1>
  <div>IMDb 5.8 · 1h 55m</div>
  <div class="categories">
    <a href="https://4khdhub.one/category/family/">Family</a>
    <a href="https://4khdhub.one/category/adventure/">Adventure</a>
    <a href="https://4khdhub.one/category/hindi/">Hindi</a>
    <a href="https://4khdhub.one/category/english/">English</a>
  </div>
  <p>Teenage Moana answers the Ocean's call and voyages beyond the reef of Motunui to restore prosperity to her people.</p>
  <div>Release: 2026-07-08</div>

  <div class="download-item">
    <div class="font-semibold">Moana (2160p BluRay REMUX DV HDR10P H265)<br/></div>
    <div class="file-title">Moana (2026) Hybrid 2160p UHD BluRay REMUX DV HDR10P HEVC x265.mkv</div>
    <code><span class="badge">42.49 GB</span></code>
    <a href="https://greenmotors.club/?id=token_hc_1">Download HubCloud</a>
    <a href="https://greenmotors.club/?id=token_hd_1">Download HubDrive</a>
    <a href="https://evil-ad-tracker.example.com/click">Fake Ad Button</a>
  </div>

  <div class="download-item">
    <div class="font-semibold">Moana (1080p Web Stream MP4)</div>
    <div class="file-title">Moana.2026.1080p.WEB-DL.H264.mp4</div>
    <span>2.45 GB</span>
    <a href="https://greenmotors.club/?id=token_mp4_1">Download HubCloud</a>
  </div>

  <section class="related">
    <a href="/masterplan-movie-8359/" class="movie-card">
      <img src="https://image.tmdb.org/t/p/w500/5xmXVd7nCK3tAo34XkO58SxUCip.jpg" />
      <h3 class="movie-card-title">Masterplan</h3>
      <p class="movie-card-meta">2026</p>
    </a>
  </section>
</body>
</html>
`;

test('parseHubDetailHtml parses movie metadata, cleans year from h1, validates mirrors and extracts related cards', () => {
  const detail = Scraper.parseHubDetailHtml(
    MOVIE_DETAIL_FIXTURE,
    'https://4khdhub.one/moana-movie-8014/',
    'https://4khdhub.one'
  );
  assert.ok(detail);
  assert.equal(detail.title.title, 'Moana');
  assert.equal(detail.title.year, 2026);
  assert.equal(detail.title.releaseDate, '2026-07-08');
  assert.equal(detail.title.rating, 5.8);
  assert.equal(detail.title.runtimeMinutes, 115);
  assert.deepEqual(detail.title.genres.map((g) => g.id), ['family', 'adventure']);
  assert.equal(detail.releases.length, 2);

  assert.equal(detail.releases[0].quality, '2160p');
  assert.equal(detail.releases[0].container, 'MKV');
  assert.equal(detail.releases[0].size, '42.49 GB');
  assert.equal(detail.releases[0].mirrors.length, 2, 'non-allowlisted ad domain was stripped');
  assert.equal(detail.releases[1].container, 'MP4');
  assert.equal(detail.related.length, 1);
  assert.equal(detail.related[0].slug, 'hub-masterplan-movie-8359');
});

const SERIES_DETAIL_FIXTURE = `
<!doctype html>
<html>
<body>
  <h1>Marvel's The Punisher</h1>
  <div>IMDb8.4</div>
  <div>Last Air:2019-01-18</div>
  <p>A former Marine out to punish the criminals responsible for his family's murder uncovers a deep conspiracy.</p>

  <!-- Season ZIP pack -->
  <div class="download-item">
    <div class="font-semibold">Marvel's The Punisher S01 (1080p H.264)</div>
    <div class="file-title">Marvels The Punisher S01 1080p WEB-DL x264.zip</div>
    <span>39.9 GB</span>
    <a href="https://greenmotors.club/?id=s01_zip">Download HubCloud</a>
  </div>

  <!-- Live .episode-item structure -->
  <div id="episodes">
    <div class="episode-item">
      <span class="episode-number">S02</span>
      <h3 class="episode-title">Marvel's The Punisher S02 (2160p DV HDR H.265)</h3>
      <div class="episode-download-item">
        <div class="episode-file-title">Marvels The Punisher S02E01 2160p NF WEB-DL HEVC.mkv</div>
        <span class="badge-psa">Episode-01</span>
        <span class="badge-size">6.53 GB</span>
        <div class="episode-links">
          <a href="https://greenmotors.club/?id=s02e01_4k">Download HubCloud</a>
        </div>
      </div>
    </div>

    <!-- Legacy .season-item structure -->
    <div class="season-item">
      <div class="episode-title">Season 2 (1080p x264)</div>
      <div class="episode-download-item">
        <div class="episode-file-title">Marvels The Punisher S02E01 1080p NF WEB-DL x264.mkv</div>
        <span class="badge-psa">Episode-01</span>
        <span class="badge-size">1.95 GB</span>
        <div class="episode-links">
          <a href="https://greenmotors.club/?id=s02e01_1080">Download HubDrive</a>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`;

test('parseHubDetailHtml supports both live .episode-item and .season-item series selectors and groups multi-quality episodes', () => {
  const detail = Scraper.parseHubDetailHtml(
    SERIES_DETAIL_FIXTURE,
    'https://4khdhub.one/marvels-the-punisher-series-2288/',
    'https://4khdhub.one'
  );
  assert.ok(detail);
  assert.equal(detail.title.kind, 'series');
  assert.equal(detail.releases.length, 1);
  assert.equal(detail.releases[0].isPack, true);
  assert.equal(detail.releases[0].container, 'ZIP');

  assert.equal(detail.seasons.length, 1);
  assert.equal(detail.seasons[0].seasonNumber, 2);
  assert.equal(detail.title.seasonCount, 2, 'S01 (offered only as a ZIP pack) still counts as a season');
  assert.equal(detail.seasons[0].episodes.length, 1);
  assert.equal(detail.seasons[0].episodes[0].releases.length, 2, 'merged 2160p and 1080p releases onto S02E01');
});

test('malformed or empty HTML returns safe empty results instead of throwing', () => {
  assert.deepEqual(Scraper.parseHubSearchHtml('', 'https://4khdhub.one'), { items: [], totalPages: 1 });
  assert.deepEqual(Scraper.parseHubSearchHtml('<div><a class="movie-card">broken', 'https://4khdhub.one'), {
    items: [],
    totalPages: 1,
  });
  assert.equal(Scraper.parseHubDetailHtml('<html><body><div>No heading</div></body></html>', 'https://4khdhub.one/x-movie-1/'), null);
});

/* ----------- 3. Encoding Inspection & Multi-Hop Mirror Resolver ---------- */

test('rot13 and decodeRedirectHtml inspect s("o", ...) tokens accurately without script execution', () => {
  assert.equal(Resolver.rot13(Resolver.rot13('HubCloud2026!')), 'HubCloud2026!');

  const expected = 'https://hubdrive.space/file/abc12345';
  const token = Resolver.encodeRedirectTokenForTest(expected);
  const html = `<html><head><title>Redirecting ...</title><script>s('o', '${token}', 180);</script></head><body>Redirecting ..</body></html>`;
  assert.equal(Resolver.decodeRedirectHtml(html), expected);

  // Corrupt base64 / invalid schemes never throw and never emit unsafe URLs
  assert.equal(Resolver.decodeRedirectHtml(`<script>s('o', 'not-valid-base64!!!')</script>`), null);
  const badScheme = Resolver.encodeRedirectTokenForTest('javascript:alert(1)');
  assert.equal(Resolver.decodeRedirectHtml(`<script>s("o", "${badScheme}")</script>`), null);
});

test('resolveHubMirror resolves full 4-hop chain and NEVER falsely claims .mkv on PixelDrain is browser-playable', async () => {
  Resolver.clearMirrorResolveCache();
  const hubDriveUrl = 'https://hubdrive.space/file/hd99';
  const hubCloudUrl = 'https://hubcloud.one/drive/hc99';
  const generatorUrl = 'https://gamerxyt.com/hubcloud.php?host=hubcloud&id=hc99';
  const encodedToken = Resolver.encodeRedirectTokenForTest(hubDriveUrl);

  const mockFetch = async (url) => {
    if (url === 'https://greenmotors.club/?id=test1') {
      return new Response('', {
        status: 302,
        headers: { location: 'https://greenmotors.cc/?id=test1' },
      });
    }
    if (url === 'https://greenmotors.cc/?id=test1') {
      return htmlResponse(`<script>s('o', '${encodedToken}')</script>`);
    }
    if (url === hubDriveUrl) {
      return htmlResponse(`<a href="${hubCloudUrl}">Generate HubCloud Link</a>`);
    }
    if (url === hubCloudUrl) {
      return htmlResponse(`<script>var url = '${generatorUrl}';</script>`);
    }
    if (url === generatorUrl) {
      return htmlResponse(`
        <a href="https://pixeldrain.com/u/AbCdEf99">Download [PixelServer : 2]</a>
        <a href="https://pub-demo.r2.dev/movies/Moana.2026.2160p.REMUX.mkv">Download [FSL Server]</a>
        <a href="https://t.me/spamchannel">Join Telegram</a>
      `);
    }
    return htmlResponse('Not found', { status: 404 });
  };

  // Case A: `.mkv` release -> PixelDrain URL has NO `.mkv` extension, must STILL be `playable: false`!
  const mkvResult = await Resolver.resolveHubMirror(
    {
      shortUrl: 'https://greenmotors.club/?id=test1',
      fileName: 'Moana.2026.2160p.BluRay.REMUX.HEVC.mkv',
      label: 'Moana 2160p REMUX',
    },
    { fetchImpl: mockFetch, dnsLookup: PUBLIC_DNS, disableCache: true }
  );

  assert.equal(mkvResult.status, 'resolved');
  assert.equal(mkvResult.links.length, 2, 'Telegram link ignored');
  assert.equal(mkvResult.links[0].url, 'https://pixeldrain.com/api/file/AbCdEf99?download');
  assert.equal(mkvResult.links[0].playable, false, 'MKV on extensionless PixelDrain URL must NEVER be claimed browser-playable');
  assert.equal(mkvResult.links[0].container, 'MKV');
  assert.equal(mkvResult.links[0].delivery, 'download');
  assert.equal(mkvResult.links[1].playable, false);

  // Case B: Verified `.mp4` release -> marked `playable: true` (`streamType: "mp4"`)
  const mp4Result = await Resolver.resolveHubMirror(
    {
      shortUrl: 'https://greenmotors.club/?id=test1',
      fileName: 'Night.Of.The.Living.Dead.1968.1080p.H264.mp4',
      label: '1080p MP4',
    },
    { fetchImpl: mockFetch, dnsLookup: PUBLIC_DNS, disableCache: true }
  );
  assert.equal(mp4Result.status, 'resolved');
  assert.equal(mp4Result.links[0].playable, true);
  assert.equal(mp4Result.links[0].streamType, 'mp4');
});

test('resolveHubMirror stops cleanly on CAPTCHA challenge without attempting bypass and provides fallback link', async () => {
  const challengeHtml = `
    <html>
      <head><title>Just a moment...</title></head>
      <body><script>window._cf_chl_opt = {};</script><div class="cf-turnstile"></div></body>
    </html>
  `;
  const mockFetch = async () => htmlResponse(challengeHtml, { status: 403, headers: { 'cf-mitigated': 'challenge' } });

  const result = await Resolver.resolveHubMirror(
    { shortUrl: 'https://greenmotors.club/?id=gated', fileName: 'Sample.mp4' },
    { fetchImpl: mockFetch, dnsLookup: PUBLIC_DNS, disableCache: true }
  );

  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'captcha');
  assert.equal(result.links.length, 0);
  assert.equal(result.externalFallbackUrl, 'https://greenmotors.club/?id=gated');
});

/* -------------------- 4. Backend Fetch Security Guard -------------------- */

test('isBlockedIp blocks private, loopback, link-local, IMDS, CGNAT, multicast and IPv4-mapped IPv6 addresses', () => {
  for (const blocked of [
    '127.0.0.1',
    '10.0.0.8',
    '172.16.0.1',
    '172.31.255.254',
    '192.168.1.20',
    '169.254.169.254',
    '100.64.10.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fe80::1',
    'fc00::1234',
    'fd12:3456::1',
    '::ffff:127.0.0.1',
    '::ffff:169.254.169.254',
  ]) {
    assert.equal(SafeFetch.isBlockedIp(blocked), true, `Expected ${blocked} to be blocked`);
  }

  for (const allowed of ['104.21.58.178', '1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) {
    assert.equal(SafeFetch.isBlockedIp(allowed), false, `Expected ${allowed} to be allowed`);
  }
});

test('safeFetchHtml enforces host allowlist, DNS rebinding protection, redirect validation, byte limit and credential stripping', async () => {
  // 1. Disallowed arbitrary host rejected before fetch
  await assert.rejects(
    () =>
      SafeFetch.safeFetchHtml('https://google.com/', {
        purpose: 'catalogue',
        dnsLookup: PUBLIC_DNS,
        fetchImpl: async () => assert.fail('fetch must not run for disallowed host'),
      }),
    (err) => err.code === 'disallowed_host'
  );

  // 2. DNS rebinding to private IP on an allowlisted hostname is blocked before socket connect
  await assert.rejects(
    () =>
      SafeFetch.safeFetchHtml('https://4khdhub.one/', {
        purpose: 'catalogue',
        dnsLookup: async () => [{ address: '169.254.169.254', family: 4 }],
        fetchImpl: async () => assert.fail('fetch must not run when DNS resolves to private/metadata IP'),
      }),
    (err) => err.code === 'blocked_ip'
  );

  // 3. Open-redirect from allowlisted host to internal URL is blocked mid-flight
  await assert.rejects(
    () =>
      SafeFetch.safeFetchHtml('https://greenmotors.club/?id=ssrf', {
        purpose: 'mirror',
        dnsLookup: PUBLIC_DNS,
        fetchImpl: async () =>
          new Response('', {
            status: 302,
            headers: { location: 'http://127.0.0.1:5432/secret' },
          }),
      }),
    (err) => err.code === 'insecure_protocol' || err.code === 'blocked_ip'
  );

  // 4. Oversized streamed HTML body is aborted strictly at maxBytes
  await assert.rejects(
    () =>
      SafeFetch.safeFetchHtml('https://4khdhub.one/', {
        purpose: 'catalogue',
        maxBytes: 256,
        dnsLookup: PUBLIC_DNS,
        fetchImpl: async () => htmlResponse('x'.repeat(2048)),
      }),
    (err) => err.code === 'response_too_large'
  );

  // 5. Bounded retry recovers from single 503 and strips credentials
  let attempts = 0;
  let capturedInit = null;
  const ok = await SafeFetch.safeFetchHtml('https://4khdhub.one/', {
    purpose: 'catalogue',
    maxRetries: 1,
    dnsLookup: PUBLIC_DNS,
    fetchImpl: async (_url, init) => {
      attempts += 1;
      capturedInit = init;
      if (attempts === 1) return htmlResponse('Unavailable', { status: 503 });
      return htmlResponse('<html><h1>OK</h1></html>');
    },
  });
  assert.equal(attempts, 2);
  assert.equal(ok.status, 200);
  assert.equal(capturedInit.credentials, 'omit');
  assert.equal(capturedInit.headers.cookie, undefined);
  assert.equal(capturedInit.headers.authorization, undefined);
});

/* -------- 5. Provider End-to-End Flow & No Silent Replacement Guard ------ */

test('FourKHDHubMediaProvider runs search -> detail flow and does NOT silently replace outages with Demo/Archive', async () => {
  const provider = new ProviderMod.FourKHDHubMediaProvider({
    baseUrl: 'https://4khdhub.one',
    dnsLookup: PUBLIC_DNS,
    fetchImpl: async (url) => {
      if (url.includes('?s=moana')) return htmlResponse(SEARCH_FIXTURE);
      if (url.endsWith('/moana-movie-8014/')) return htmlResponse(MOVIE_DETAIL_FIXTURE);
      return htmlResponse('Not found', { status: 404 });
    },
  });

  const searchResults = await provider.searchTitles('moana', 'movie', 10);
  assert.equal(searchResults.length, 1);
  assert.equal(searchResults[0].slug, 'hub-moana-movie-8014');

  const detail = await provider.getMovieDetails('hub-moana-movie-8014');
  assert.ok(detail);
  assert.equal(detail.title.title, 'Moana');
  assert.equal(detail.releases.length, 2);
  assert.equal(detail.provider.id, '4khdhub');

  // Verify default MEDIA_PROVIDER resolves to 4khdhub rather than archive/demo
  const prevEnv = process.env.MEDIA_PROVIDER;
  delete process.env.MEDIA_PROVIDER;
  ServiceMod.clearMediaProviderCache();
  assert.equal(ServiceMod.mediaProviderId(), '4khdhub');
  if (prevEnv !== undefined) process.env.MEDIA_PROVIDER = prevEnv;
});

/* -------- 6. Browser HLS Detection & hls.js MSE Fallback Guard ----------- */

test('hlsPlayer uses native Apple HLS on Safari, hls.js MSE fallback on Chromium/Firefox, and surfaces fatal CORS/unsupported states', async () => {
  function makeMockVideo(nativeSupport = '') {
    return {
      src: '',
      paused: false,
      loaded: 0,
      canPlayType(mime) {
        return mime === 'application/vnd.apple.mpegurl' ? nativeSupport : '';
      },
      pause() {
        this.paused = true;
      },
      removeAttribute(attr) {
        if (attr === 'src') this.src = '';
      },
      load() {
        this.loaded += 1;
      },
    };
  }

  const hlsSource = { type: 'hls', url: 'https://cdn.example.com/master.m3u8' };

  // 1. Safari / iOS native HLS uses <video src> without needing hls.js
  const safariVideo = makeMockVideo('maybe');
  const safariHandle = await HlsPlayer.attachPlaybackSource({
    video: safariVideo,
    source: hlsSource,
    onFatalError: () => assert.fail('Safari native HLS should not fail'),
  });
  assert.equal(safariHandle.mode, 'native-hls');
  assert.equal(safariVideo.src, hlsSource.url);
  safariHandle.destroy();
  assert.equal(safariVideo.src, '');

  // 2. Chrome / Firefox (no native HLS) attaches hls.js MSE, recovers once on transient network error, and fails cleanly on fatal CORS error
  let errorListener = null;
  let startLoadCalls = 0;
  let destroyedCount = 0;
  class MockHls {
    static isSupported() {
      return true;
    }
    loadSource(url) {
      this.url = url;
    }
    attachMedia(el) {
      this.media = el;
    }
    on(event, fn) {
      if (event === MockHls.Events.ERROR) errorListener = fn;
    }
    startLoad() {
      startLoadCalls += 1;
    }
    recoverMediaError() {}
    destroy() {
      destroyedCount += 1;
    }
  }
  MockHls.Events = { ERROR: 'hlsError' };
  MockHls.ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };

  const chromeVideo = makeMockVideo('');
  let fatalMessage = null;
  const chromeHandle = await HlsPlayer.attachPlaybackSource({
    video: chromeVideo,
    source: hlsSource,
    loadHlsModule: async () => ({ default: MockHls }),
    onFatalError: (reason) => {
      fatalMessage = reason;
    },
  });
  assert.equal(chromeHandle.mode, 'mse-hls');

  // First fatal network error triggers single bounded recovery (`startLoad`), NOT immediate failure
  errorListener('hlsError', { type: 'networkError', fatal: true, details: 'manifestLoadError' });
  assert.equal(startLoadCalls, 1);
  assert.equal(fatalMessage, null);

  // Second fatal network error (e.g., CORS block) destroys hls instance and surfaces diagnostic error
  errorListener('hlsError', { type: 'networkError', fatal: true, details: 'manifestLoadError' });
  assert.equal(destroyedCount, 1);
  assert.ok(fatalMessage && /network error/i.test(fatalMessage));

  // 3. Browser without native HLS OR MSE is reported honestly as unsupported (never falsely claimed playable)
  const legacyVideo = makeMockVideo('');
  let unsupportedMessage = null;
  const legacyHandle = await HlsPlayer.attachPlaybackSource({
    video: legacyVideo,
    source: hlsSource,
    loadHlsModule: async () => ({
      default: Object.assign(function UnsupportedHls() {}, {
        isSupported: () => false,
        Events: MockHls.Events,
        ErrorTypes: MockHls.ErrorTypes,
      }),
    }),
    onFatalError: (reason) => {
      unsupportedMessage = reason;
    },
  });
  assert.equal(legacyHandle.mode, 'unsupported');
  assert.ok(unsupportedMessage && /MediaSource Extensions/i.test(unsupportedMessage));
});

