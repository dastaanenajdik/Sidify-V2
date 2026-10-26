const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const moduleCache = new Map();

function loadTs(targetPath) {
  const filename = path.isAbsolute(targetPath) ? targetPath : path.resolve(__dirname, targetPath);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;
  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  moduleCache.set(filename, compiled);

  const originalLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request.startsWith('.') && parent && parent.filename) {
      for (const ext of ['.ts', '.tsx', '.js']) {
        const candidate = path.resolve(path.dirname(parent.filename), `${request}${ext}`);
        if (fs.existsSync(candidate)) return loadTs(candidate);
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    compiled._compile(out, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const recommend = loadTs('../src/lib/media/recommend.ts');
const exclusive = loadTs('../src/lib/media/exclusive.ts');

const PROVIDER = { id: 'vault', label: 'Vault', demo: false };

function title(overrides) {
  return {
    id: String(overrides.id ?? 1),
    slug: `vault-${overrides.id ?? 1}-${(overrides.title ?? 'untitled').toLowerCase().replace(/\s+/g, '-')}`,
    kind: 'movie',
    title: 'Untitled',
    overview: '',
    genres: [],
    language: 'en',
    languageName: 'English',
    ...overrides,
  };
}

/** A small but varied pool: films + series, several genres, years, languages. */
const POOL = [
  title({
    id: 1,
    title: 'Night Train',
    kind: 'movie',
    year: 2025,
    rating: 8.4,
    votes: 240000,
    popularity: 95,
    genres: [{ id: 'thriller', name: 'Thriller' }, { id: 'drama', name: 'Drama' }],
    poster: 'https://img/1.jpg',
    backdrop: 'https://img/1b.jpg',
    quality: '2160p',
    runtimeMinutes: 121,
    cast: ['Asha Rao', 'Vikram Sen'],
    director: ['Meera Kapoor'],
  }),
  title({
    id: 2,
    title: 'Night Train Returns',
    kind: 'movie',
    year: 2023,
    rating: 6.8,
    votes: 42000,
    popularity: 60,
    genres: [{ id: 'thriller', name: 'Thriller' }, { id: 'action', name: 'Action' }],
    poster: 'https://img/2.jpg',
  }),
  title({
    id: 3,
    title: 'City of Dust',
    kind: 'series',
    year: 2024,
    rating: 8.9,
    votes: 510000,
    popularity: 88,
    genres: [{ id: 'drama', name: 'Drama' }, { id: 'crime', name: 'Crime' }],
    language: 'hi',
    languageName: 'Hindi',
    poster: 'https://img/3.jpg',
  }),
  title({
    id: 4,
    title: 'Old Harbour',
    kind: 'movie',
    year: 1998,
    rating: 7.9,
    votes: 90000,
    popularity: 30,
    genres: [{ id: 'drama', name: 'Drama' }],
    poster: 'https://img/4.jpg',
  }),
  title({
    id: 5,
    title: 'Quiet Orbit',
    kind: 'movie',
    year: 2021,
    rating: 6.1,
    votes: 8000,
    popularity: 20,
    genres: [{ id: 'science-fiction', name: 'Science Fiction' }],
    poster: 'https://img/5.jpg',
  }),
  title({
    id: 6,
    title: 'Dust and Rain',
    kind: 'series',
    year: 2022,
    rating: 7.6,
    votes: 61000,
    popularity: 55,
    genres: [{ id: 'drama', name: 'Drama' }],
    language: 'ta',
    languageName: 'Tamil',
    poster: 'https://img/6.jpg',
  }),
];

test('the landing payload carries a spotlight, a stable order and every rail type', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  const home = exclusive.buildExclusiveHome(POOL, PROVIDER, now);

  assert.equal(home.mode, 'home');
  assert.ok(home.spotlight, 'a spotlight is required');
  assert.equal(home.spotlight.title, 'City of Dust', 'the best-rated title wins the spotlight');

  const ids = home.rails.map((rail) => rail.id);
  for (const expected of ['trending', 'top10', 'new-releases', 'films', 'series', 'acclaimed', 'classics']) {
    assert.ok(ids.includes(expected), `missing rail: ${expected}`);
  }

  const top10 = home.rails.find((rail) => rail.id === 'top10');
  assert.equal(top10.layout, 'ranked');
  assert.ok(top10.items.length <= 10);
  assert.ok(top10.items[0].rating >= top10.items[1].rating, 'Top 10 is ordered by rating');

  const films = home.rails.find((rail) => rail.id === 'films');
  assert.ok(films.items.every((item) => item.kind === 'movie'), 'the films rail contains only films');

  const series = home.rails.find((rail) => rail.id === 'series');
  assert.ok(series.items.every((item) => item.kind === 'series'), 'the series rail contains only series');

  const classics = home.rails.find((rail) => rail.id === 'classics');
  assert.ok(classics.items.every((item) => item.year < 2016), 'classics are older than ten years');

  assert.equal(home.total, POOL.length, 'total counts deduplicated titles');
  assert.ok(home.facets.genres.some((genre) => genre.id === 'thriller'));
  assert.ok(home.facets.years.includes(2025));
  assert.ok(home.facets.years.includes('2020s'));
  assert.ok(home.facets.languages.some((language) => language.code === 'ta'));
});

test('the same pool always assembles the same landing page', () => {
  const now = new Date('2026-10-26T00:00:00Z');
  const first = exclusive.buildExclusiveHome(POOL, PROVIDER, now);
  const second = exclusive.buildExclusiveHome(POOL.slice().reverse(), PROVIDER, now);
  assert.deepEqual(
    first.rails.find((rail) => rail.id === 'top10').items.map((item) => item.title),
    second.rails.find((rail) => rail.id === 'top10').items.map((item) => item.title),
    'tie-breaks must not depend on input order'
  );
});

test('filters narrow by kind, genre, year, decade and language', () => {
  assert.deepEqual(
    recommend.filterTitles(POOL, { kind: 'series' }).map((item) => item.title).sort(),
    ['City of Dust', 'Dust and Rain']
  );
  assert.deepEqual(
    recommend.filterTitles(POOL, { genre: 'thriller' }).map((item) => item.title),
    ['Night Train', 'Night Train Returns']
  );
  assert.deepEqual(
    recommend.filterTitles(POOL, { year: '1998' }).map((item) => item.title),
    ['Old Harbour']
  );
  assert.deepEqual(
    recommend.filterTitles(POOL, { year: '2020s' }).map((item) => item.title).sort(),
    ['City of Dust', 'Dust and Rain', 'Night Train', 'Night Train Returns', 'Quiet Orbit']
  );
  assert.deepEqual(
    recommend.filterTitles(POOL, { language: 'hi' }).map((item) => item.title),
    ['City of Dust']
  );
  assert.deepEqual(
    recommend.filterTitles(POOL, { q: 'dust' }).map((item) => item.title).sort(),
    ['City of Dust', 'Dust and Rain']
  );
  assert.equal(recommend.filterTitles(POOL, {}).length, POOL.length, 'an empty filter is a no-op');
});

test('every sort order is total and deterministic', () => {
  const newest = recommend.sortTitles(POOL, 'newest').map((item) => item.year);
  assert.deepEqual(newest, [...newest].sort((a, b) => b - a));

  const oldest = recommend.sortTitles(POOL, 'oldest').map((item) => item.year);
  assert.deepEqual(oldest, [...oldest].sort((a, b) => a - b));

  const byRating = recommend.sortTitles(POOL, 'rating').map((item) => item.rating ?? 0);
  assert.deepEqual(byRating, [...byRating].sort((a, b) => b - a));

  const alpha = recommend.sortTitles(POOL, 'title').map((item) => item.title);
  assert.deepEqual(alpha, [...alpha].sort((a, b) => a.localeCompare(b)));

  const trending = recommend.sortTitles(POOL, 'trending').map((item) => item.title);
  assert.deepEqual(trending, recommend.sortTitles(POOL.slice().reverse(), 'trending').map((item) => item.title));
});

test('recommendations share genres, exclude the seed and respect the limit', () => {
  const seed = POOL[0];
  const related = recommend.recommendTitles(seed, POOL, 3);
  assert.ok(related.length > 0 && related.length <= 3);
  assert.ok(related.every((item) => item.slug !== seed.slug), 'the seed is never recommended to itself');
  assert.equal(related[0].title, 'Night Train Returns', 'the shared-thriller title comes first');

  const seriesSeed = POOL[2];
  const seriesRelated = recommend.recommendTitles(seriesSeed, POOL, 3);
  assert.ok(seriesRelated.every((item) => item.slug !== seriesSeed.slug));
  assert.ok(seriesRelated.some((item) => item.kind === 'series' || item.genres.some((g) => g.id === 'drama')));
});

test('the catalogue layer never imports the main catalogue', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src/lib/media/exclusive.ts'), 'utf8');
  assert.doesNotMatch(source, /from "\.\/service"/, 'exclusive.ts must not depend on the service (main catalogue) module');
  assert.doesNotMatch(source, /getMediaProvider/);
  assert.match(source, /getVaultProvider/);
});

test('the exclusive APIs expose home, search, title and suggest contracts', () => {
  const route = fs.readFileSync(path.join(ROOT, 'src/app/api/media/exclusive/route.ts'), 'utf8');
  assert.match(route, /getExclusiveHome/);
  assert.match(route, /searchExclusiveCatalogue/);
  assert.match(route, /toPublicSearchPage/);
  assert.doesNotMatch(route, /searchMedia\(/);
  assert.doesNotMatch(route, /getMediaProvider\(/);
  assert.match(route, /Math\.min\(60/, 'the page size is capped');

  const titleRoute = fs.readFileSync(
    path.join(ROOT, 'src/app/api/media/exclusive/title/[slug]/route.ts'),
    'utf8'
  );
  assert.match(titleRoute, /getExclusiveTitle/);
  assert.match(titleRoute, /recommendations/);

  const suggestRoute = fs.readFileSync(
    path.join(ROOT, 'src/app/api/media/exclusive/suggest/route.ts'),
    'utf8'
  );
  assert.match(suggestRoute, /suggestExclusive/);
});

test('direct files become playback sources, but MKV and archives never do', () => {
  const detail = {
    title: POOL[0],
    seasons: [],
    related: [],
    playback: [{ url: 'https://cdn/relay/dash', type: 'dash', label: '1080p' }],
    releases: [
      {
        id: 'r1',
        title: 'Night Train 1080p',
        fileName: 'Night.Train.1080p.mp4',
        container: 'mp4',
        quality: '1080p',
        mirrors: [{ id: 'm1', label: 'Direct', shortUrl: 'https://cdn/x/file.mp4', host: 'cdn' }],
      },
      {
        id: 'r2',
        title: 'Night Train 2160p',
        fileName: 'Night.Train.2160p.mkv',
        container: 'mkv',
        quality: '2160p',
        mirrors: [{ id: 'm2', label: 'Direct', shortUrl: 'https://cdn/x/file.mkv', host: 'cdn' }],
      },
      {
        id: 'r3',
        title: 'Season pack',
        fileName: 'Season.zip',
        container: 'zip',
        isPack: true,
        mirrors: [{ id: 'm3', label: 'Direct', shortUrl: 'https://cdn/x/pack.zip', host: 'cdn' }],
      },
      {
        id: 'r4',
        title: 'HLS',
        fileName: 'stream.m3u8',
        container: 'm3u8',
        quality: '720p',
        mirrors: [{ id: 'm4', label: 'Direct', shortUrl: 'https://cdn/x/live.m3u8', host: 'cdn' }],
      },
    ],
    provider: PROVIDER,
  };

  const sources = exclusive.playableFromResources(detail);
  assert.deepEqual(
    sources.map((source) => source.type),
    ['mp4', 'hls'],
    'only browser-playable direct files are added'
  );
  assert.ok(sources.every((source) => !source.url.endsWith('.mkv')));
  assert.ok(sources.every((source) => !source.url.endsWith('.zip')));
});

test('public search pages never leak the internal ranking pool', () => {
  const page = exclusive.toPublicSearchPage({
    mode: 'search',
    query: 'night',
    items: [POOL[0]],
    pool: POOL,
    page: 1,
    totalPages: 1,
    totalResults: 1,
    pageSize: 24,
    filters: { kind: 'all', sort: 'trending' },
    facets: { genres: [], years: [], languages: [] },
    genres: [],
    provider: PROVIDER,
    tookMs: 3,
  });
  assert.equal('pool' in page, false, 'the pool is server-side only');
  assert.equal(page.items.length, 1);
});
