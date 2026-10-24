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
      const c = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(c)) return loadTs(c);
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    compiled._compile(out, filename);
    return compiled.exports;
  } finally { Module._load = originalLoad; }
}

const { VaultClient } = loadTs('../src/lib/media/vaultClient.ts');
const { VaultMediaProvider } = loadTs('../src/lib/media/vaultProvider.ts');

test('client signs requests and unwraps the data envelope', async () => {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ data: { token: 'tok-123' } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  };
  const client = new VaultClient({ fetchImpl: fakeFetch });
  const token = await client.ensureSession();
  assert.equal(token, 'tok-123');
  const headers = seen[0].init.headers;
  assert.ok(headers['x-client-token']);
  assert.ok(headers['x-tr-signature']);
  assert.equal(headers.authorization, undefined, 'login call must not carry a bearer token');
});

test('client retries the next host on a retryable status', async () => {
  let calls = 0;
  const fakeFetch = async (url) => {
    calls++;
    if (calls === 1) return new Response('nope', { status: 503 });
    return new Response(JSON.stringify({ data: { token: 'tok-abc' } }), { status: 200 });
  };
  const client = new VaultClient({ fetchImpl: fakeFetch });
  assert.equal(await client.ensureSession(), 'tok-abc');
  assert.ok(calls >= 2, 'expected a retry on the next host');
});

