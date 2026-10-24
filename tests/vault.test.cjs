const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

/**
 * The exclusive catalogue's framework-free pieces — signing, payload adaptation and
 * the signed-stream relay — are compiled and exercised here without a browser.
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

function load(relative) {
  return loadTs(relative);
}

const A = load('../src/lib/media/vaultAdapt.ts');
const C = load('../src/lib/media/vaultCrypto.ts');
const S = load('../src/lib/media/vaultStream.ts');

/* ------------------------------ signing ---------------------------------- */

test('sortedQueryString groups and sorts parameters by key', () => {
  assert.equal(
    C.sortedQueryString('https://api.example.com/endpoint?b=2&a=1&c=3'),
    'a=1&b=2&c=3'
  );
  assert.equal(C.sortedQueryString('https://api.example.com/endpoint'), '');
});

test('sortedQueryString keeps repeated keys in insertion order', () => {
  assert.equal(
    C.sortedQueryString('https://api.example.com/e?a=2&b=1&a=1'),
    'a=2&a=1&b=1'
  );
});

test('generateClientToken is "<ms>,<32 hex chars>"', () => {
  const token = C.generateClientToken(1700000000000);
  const parts = token.split(',');
  assert.equal(parts.length, 2);
  assert.equal(parts[0], '1700000000000');
  assert.equal(parts[1].length, 32);
  assert.match(parts[1], /^[0-9a-f]{32}$/);
});

test('canonical string follows METHOD/accept/type/len/ms/hash/url order', () => {
  const canonical = C.buildCanonicalString(
    'GET',
    'application/json',
    'application/json',
    'https://api.example.com/path?tab=1&page=2',
    undefined,
    1700000000000
  );
  const lines = canonical.split('\n');
  assert.equal(lines.length, 7);
  assert.equal(lines[0], 'GET');
  assert.equal(lines[1], 'application/json');
  assert.equal(lines[2], 'application/json');
  assert.equal(lines[3], '');
  assert.equal(lines[4], '1700000000000');
  assert.equal(lines[5], '');
  assert.equal(lines[6], '/path?page=2&tab=1');
});

test('signature is "<ms>|2|<base64>"', () => {
  const signature = C.generateSignature(
    'GET',
    'application/json',
    'application/json',
    'https://api.example.com/path',
    undefined,
    1700000000000
  );
  const parts = signature.split('|');
  assert.equal(parts.length, 3);
  assert.equal(parts[0], '1700000000000');
  assert.equal(parts[1], '2');
  assert.ok(parts[2].length > 0);
});

test('signed headers carry the client token, signature and identity', () => {
  const headers = C.buildSignedHeaders({
    method: 'POST',
    url: 'https://api.example.com/x',
    body: '{}',
    authToken: 'tok',
    userAgent: 'UA/1.0',
    clientInfo: '{}',
    spoofedIp: '1.2.3.4',
  });
  assert.equal(headers['user-agent'], 'UA/1.0');
  assert.equal(headers.accept, 'application/json');
  assert.ok(headers['x-client-token']);
  assert.ok(headers['x-tr-signature']);
  assert.equal(headers['x-client-info'], '{}');
  assert.equal(headers['x-forwarded-for'], '1.2.3.4');
  assert.equal(headers.authorization, 'Bearer tok');
});

test('signed headers omit authorization when there is no session', () => {
  const headers = C.buildSignedHeaders({
    method: 'GET',
    url: 'https://api.example.com/x',
    userAgent: 'UA/1.0',
    clientInfo: '{}',
    spoofedIp: '1.2.3.4',
  });
  assert.equal(headers.authorization, undefined);
});

test('client identity is a well-formed Android client', () => {
  const { userAgent, clientInfo } = C.generateClientIdentity();
  assert.match(userAgent, /com\.community\.oneroom\/500201\d\d/);
  assert.match(userAgent, /Cronet\/135\.0\.7012\.3/);
  const parsed = JSON.parse(clientInfo);
  assert.equal(parsed.package_name, 'com.community.oneroom');
  assert.equal(parsed.sp_code, '40401');
  assert.equal(parsed['X-Play-Mode'], '2');
  assert.ok(parsed.version_code >= 50020117 && parsed.version_code <= 50020121);
});

/* ------------------------------- titles ---------------------------------- */

