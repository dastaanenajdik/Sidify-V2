const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

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
  return loadModule;
}

const load = createLoader();
const token = load(path.join(SRC, 'lib/media/vaultStreamToken.ts'));
const playback = load(path.join(SRC, 'lib/media/vaultPlayback.ts'));

/* ------------------------------ fixtures -------------------------------- */

const MANIFEST = 'https://media.test/dash/101/index.mpd';
const COOKIE = 'Edge-Cache-Cookie=urlprefix=aHR0cHM6Ly9tZWRpYS50ZXN0L2Rhc2gvMTAxLw==:sign=abc:t=1700000000';
const DASH_HEADERS = [
  ['Referer', 'https://sportslive.wine'],
  ['User-Agent', 'Fixture/1.0'],
  ['Cookie', COOKIE],
];

function dashRelease(overrides = {}) {
  return {
    id: 'vault-play-7-1080',
    title: 'Night Train 1080p H264',
    fileName: 'Night.Train.1080p.H264',
    quality: '1080p',
    container: 'mp4',
    tags: ['H264'],
    mirrors: [
      { id: 'vault-dash-7-1080', label: '1080p H264', shortUrl: MANIFEST, host: 'media.test', source: 'vault', headers: DASH_HEADERS },
    ],
    ...overrides,
  };
}

function fileRelease(url = 'https://files.test/night-train-1080.mp4') {
  return {
    id: 'vault-resource-201',
    title: 'Night.Train.2025.1080p.mp4',
    fileName: 'Night.Train.2025.1080p.mp4',
    quality: '1080p',
    container: 'mp4',
    mirrors: [{ id: 'vault-file-201', label: 'Direct', shortUrl: url, host: 'files.test', source: 'vault' }],
  };
}

/* --------------------------- the relay token ---------------------------- */

test('the relay token round-trips without any Node built-in', () => {
  const encoded = token.encodeVaultStreamToken({ u: MANIFEST, h: DASH_HEADERS, b: 'https://media.test/dash/101/' });
  assert.match(encoded, /^[A-Za-z0-9_-]+$/, 'base64url, safe in a path segment');

  const decoded = token.decodeVaultStreamToken(encoded);
  assert.equal(decoded.u, MANIFEST);
  assert.equal(decoded.b, 'https://media.test/dash/101/');
  assert.deepEqual(decoded.h, DASH_HEADERS);
});

test('only https URLs and the three CDN headers survive a token', () => {
  assert.equal(token.decodeVaultStreamToken(token.encodeVaultStreamToken({ u: 'http://plain.test/x' })), null);
  assert.equal(token.decodeVaultStreamToken(token.encodeVaultStreamToken({ u: 'https://ok.test/x', b: 'http://bad.test/' })), null);
  assert.equal(token.decodeVaultStreamToken('not-a-token'), null);

  const decoded = token.decodeVaultStreamToken(
    token.encodeVaultStreamToken({
      u: MANIFEST,
      h: [
        ['Cookie', 'a=b'],
        ['Authorization', 'Bearer leaked'],
        ['X-Evil', 'nope'],
        ['Referer', 'https://ref.test'],
      ],
    })
  );
  assert.deepEqual(decoded.h, [
    ['Cookie', 'a=b'],
    ['Referer', 'https://ref.test'],
  ]);
});

test('the token module is byte-compatible with the server relay', () => {
  // The server builds the same URL in `vaultProvider.getPlaybackSources`; a
  // mismatch would 404 every stream.
  const descriptor = { u: MANIFEST, h: DASH_HEADERS, b: 'https://media.test/dash/101/' };
  const fromModule = token.encodeVaultStreamToken(descriptor);
  const fromNode = Buffer.from(JSON.stringify(descriptor), 'utf8').toString('base64url');
  assert.equal(fromModule, fromNode);
});

/* --------------------------- playback sources --------------------------- */

test('a signed manifest becomes a relayed DASH source the browser can build', () => {
  const sources = playback.dashPlaybackSources([dashRelease()], { origin: 'https://sidify.test' });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].type, 'dash');
  assert.equal(sources[0].label, '1080p DASH');
  assert.ok(sources[0].url.startsWith('https://sidify.test/api/media/vault-stream/'));
  assert.match(sources[0].note, /relayed/i);

  const upstream = playback.upstreamOfSource(sources[0].url);
  assert.equal(upstream, MANIFEST, 'the descriptor still points at the CDN manifest');
  assert.equal(playback.isRelayedSource(sources[0].url), true);
});

test('a manifest with no signed cookie is played straight from the CDN', () => {
  const release = dashRelease({
    mirrors: [
      { id: 'm', label: 'DASH', shortUrl: MANIFEST, host: 'media.test', source: 'vault', headers: [['Referer', 'https://sportslive.wine']] },
    ],
  });
  const sources = playback.dashPlaybackSources([release], { origin: 'https://sidify.test' });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].url, MANIFEST, 'no relay for an unauthenticated manifest');
  assert.match(sources[0].note, /no relay/i);
});

test('one source per manifest, and only manifests are picked up', () => {
  const duplicate = dashRelease({ id: 'other', quality: '720p' });
  const sources = playback.dashPlaybackSources(
    [dashRelease(), duplicate, fileRelease()],
    { origin: 'https://sidify.test' }
  );
  assert.equal(sources.length, 1, 'two qualities of one manifest are one adaptive source');
  assert.equal(sources[0].label, '1080p DASH', 'the first (best) quality names it');
});