test('provider searches, resolves details and lists releases', async () => {
  const prefix = 'https://sbcdn3.hakunaymatata.com/dash/999_0_0_1080_h265_560/';
  const b64 = Buffer.from(prefix, 'utf8').toString('base64');
  const cookie = `Edge-Cache-Cookie=urlprefix=${b64}:sign=abc:t=1`;

  const fakeFetch = async (url, init) => {
    if (url.includes('visitor-login')) {
      return new Response(JSON.stringify({ data: { token: 'tok-xyz' } }), { status: 200 });
    }
    if (url.includes('search/v2')) {
      return new Response(JSON.stringify({ data: { results: { list: [ { subjects: [
        { subjectId: 42, title: 'Dune', subjectType: 1, releaseDate: '2021-09-15',
          cover: { url: 'https://cdn.example.com/dune.jpg' }, genre: ['Action'] }
      ] } ] } } }), { status: 200 });
    }
    if (url.includes('subject-api/get')) {
      return new Response(JSON.stringify({ data: { subject: {
        subjectId: 42, title: 'Dune', subjectType: 1, releaseDate: '2021-09-15',
        description: 'A desert epic.', imdbRatingValue: 8.0, genre: ['Action','Sci-Fi'],
        cover: { url: 'https://cdn.example.com/dune.jpg' } } } }), { status: 200 });
    }
    if (url.includes('play-info')) {
      return new Response(JSON.stringify({ data: { title: 'Dune', streams: [
        { id: '1', format: 'MP4', codecName: 'hevc', size: '2000000000',
          resolutions: '1080,720', url: 'https://macdn.aoneroom.com/other/clip.mp4', signCookie: cookie }
      ] } }), { status: 200 });
    }
    if (url.includes('subject-api/resource')) {
      return new Response(JSON.stringify({ data: { list: [
        { fileName: 'Dune.2021.1080p.mp4', resolution: 1080, size: 2000000000,
          resourceId: 7, resourceLink: 'https://cdn.example.com/Dune.mp4', language: 'English' }
      ] } }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };

  const provider = new VaultMediaProvider(new VaultClient({ fetchImpl: fakeFetch }));

  const titles = await provider.searchTitles('dune', 'all', 10);
  assert.equal(titles.length, 1);
  assert.equal(titles[0].title, 'Dune');
  assert.ok(titles[0].slug.startsWith('vault-42-'));

  const detail = await provider.getMovieDetails(titles[0].slug);
  assert.ok(detail);
  assert.equal(detail.title.title, 'Dune');
  assert.equal(detail.title.rating, 8);
  assert.ok(detail.releases.length >= 2, 'expected dash releases');

  const dash = detail.releases.filter(r => r.mirrors[0].shortUrl.includes('/dash/'));
  assert.ok(dash.length >= 1);
  assert.ok(dash[0].mirrors[0].headers.some(([n]) => n === 'Cookie'), 'signed cookie must be carried');

  const files = detail.releases.filter(r => r.mirrors[0].shortUrl.includes('cdn.example.com'));
  assert.equal(files.length, 1, 'expected the direct download file');
  assert.equal(files[0].quality, '1080p');

  const playback = await provider.getPlaybackSources('movie', titles[0].slug);
  assert.ok(playback.length >= 1);
  assert.equal(playback[0].type, 'dash');
  assert.ok(playback[0].url.includes('/api/media/vault-stream/'));
  assert.ok(!playback[0].url.includes('?'), 'the relay token travels in the path');
});

// --- search aggregation: both catalogues answer every search ---

test('mergeSearchResults appends exclusive titles and drops duplicates', () => {
  const Q = loadTs('../src/lib/media/query.ts');
  const primary = [
    { id: '1', slug: '1-dune', kind: 'movie', title: 'Dune', year: 2021, overview: '', genres: [], language: 'en' },
  ];
  const secondary = [
    { id: '42', slug: 'vault-42-dune-part-two', kind: 'movie', title: 'Dune Part Two', year: 2024, overview: '', genres: [], language: 'en' },
    { id: '1', slug: 'vault-1-dune', kind: 'movie', title: 'Dune', year: 2021, overview: '', genres: [], language: 'en' },
  ];
  const merged = Q.mergeSearchResults(primary, secondary);
  assert.deepEqual(merged.map(i => i.title), ['Dune', 'Dune Part Two']);
  assert.equal(merged[1].slug.startsWith('vault-'), true, 'exclusive titles keep their marker slug');
});

test('mergeSearchResults keeps the primary catalogue intact when the exclusive one is empty', () => {
  const Q = loadTs('../src/lib/media/query.ts');
  const primary = [
    { id: '1', slug: '1-dune', kind: 'movie', title: 'Dune', overview: '', genres: [], language: 'en' },
  ];
  assert.deepEqual(Q.mergeSearchResults(primary, []).map(i => i.title), ['Dune']);
  assert.deepEqual(Q.mergeSearchResults([], primary).map(i => i.title), ['Dune']);
});

test('series episodes get their own signed streams', async () => {
  const prefix = 'https://sbcdn3.hakunaymatata.com/dash/555_0_0_1080_h265_560/';
  const b64 = Buffer.from(prefix, 'utf8').toString('base64');
  const cookie = `Edge-Cache-Cookie=urlprefix=${b64}:sign=abc:t=1`;

  const fakeFetch = async (url) => {
    if (url.includes('visitor-login')) {
      return new Response(JSON.stringify({ data: { token: 'tok-series' } }), { status: 200 });
    }
    if (url.includes('subject-api/get')) {
      return new Response(JSON.stringify({ data: { subject: {
        subjectId: 555, title: 'Some Show', subjectType: 2,
        seasons: { seasons: [ { se: 1, episodeNumbers: [1, 2] } ] },
      } } }), { status: 200 });
    }
    if (url.includes('play-info')) {
      const ep = new URL(url).searchParams.get('ep');
      return new Response(JSON.stringify({ data: { title: 'Some Show', streams: [
        { id: ep, format: 'MP4', codecName: 'hevc', resolutions: '1080',
          url: 'https://macdn.aoneroom.com/other/clip.mp4', signCookie: cookie }
      ] } }), { status: 200 });
    }
    if (url.includes('season-info')) {
      return new Response(JSON.stringify({ data: { seasons: [ { se: 1, episodeNumbers: [1, 2] } ] } }), { status: 200 });
    }
    return new Response(JSON.stringify({ data: { list: [] } }), { status: 200 });
  };

  const provider = new VaultMediaProvider(new VaultClient({ fetchImpl: fakeFetch }));
  const seasons = await provider.getSeriesSeasons('vault-555-some-show', 1);

  assert.equal(seasons.length, 1);
  assert.equal(seasons[0].seasonNumber, 1);
  assert.equal(seasons[0].episodes.length, 2);
  assert.ok(seasons[0].episodes[0].releases.length >= 1, 'episode 1 must have releases');
  assert.ok(seasons[0].episodes[0].releases[0].mirrors[0].shortUrl.includes('/dash/'));
  assert.equal(seasons[0].episodes[0].releases[0].episodeNumber, 1);
  assert.equal(seasons[0].episodes[1].releases[0].episodeNumber, 2);
});