test('cleanTitle strips quality and language tags', () => {
  assert.equal(A.cleanTitle('[Dub] Attack on Titan'), 'Attack on Titan');
  assert.equal(A.cleanTitle('[1080p] Dune'), 'Dune');
  assert.equal(A.cleanTitle('Dune [2021]'), 'Dune');
  assert.equal(A.cleanTitle('Breaking Bad S01'), 'Breaking Bad');
  assert.equal(A.cleanTitle('Ek Deewane Ki Deewaniyat_360P'), 'Ek Deewane Ki Deewaniyat');
  assert.equal(A.cleanTitle('Movie - Hindi Dub'), 'Movie');
});

test('cleanTitle keeps a genuine year in parentheses', () => {
  assert.equal(A.cleanTitle('Inception (2010)'), 'Inception (2010)');
});

test('vault slugs round-trip the subject id', () => {
  const slug = A.vaultSlug('12345', 'Inception');
  assert.ok(slug.startsWith('vault-12345-'));
  assert.equal(A.subjectIdFromSlug(slug), '12345');
  assert.equal(A.subjectIdFromSlug('603692-john-wick'), null);
  assert.equal(A.isVaultSlug(slug), true);
  assert.equal(A.isVaultSlug('603692-john-wick'), false);
});

test('search payload becomes titles with kind, year and poster', () => {
  // The real API groups its matches: `results` is an array of groups, each with
  // a `subjects` array. Only the first group is used.
  const payload = {
    results: [
      {
        subjects: [
          {
            subjectId: 987,
            title: '[1080p] Dune Part Two',
            subjectType: 1,
            releaseDate: '2024-03-01',
            cover: { url: 'https://cdn.example.com/dune.jpg' },
            genre: ['Action', 'Sci-Fi'],
          },
          { subjectId: 654, title: 'Some Series', subjectType: 2 },
        ],
      },
    ],
  };
  const titles = A.searchPayloadToTitles(payload);
  assert.equal(titles.length, 2);
  assert.equal(titles[0].id, '987');
  assert.equal(titles[0].kind, 'movie');
  assert.equal(titles[0].title, 'Dune Part Two');
  assert.equal(titles[0].year, 2024);
  assert.equal(titles[0].poster, 'https://cdn.example.com/dune.jpg');
  assert.equal(titles[0].genres.length, 2);
  assert.equal(titles[1].kind, 'series');
});

test('search payload also accepts grouped and flat shapes', () => {
  // `results` wrapped in `data` (the client unwraps `data` before adapting).
  const grouped = A.searchPayloadToTitles({
    results: { list: [{ subjects: [{ subjectId: 1, title: 'A' }] }] },
  });
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].id, '1');

  const flat = A.searchPayloadToTitles({ list: [{ subjectId: 2, title: 'B' }] });
  assert.equal(flat.length, 1);
  assert.equal(flat[0].id, '2');

  const direct = A.searchPayloadToTitles({ subjects: [{ subjectId: 3, title: 'C' }] });
  assert.equal(direct.length, 1);
  assert.equal(direct[0].id, '3');
});

test('duplicate subjects in one response are collapsed', () => {
  const payload = {
    results: [{ subjects: [{ subjectId: 5, title: 'Same' }, { subjectId: 5, title: 'Same' }] }],
  };
  assert.equal(A.searchPayloadToTitles(payload).length, 1);
});

/* --------------------------- dash resolution ---------------------------- */

test('resolveDashManifestFromPolicy reads an edge-cache urlprefix', () => {
  const prefix = 'https://sbcdn3.hakunaymatata.com/dash/3264_0_0_1080_h265_560/';
  const b64 = Buffer.from(prefix, 'utf8').toString('base64');
  const cookie = `Edge-Cache-Cookie=urlprefix=${b64}:sign=abc:t=123`;
  assert.equal(
    A.resolveDashManifestFromPolicy(cookie),
    'https://sbcdn3.hakunaymatata.com/dash/3264_0_0_1080_h265_560/index.mpd'
  );
});

test('resolveDashManifestFromPolicy reads a CloudFront policy', () => {
  const policy = JSON.stringify({
    Statement: [{ Resource: 'https://sacdn.hakunaymatata.com/dash/4179_0_0_1080_h265_518/*' }],
  });
  const b64 = Buffer.from(policy, 'utf8').toString('base64');
  const cookie = `CloudFront-Policy=${b64};CloudFront-Signature=abc;CloudFront-Key-Pair-Id=K123;`;
  assert.equal(
    A.resolveDashManifestFromPolicy(cookie),
    'https://sacdn.hakunaymatata.com/dash/4179_0_0_1080_h265_518/index.mpd'
  );
});

test('resolveDashManifestFromPolicy rejects a malformed policy', () => {
  assert.equal(A.resolveDashManifestFromPolicy('CloudFront-Policy=invalid_base64;'), null);
  assert.equal(A.resolveDashManifestFromPolicy(''), null);
});

