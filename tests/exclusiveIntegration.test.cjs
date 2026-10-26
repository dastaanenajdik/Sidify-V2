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
      for (const ext of ['.ts', '.js']) {
        const candidate = path.resolve(path.dirname(parent.filename), `${request}${ext}`);
        if (fs.existsSync(candidate)) return loadTs(path.relative(__dirname, candidate));
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    compiled._compile(out, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const { VaultClient } = loadTs('../src/lib/media/vaultClient.ts');
const { VaultMediaProvider } = loadTs('../src/lib/media/vaultProvider.ts');
const exclusive = loadTs('../src/lib/media/exclusive.ts');

/* ------------------------------- fixtures -------------------------------- */

const SUBJECTS = [
  {
    subjectId: 101,
    title: 'Night Train',
    subjectType: 1,
    releaseDate: '2025-03-01',
    genre: ['Thriller', 'Drama'],
    imdbRatingValue: 8.4,
    imdbVoteCount: 210000,
    lanName: 'English',
    cover: { url: 'https://img.test/101.jpg' },
    stars: ['Asha Rao', 'Vikram Sen'],
    director: 'Meera Kapoor',
    audios: ['Hindi', 'English'],
    prints: ['1080p', '2160p'],
    duration: 7260,
  },
  {
    subjectId: 102,
    title: 'Night Train Returns',
    subjectType: 1,
    releaseDate: '2023-05-10',
    genre: ['Thriller', 'Action'],
    imdbRatingValue: 6.6,
    lanName: 'English',
    cover: { url: 'https://img.test/102.jpg' },
  },
  {
    subjectId: 103,
    title: 'City of Dust',
    subjectType: 2,
    releaseDate: '2024-01-12',
    genre: ['Drama', 'Crime'],
    imdbRatingValue: 8.9,
    lanName: 'Hindi',
    cover: { url: 'https://img.test/103.jpg' },
    season: 2,
  },
  {
    subjectId: 104,
    title: 'Old Harbour',
    subjectType: 1,
    releaseDate: '1998-09-20',
    genre: ['Drama'],
    imdbRatingValue: 7.8,
    lanName: 'English',
    cover: { url: 'https://img.test/104.jpg' },
  },
  {
    subjectId: 105,
    title: 'Quiet Orbit',
    subjectType: 1,
    releaseDate: '2021-11-02',
    genre: ['Science Fiction'],
    imdbRatingValue: 6.0,
    lanName: 'English',
    cover: { url: 'https://img.test/105.jpg' },
  },
  {
    subjectId: 106,
    title: 'Dust and Rain',
    subjectType: 2,
    releaseDate: '2022-08-08',
    genre: ['Drama'],
    imdbRatingValue: 7.6,
    lanName: 'Tamil',
    cover: { url: 'https://img.test/106.jpg' },
  },
];

const HOMEPAGE = {
  data: {
    items: [
      { banner: { banners: [{ subject: SUBJECTS[0] }] } },
      { customData: { items: [{ subject: SUBJECTS[2] }] } },
      { subjects: SUBJECTS.slice(1, 6) },
    ],
  },
};

const DETAILS = {
  data: {
    subject: {
      ...SUBJECTS[0],
      description: 'A conductor finds a passenger who should not exist.',
      seasons: { seasons: [] },
    },
  },
};

const PLAY_INFO = {
  data: {
    title: 'Night Train',
    streams: [
      {
        id: 1,
        format: 'MP4',
        codecName: 'H264',
        size: 4_000_000_000,
        resolutions: '1080,720',
        signCookie: '',
        url: 'https://cdn.test/dash/101/index.mpd',
      },
    ],
  },
};

const RESOURCE = {
  data: {
    list: [
      {
        id: 201,
        fileName: 'Night.Train.2025.1080p.mp4',
        resolution: 1080,
        size: 2_000_000_000,
        resourceLink: 'https://files.test/night-train-1080.mp4',
        language: 'Hindi',
      },
      {
        id: 202,
        fileName: 'Night.Train.2025.2160p.mkv',
        resolution: 2160,
        size: 9_000_000_000,
        resourceLink: 'https://files.test/night-train-2160.mkv',
        language: 'Hindi',
      },
    ],
  },
};

function makeProvider() {
  const fakeFetch = async (url, init) => {
    const href = String(url);
    const json = (payload) => new Response(JSON.stringify(payload), { status: 200 });
    if (href.includes('visitor-login')) return json({ data: { token: 'tok' } });
    if (href.includes('tab-operating')) return json(HOMEPAGE);
    if (href.includes('subject-api/search/v2')) {
      let keyword = '';
      try {
        keyword = String(JSON.parse(String(init?.body || '{}')).keyword || '');
      } catch {
        keyword = '';
      }
      const matches = SUBJECTS.filter((subject) => subject.title.toLowerCase().includes(keyword.toLowerCase()));
      return json({ data: { results: [{ subjects: matches }] } });
    }
    if (href.includes('subject-api/get')) {
      const id = Number(href.match(/subjectId=(\d+)/)?.[1] || 0);
      const subject = SUBJECTS.find((entry) => entry.subjectId === id) || SUBJECTS[0];
      return json({ data: { subject: { ...subject, description: 'Fixture synopsis.', seasons: { seasons: [] } } } });
    }
    if (href.includes('play-info')) return json(PLAY_INFO);
    if (href.includes('subject-api/resource')) return json(RESOURCE);
    if (href.includes('season-info')) return json({ data: { seasons: [] } });
    return new Response('{}', { status: 404 });
  };
  return new VaultMediaProvider(new VaultClient({ fetchImpl: fakeFetch }));
}

exclusive.clearExclusiveCache();

/* --------------------------------- tests --------------------------------- */

test('the landing payload is assembled from one cached listing', async () => {
  const provider = makeProvider();
  const home = await exclusive.getExclusiveHome('all', provider);

  assert.equal(home.mode, 'home');
  assert.equal(home.provider.id, 'vault');
  assert.equal(home.total, SUBJECTS.length);
  assert.ok(home.spotlight, 'a spotlight is present');
  assert.equal(home.spotlight.title, 'City of Dust', 'the best-rated title is featured');

  const ids = home.rails.map((rail) => rail.id);
  for (const id of ['trending', 'top10', 'new-releases', 'films', 'series', 'acclaimed', 'classics']) {
    assert.ok(ids.includes(id), `missing rail ${id}`);
  }

  assert.ok(home.facets.genres.some((genre) => genre.id === 'thriller'));
  assert.ok(home.facets.years.includes(2025));
  assert.ok(home.facets.languages.some((language) => language.code === 'hi'));

  // The listing is cached: a second call must not fetch again.
  const callsBefore = provider.__calls || 0;
  await exclusive.getExclusiveHome('all', provider);
  assert.equal(provider.__calls || 0, callsBefore, 'the home payload is served from cache');
});

test('search filters, sorts and clamps out-of-range pages', async () => {
  const provider = makeProvider();

  const movies = await exclusive.searchExclusiveCatalogue({ kind: 'movie' }, provider);
  assert.ok(movies.items.length > 0);
  assert.ok(movies.items.every((item) => item.kind === 'movie'));

  const thrillers = await exclusive.searchExclusiveCatalogue({ genre: 'thriller', sort: 'rating' }, provider);
  assert.deepEqual(thrillers.items.map((item) => item.title), ['Night Train', 'Night Train Returns']);

  const nineties = await exclusive.searchExclusiveCatalogue({ year: '1998' }, provider);
  assert.deepEqual(nineties.items.map((item) => item.title), ['Old Harbour']);

  const hindi = await exclusive.searchExclusiveCatalogue({ language: 'hi' }, provider);
  assert.deepEqual(hindi.items.map((item) => item.title), ['City of Dust']);

  const keyword = await exclusive.searchExclusiveCatalogue({ q: 'dust' }, provider);
  assert.deepEqual(keyword.items.map((item) => item.title).sort(), ['City of Dust', 'Dust and Rain']);

  const clamped = await exclusive.searchExclusiveCatalogue({ page: 99 }, provider);
  assert.equal(clamped.page, clamped.totalPages, 'a page past the end clamps to the last page');
  assert.ok(clamped.items.length > 0, 'a clamped page is never empty');

  const publicPage = exclusive.toPublicSearchPage(keyword);
  assert.equal('pool' in publicPage, false);
  assert.equal(typeof publicPage.tookMs, 'number');
});

test('suggestions come from the collection listing', async () => {
  const provider = makeProvider();
  const result = await exclusive.suggestExclusive('night', 8, provider);
  assert.deepEqual(result.items.map((item) => item.title), ['Night Train', 'Night Train Returns']);
  assert.ok(result.items.every((item) => item.slug.startsWith('vault-')));
});

test('a title carries cast, audio languages, playback and recommendations', async () => {
  const provider = makeProvider();
  const payload = await exclusive.getExclusiveTitle('vault-101-night-train', 'movie', provider);
  assert.ok(payload, 'the title resolves');
  const { detail, recommendations } = payload;

  assert.equal(detail.title.title, 'Night Train');
  assert.deepEqual(detail.title.cast, ['Asha Rao', 'Vikram Sen']);
  assert.deepEqual(detail.title.director, ['Meera Kapoor']);
  assert.deepEqual(detail.title.audioLanguages, ['Hindi', 'English']);
  assert.equal(detail.title.quality, '2160p', 'the highest advertised print wins');
  assert.equal(detail.title.runtimeMinutes, 121);

  assert.ok(detail.playback.length >= 2, 'DASH plus the direct MP4');
  const dash = detail.playback.find((source) => source.type === 'dash');
  assert.ok(dash, 'a DASH source exists');
  assert.ok(dash.url.startsWith('/api/media/vault-stream/'), 'the manifest goes through the same-origin relay');
  assert.ok(
    detail.playback.some((source) => source.type === 'mp4' && source.url.endsWith('.mp4')),
    'a direct MP4 is playable'
  );
  assert.ok(
    detail.playback.every((source) => !source.url.endsWith('.mkv')),
    'MKV stays download-only'
  );

  assert.ok(recommendations.length > 0);
  assert.ok(recommendations.every((item) => item.slug !== detail.title.slug));
  assert.equal(recommendations[0].title, 'Night Train Returns', 'shared genres rank first');
});

test('a series resolves through the same contract', async () => {
  const provider = makeProvider();
  const payload = await exclusive.getExclusiveTitle('vault-103-city-of-dust', 'series', provider);
  assert.ok(payload);
  assert.equal(payload.detail.title.kind, 'series');
  assert.equal(payload.detail.title.title, 'City of Dust');
});