test('DASH sources come before files, and duplicates collapse', () => {
  const dash = playback.dashPlaybackSources([dashRelease()], { origin: 'https://sidify.test' });
  const files = [
    { url: 'https://files.test/a.mp4', type: 'mp4', label: '1080p' },
    { url: 'https://files.test/a.mp4', type: 'mp4', label: 'duplicate' },
  ];
  const merged = playback.mergePlaybackSources(dash, files);
  assert.deepEqual(merged.map((source) => source.url.split('/').pop()), [
    merged[0].url.split('/').pop(),
    'a.mp4',
  ]);
  assert.equal(merged.length, 2);
});

test('episode files land on their own episode, not on the series', () => {
  const seasons = [
    { seasonNumber: 1, episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] },
  ];
  const kept = playback.applyEpisodeReleases(seasons, [
    { ...fileRelease('https://files.test/s01e01.mp4'), id: 'ep1', seasonNumber: 1, episodeNumber: 1 },
    { ...fileRelease('https://files.test/s01e02.mp4'), id: 'ep2', seasonNumber: 1, episodeNumber: 2 },
    { ...fileRelease('https://files.test/pack.zip'), id: 'pack', seasonNumber: 1 },
    { ...fileRelease('https://files.test/extras.mp4'), id: 'extra' },
  ]);

  assert.deepEqual(kept.map((release) => release.id), ['pack', 'extra']);
  assert.equal(seasons[0].episodes[0].releases.length, 1);
  assert.equal(seasons[0].episodes[0].releases[0].id, 'ep1');
  assert.equal(seasons[0].episodes[1].releases[0].id, 'ep2');
});

test('a file whose episode is missing stays at title level instead of vanishing', () => {
  const seasons = [{ seasonNumber: 1, episodes: [{ episodeNumber: 1 }] }];
  const kept = playback.applyEpisodeReleases(seasons, [
    { ...fileRelease('https://files.test/s09e99.mp4'), id: 'orphan', seasonNumber: 9, episodeNumber: 99 },
  ]);
  assert.deepEqual(kept.map((release) => release.id), ['orphan']);
});

/* ----------------------------- ticket signing --------------------------- */

test('the ticket signs play-info/v2 only for a validated numeric subject', () => {
  const route = fs.readFileSync(path.join(SRC, 'app/api/media/exclusive/ticket/route.ts'), 'utf8');
  assert.match(route, /subject-api\/play-info\/v2\?subjectId=\$\{call\.subjectId\}\$\{episodeSuffix\}/);
  assert.match(route, /kind === "detail" \|\| kind === "playback" \|\| kind === "resource"/);
  assert.match(route, /"home" \| "search" \| "detail" \| "playback" \| "resource" \| "login"/);
  // No signing of a caller-supplied URL, ever.
  assert.doesNotMatch(route, /signedCall\([^)]*raw\.(url|path|host)/);
});

test('the removed server resolution route stays removed', () => {
  const dir = path.join(SRC, 'app/api/media/exclusive');
  assert.equal(fs.existsSync(path.join(dir, 'playback')), false, 'no server-side playback endpoint');

  // …and nothing in the app calls it any more.
  const client = fs.readFileSync(path.join(SRC, 'lib/media/exclusiveDirect.ts'), 'utf8');
  assert.doesNotMatch(client, /\/api\/media\/exclusive\/playback/);
});

/* --------------------------- title page wiring --------------------------- */

test('a vault slug never reaches the server provider', () => {
  for (const page of ['movies', 'series']) {
    const source = fs.readFileSync(path.join(SRC, `app/${page}/[slug]/page.tsx`), 'utf8');
    assert.match(source, /isVaultSlug\(decodeURIComponent\(slug\)\)/, `${page} checks the slug prefix`);
    assert.match(source, /ExclusiveDetailPage/, `${page} renders the client-side exclusive page`);

    // The vault branch must return before `load(slug)` runs.
    const branch = source.slice(source.indexOf('isVaultSlug(decodeURIComponent(slug))'));
    const firstReturn = branch.indexOf('return');
    const providerCall = branch.indexOf('await load(slug)');
    assert.ok(firstReturn !== -1, `${page} returns early for a vault slug`);
    assert.ok(
      providerCall === -1 || providerCall > firstReturn,
      `${page} must not call the provider before the vault branch returns`
    );
  }
});

test('the exclusive detail page fetches in the browser and degrades politely', () => {
  const source = fs.readFileSync(path.join(SRC, 'components/media/ExclusiveDetailPage.tsx'), 'utf8');
  assert.match(source, /^"use client";/m);
  assert.match(source, /useExclusiveTitle\(/);
  assert.match(source, /MediaDetailView/);
  assert.match(source, /Retry/);
  assert.doesNotMatch(source, /getMediaDetail|mediaApi\.mediaDetail/);
});

test('the player falls back to the next stream before showing an error', () => {
  const source = fs.readFileSync(path.join(SRC, 'components/exclusive/ExclusivePlayerSheet.tsx'), 'utf8');
  assert.match(source, /failedSourcesRef/);
  assert.match(source, /error\.kind === "network" && nextIndex !== -1/);
  assert.match(source, /switched to another one/);
});