test('dashRequestHeaders carries the referer, user agent and cookie', () => {
  const headers = A.dashRequestHeaders(
    'Edge-Cache-Cookie=urlprefix=abc:sign=xyz:t=1;',
    'TestAgent/1.0'
  );
  const names = headers.map(([name]) => name);
  assert.ok(names.includes('Referer'));
  assert.ok(names.includes('User-Agent'));
  assert.ok(names.includes('Cookie'));
  const cookie = headers.find(([name]) => name === 'Cookie')[1];
  assert.ok(cookie.includes('Edge-Cache-Cookie='));
});

test('deprecation notice URLs are recognised', () => {
  assert.equal(A.isDeprecationNoticeUrl('https://x/notice.mp4'), true);
  assert.equal(A.isDeprecationNoticeUrl('https://macdn.aoneroom.com/other/a.mp4'), true);
  assert.equal(A.isDeprecationNoticeUrl('https://cdn.example.com/real.mp4'), false);
});

/* ------------------------------- releases -------------------------------- */

test('play-info becomes one release per quality, each with signed headers', () => {
  const prefix = 'https://sbcdn3.hakunaymatata.com/dash/12345_0_0_1080_h265_560/';
  const b64 = Buffer.from(prefix, 'utf8').toString('base64');
  const cookie = `Edge-Cache-Cookie=urlprefix=${b64}:sign=abc:t=1`;
  const payload = {
    title: 'Sample Movie',
    displayResolutions: '480,720,1080',
    streams: [
      {
        id: '9999',
        format: 'MP4',
        codecName: 'hevc',
        size: '1500000000',
        resolutions: '1080,720,480',
        url: 'https://macdn.example.com/notice.mp4',
        signCookie: cookie,
      },
    ],
  };
  const releases = A.playInfoToReleases(payload, 0, 0, 'TestAgent/1.0');
  assert.equal(releases.length, 3);
  assert.equal(releases[0].quality, '1080p');
  assert.equal(releases[1].quality, '720p');
  assert.equal(releases[2].quality, '480p');
  assert.equal(releases[0].mirrors[0].shortUrl, `${prefix}index.mpd`);
  assert.ok(releases[0].mirrors[0].headers.some(([name]) => name === 'Cookie'));
  assert.ok(releases[0].mirrors[0].headers.some(([name]) => name === 'Referer'));
  // The highest quality keeps the reported size; lower ones are scaled down.
  assert.equal(releases[0].sizeBytes, 1500000000);
  assert.ok(releases[2].sizeBytes < releases[0].sizeBytes);
});

test('play-info with no usable stream yields no releases', () => {
  assert.deepEqual(A.playInfoToReleases({ streams: [] }, 0, 0, 'UA'), []);
  assert.deepEqual(A.playInfoToReleases({}, 0, 0, 'UA'), []);
});

test('a resource item becomes a downloadable release', () => {
  const release = A.resourceItemToRelease({
    fileName: 'Movie.2024.1080p.mp4',
    resolution: 1080,
    size: 1234567,
    language: 'Hindi',
    codecName: 'hevc',
    resourceId: 42,
    resourceLink: 'https://cdn.example.com/Movie.mp4',
  });
  assert.ok(release);
  assert.equal(release.quality, '1080p');
  assert.equal(release.container, 'mp4');
  assert.equal(release.languages, 'Hindi');
  assert.equal(release.mirrors.length, 1);
  assert.equal(release.mirrors[0].shortUrl, 'https://cdn.example.com/Movie.mp4');
});

test('a deprecation-notice resource item is dropped', () => {
  const release = A.resourceItemToRelease({
    fileName: 'x.mp4',
    resourceLink: 'https://macdn.aoneroom.com/other/clip.mp4',
  });
  assert.equal(release, null);
});

/* -------------------------------- relay ---------------------------------- */

test('relay tokens round-trip the upstream URL and headers', () => {
  const token = S.encodeVaultStreamToken({
    u: 'https://sbcdn3.hakunaymatata.com/dash/1/index.mpd',
    h: [['Cookie', 'CloudFront-Policy=abc']],
  });
  const decoded = S.decodeVaultStreamToken(token);
  assert.equal(decoded.u, 'https://sbcdn3.hakunaymatata.com/dash/1/index.mpd');
  assert.deepEqual(decoded.h, [['Cookie', 'CloudFront-Policy=abc']]);
});

test('relay tokens drop headers that must never be forwarded', () => {
  const token = S.encodeVaultStreamToken({
    u: 'https://sbcdn3.hakunaymatata.com/dash/1/index.mpd',
    h: [
      ['Authorization', 'Bearer secret'],
      ['Cookie', 'ok=1'],
      ['X-Forwarded-For', '1.2.3.4'],
    ],
  });
  const decoded = S.decodeVaultStreamToken(token);
  assert.deepEqual(decoded.h, [['Cookie', 'ok=1']]);
});

test('relay tokens reject a non-https or malformed payload', () => {
  assert.equal(S.decodeVaultStreamToken('not-base64-json'), null);
  const httpToken = S.encodeVaultStreamToken({ u: 'http://cdn.example.com/a.mp4' });
  assert.equal(S.decodeVaultStreamToken(httpToken), null);
});

test('the relay only accepts allowlisted CDN hosts', () => {
  assert.equal(S.isAllowedVaultUpstreamHost('sbcdn3.hakunaymatata.com'), true);
  assert.equal(S.isAllowedVaultUpstreamHost('sacdn.hakunaymatata.com'), true);
  assert.equal(S.isAllowedVaultUpstreamHost('macdn.aoneroom.com'), true);
  assert.equal(S.isAllowedVaultUpstreamHost('evil.example.com'), false);
  assert.equal(S.isAllowedVaultUpstreamHost('localhost'), false);
  assert.equal(S.isAllowedVaultUpstreamHost('127.0.0.1'), false);
});

test('a DASH manifest has its base rewritten to the relay', () => {
  const manifest = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period><BaseURL>https://cdn.example.com/dash/1/</BaseURL></Period></MPD>';
  const rewritten = S.rewriteDashManifest(manifest, 'https://site.test/api/media/vault-stream/TOK');
  assert.ok(rewritten.includes('<BaseURL>https://site.test/api/media/vault-stream/TOK/</BaseURL>'));
  assert.ok(!rewritten.includes('cdn.example.com'));
});

test('a DASH manifest without a base gets one injected', () => {
  const manifest = '<MPD xmlns="urn:mpeg:dash:schema:mpd:2011"><Period/></MPD>';
  const rewritten = S.rewriteDashManifest(manifest, 'https://site.test/api/media/vault-stream/TOK');
  assert.ok(rewritten.includes('<BaseURL>https://site.test/api/media/vault-stream/TOK/</BaseURL>'));
});

test('segments resolve against the manifest directory', () => {
  const base = 'https://sbcdn3.hakunaymatata.com/dash/12345/';
  assert.equal(
    S.resolveVaultSegmentUrl(base, '1_video.mp4'),
    'https://sbcdn3.hakunaymatata.com/dash/12345/1_video.mp4'
  );
  assert.equal(
    S.resolveVaultSegmentUrl(base, '/init.mp4'),
    'https://sbcdn3.hakunaymatata.com/dash/12345/init.mp4'
  );
});

test('segment resolution refuses traversal and absolute URLs', () => {
  const base = 'https://sbcdn3.hakunaymatata.com/dash/12345/';
  assert.equal(S.resolveVaultSegmentUrl(base, '../secret'), null);
  assert.equal(S.resolveVaultSegmentUrl(base, 'a/../../secret'), null);
  assert.equal(S.resolveVaultSegmentUrl(base, 'https://evil.example.com/x'), null);
  assert.equal(S.resolveVaultSegmentUrl(undefined, 'a.mp4'), null);
});

test('the relay URL carries its token in the path so segments can be appended', () => {
  const url = S.buildVaultStreamUrl(
    'https://sbcdn3.hakunaymatata.com/dash/1/index.mpd',
    [['Cookie', 'CloudFront-Policy=abc']],
    'https://site.test'
  );
  assert.ok(url.startsWith('https://site.test/api/media/vault-stream/'));
  assert.ok(!url.includes('?'), 'the token must not sit in the query string');
  const token = url.slice('https://site.test/api/media/vault-stream/'.length);
  const decoded = S.decodeVaultStreamToken(token);
  assert.equal(decoded.u, 'https://sbcdn3.hakunaymatata.com/dash/1/index.mpd');
  assert.deepEqual(decoded.h, [['Cookie', 'CloudFront-Policy=abc']]);
});

test('the relay URL keeps the manifest directory so segments resolve', () => {
  const url = S.buildVaultStreamUrl(
    'https://sbcdn3.hakunaymatata.com/dash/1/index.mpd',
    undefined,
    null,
    'https://sbcdn3.hakunaymatata.com/dash/1/'
  );
  const token = url.slice('/api/media/vault-stream/'.length);
  const decoded = S.decodeVaultStreamToken(token);
  assert.equal(decoded.b, 'https://sbcdn3.hakunaymatata.com/dash/1/');
  assert.equal(
    S.resolveVaultSegmentUrl(decoded.b, '1.m4s'),
    'https://sbcdn3.hakunaymatata.com/dash/1/1.m4s'
  );
});

test('unwrapVaultStreamUrl reads the upstream URL back out of a relay URL', () => {
  const url = S.buildVaultStreamUrl('https://sbcdn3.hakunaymatata.com/dash/1/index.mpd', undefined, 'https://site.test');
  assert.equal(S.unwrapVaultStreamUrl(url), 'https://sbcdn3.hakunaymatata.com/dash/1/index.mpd');
  assert.equal(S.unwrapVaultStreamUrl('https://cdn.example.com/a.mp4'), null);
});

/* ------------------------------- resolver -------------------------------- */

const R = load('../src/lib/media/vaultResolve.ts');

test('a signed DASH mirror resolves to a relayed, playable link', () => {
  const result = R.resolveVaultMirror(
    'https://sbcdn3.hakunaymatata.com/dash/12345_0_0_1080_h265_560/index.mpd',
    { fileName: 'Dune 1080p HEVC', origin: 'https://site.test' }
  );
  assert.equal(result.status, 'resolved');
  assert.equal(result.links.length, 1);
  const link = result.links[0];
  assert.equal(link.playable, true);
  assert.equal(link.streamType, 'dash');
  assert.equal(link.delivery, 'stream');
  assert.ok(link.url.startsWith('https://site.test/api/media/vault-stream/'));
  assert.ok(!link.url.includes('?'), 'the relay token travels in the path');
});

test('the resolved relay link carries the signed cookie and the manifest directory', () => {
  const result = R.resolveVaultMirror(
    'https://sbcdn3.hakunaymatata.com/dash/12345/index.mpd',
    {
      headers: [['Cookie', 'CloudFront-Policy=abc'], ['Referer', 'https://sportslive.wine']],
      origin: 'https://site.test',
    }
  );
  const token = result.links[0].url.split('/api/media/vault-stream/')[1];
  const decoded = S.decodeVaultStreamToken(token);
  assert.deepEqual(decoded.h, [['Cookie', 'CloudFront-Policy=abc'], ['Referer', 'https://sportslive.wine']]);
  assert.equal(decoded.b, 'https://sbcdn3.hakunaymatata.com/dash/12345/');
});

test('a direct MP4 mirror resolves to a playable direct link', () => {
  const result = R.resolveVaultMirror('https://macdn.aoneroom.com/Dune.mp4');
  assert.equal(result.status, 'resolved');
  assert.equal(result.links[0].playable, true);
  assert.equal(result.links[0].streamType, 'mp4');
  assert.equal(result.links[0].delivery, 'stream');
});

test('an MKV mirror is offered as a download, never as a playable stream', () => {
  const result = R.resolveVaultMirror('https://macdn.aoneroom.com/Dune.mkv');
  assert.equal(result.links[0].playable, false);
  assert.equal(result.links[0].delivery, 'download');
});

test('a signed DASH manifest outside the relay allowlist is blocked', () => {
  const result = R.resolveVaultMirror('https://evil.example.com/dash/1/index.mpd');
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'disallowed_host');
  assert.equal(result.links.length, 0);
});

test('a direct file on an unsafe URL is blocked', () => {
  const result = R.resolveVaultMirror('https://localhost/Dune.mp4');
  assert.equal(result.status, 'blocked');
  assert.equal(result.links.length, 0);
});

test('a plain-http mirror is blocked', () => {
  const result = R.resolveVaultMirror('http://sbcdn3.hakunaymatata.com/dash/1/index.mpd');
  assert.equal(result.status, 'blocked');
  assert.equal(result.reason, 'insecure_protocol');
});

test('isVaultMirrorUrl recognises only the signed-manifest CDN', () => {
  assert.equal(R.isVaultMirrorUrl('https://sbcdn3.hakunaymatata.com/dash/1/index.mpd'), true);
  assert.equal(R.isVaultMirrorUrl('https://macdn.aoneroom.com/dash/1/index.mpd'), true);
  // Direct files are identified by the mirror's `source` tag, not by their URL.
  assert.equal(R.isVaultMirrorUrl('https://macdn.aoneroom.com/a.mp4'), false);
  assert.equal(R.isVaultMirrorUrl('https://cdn.example.com/a.mkv'), false);
  assert.equal(R.isVaultMirrorUrl('https://4khdhub.one/movie/x'), false);
  assert.equal(R.isVaultMirrorUrl('not a url'), false);
});
