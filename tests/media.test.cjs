const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

/**
 * The movies/series catalogue maths, demo catalogue and playback guard are all
 * framework-free modules, so they compile and run here without React or a DOM.
 */
function load(relative) {
  const filename = path.resolve(__dirname, relative);
  const compiled = new Module(filename, module);
  compiled._compile(
    ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    filename
  );
  return compiled.exports;
}

const Q = load('../src/lib/media/query.ts');
const D = load('../src/lib/media/demoCatalog.ts');
const P = load('../src/lib/media/playback.ts');

const title = (over) => ({
  id: 'x',
  slug: 'x',
  kind: 'movie',
  title: 'Untitled',
  overview: '',
  genres: [],
  language: 'en',
  ...over,
});

const sample = [
  title({ id: '1', slug: 'a', title: 'Solar Drift', year: 2024, rating: 8.2, popularity: 40, genres: [{ id: 'sci-fi', name: 'Sci-Fi' }], language: 'en' }),
  title({ id: '2', slug: 'b', title: 'Mumbai Rain', year: 2019, rating: 7.1, popularity: 90, genres: [{ id: 'drama', name: 'Drama' }], language: 'hi' }),
  title({ id: '3', slug: 'c', title: 'Ashfall', year: 2012, rating: 6.4, popularity: 10, genres: [{ id: 'drama', name: 'Drama' }], language: 'en' }),
];

/* ------------------------------- matching -------------------------------- */

test('normalize folds diacritics, case and punctuation', () => {
  assert.equal(Q.normalize('  Café  Minuit! '), 'cafe minuit');
  assert.equal(Q.normalize('Amélie'), 'amelie');
  assert.equal(Q.normalize(''), '');
});

test('matchesQuery checks title, genre, overview and year words', () => {
  const item = sample[1];
  item.overview = 'A monsoon story';
  assert.equal(Q.matchesQuery(item, 'mumbai'), true);
  assert.equal(Q.matchesQuery(item, 'drama'), true);
  assert.equal(Q.matchesQuery(item, 'monsoon'), true);
  assert.equal(Q.matchesQuery(item, '2019'), true);
  assert.equal(Q.matchesQuery(item, 'mumbai rain'), true);
  assert.equal(Q.matchesQuery(item, 'mumbai space'), false);
  assert.equal(Q.matchesQuery(item, ''), true);
});

test('matchesYear handles exact years, decades and missing years', () => {
  assert.equal(Q.matchesYear(2024, '2024'), true);
  assert.equal(Q.matchesYear(2024, '2019'), false);
  assert.equal(Q.matchesYear(2024, '2020s'), true);
  assert.equal(Q.matchesYear(2019, '2020s'), false);
  assert.equal(Q.matchesYear(undefined, '2020s'), false);
  assert.equal(Q.matchesYear(undefined, undefined), true);
});

test('filterTitles combines genre, language, year and free text', () => {
  assert.equal(Q.filterTitles(sample, {}).length, 3);
  assert.equal(Q.filterTitles(sample, { genre: 'drama' }).length, 2);
  assert.equal(Q.filterTitles(sample, { language: 'hi' })[0].slug, 'b');
  assert.equal(Q.filterTitles(sample, { year: '2010s' }).length, 2);
  assert.equal(Q.filterTitles(sample, { q: 'solar' })[0].slug, 'a');
  assert.equal(Q.filterTitles(sample, { genre: 'drama', language: 'en' }).length, 1);
});

/* -------------------------------- sorting -------------------------------- */

test('sortTitles orders by each supported key', () => {
  assert.deepEqual(Q.sortTitles(sample, 'rating').map((t) => t.slug), ['a', 'b', 'c']);
  assert.deepEqual(Q.sortTitles(sample, 'newest').map((t) => t.slug), ['a', 'b', 'c']);
  assert.deepEqual(Q.sortTitles(sample, 'oldest').map((t) => t.slug), ['c', 'b', 'a']);
  assert.deepEqual(Q.sortTitles(sample, 'title').map((t) => t.slug), ['c', 'b', 'a']);
  assert.deepEqual(Q.sortTitles(sample, 'trending').map((t) => t.slug), ['b', 'a', 'c']);
  assert.deepEqual(sample.map((t) => t.slug), ['a', 'b', 'c'], 'input order is untouched');
});

/* ------------------------------- pagination ------------------------------ */

test('queryTitles paginates, clamps the page and reports totals', () => {
  const many = Array.from({ length: 30 }, (_, i) => title({ id: String(i), slug: `s${i}`, title: `Title ${i}`, year: 1999, popularity: i }));
  const first = Q.queryTitles(many, { page: 1 }, 12);
  assert.equal(first.items.length, 12);
  assert.equal(first.totalPages, 3);
  assert.equal(first.totalResults, 30);

  const last = Q.queryTitles(many, { page: 99 }, 12);
  assert.equal(last.page, 3);
  assert.equal(last.items.length, 6);

  const clamped = Q.queryTitles(many, { page: 0 }, 12);
  assert.equal(clamped.page, 1);

  const filtered = Q.queryTitles(many, { q: 'title 2', sort: 'title' }, 12);
  assert.equal(filtered.totalResults, 12);
});

test('default page size is 24', () => {
  assert.equal(Q.PAGE_SIZE, 24);
  assert.deepEqual(Q.SORTS.map((s) => s.id), ['trending', 'newest', 'rating', 'oldest', 'title']);
});

/* -------------------------------- facets --------------------------------- */

test('buildFacets dedupes genres, sorts years newest first and collects languages', () => {
  const facets = Q.buildFacets([
    ...sample,
    title({ id: '4', slug: 'd', title: 'Other', year: 2024, genres: [{ id: 'drama', name: 'Drama' }], language: 'ja', languageName: 'Japanese' }),
  ]);
  assert.deepEqual(facets.genres.map((g) => g.id), ['drama', 'sci-fi']);
  assert.deepEqual(facets.years, [2024, 2019, 2012]);
  assert.deepEqual(facets.languages.map((l) => l.code), ['en', 'hi', 'ja']);
});

/* ----------------------------- recommendations --------------------------- */

test('relatedTitles ranks by shared genre and language, never returns the title itself', () => {
  const related = Q.relatedTitles(sample, sample[0], 5);
  assert.deepEqual(related.map((t) => t.slug), []);
  const catalog = [
    sample[0],
    title({ id: '5', slug: 'e', title: 'Orbit Two', year: 2023, rating: 7.4, genres: [{ id: 'sci-fi', name: 'Sci-Fi' }], language: 'en' }),
    sample[1],
  ];
  const picked = Q.relatedTitles(catalog, catalog[0], 5);
  assert.equal(picked.length, 1);
  assert.equal(picked[0].slug, 'e');
  assert.deepEqual(
    Q.relatedTitles(catalog, catalog[0], 5).map((t) => t.slug),
    Q.relatedTitles(catalog, catalog[0], 5).map((t) => t.slug)
  );
});

test('railsFor drops empty rails', () => {
  const rails = Q.railsFor('movie', { trending: [sample[0]], recent: [], topRated: [sample[2]], popular: [] });
  assert.deepEqual(rails.map((r) => r.id), ['trending', 'top']);
});

/* --------------------------------- slugs --------------------------------- */

test('slug helpers produce provider-safe, reversible slugs', () => {
  assert.equal(Q.slugify('The Longest Ferry!'), 'the-longest-ferry');
  assert.equal(Q.slugify('Café Minuit'), 'cafe-minuit');
  assert.equal(Q.slugify(''), 'untitled');
  assert.equal(Q.mediaSlug(603692, 'John Wick: Chapter 4'), '603692-john-wick-chapter-4');
  assert.equal(Q.idFromSlug('603692-john-wick-chapter-4'), '603692');
  assert.equal(Q.idFromSlug('custom-slug'), 'custom-slug');
  assert.equal(Q.titleFromSlug('603692-john-wick-chapter-4'), 'John Wick Chapter 4');
});

/* ----------------------------- demo catalogue ---------------------------- */

test('demo catalogue is clearly marked, unique and internally consistent', () => {
  const all = D.demoCatalog();
  assert.equal(D.DEMO_MOVIES.length, 20);
  assert.equal(D.DEMO_SERIES.length, 10);
  assert.equal(all.length, 30);
  assert.equal(new Set(all.map((t) => `${t.kind}:${t.slug}`)).size, all.length);
  for (const item of all) {
    assert.equal(item.demo, true, `${item.slug} must be marked demo`);
    assert.ok(item.overview.length > 20, `${item.slug} needs an overview`);
    assert.ok(item.genres.length > 0, `${item.slug} needs a genre`);
    assert.ok(item.languageName, `${item.slug} needs a language name`);
    assert.ok(item.year >= 2010, `${item.slug} needs a year`);
    assert.ok(typeof item.popularity === 'number');
    assert.equal(item.trailer, undefined, 'demo entries hold no external trailer keys');
    assert.equal(item.poster, undefined, 'demo entries hold no remote artwork');
  }
  assert.equal(D.DEMO_MOVIES.every((m) => m.kind === 'movie'), true);
  assert.equal(D.DEMO_SERIES.every((s) => s.kind === 'series'), true);
});

test('every demo series has a season layout matching its episode count', () => {
  for (const show of D.DEMO_SERIES) {
    const layout = D.DEMO_SEASON_LAYOUT[show.slug];
    assert.ok(Array.isArray(layout), `${show.slug} needs a season layout`);
    assert.equal(layout.length, show.seasonCount);
    assert.equal(layout.reduce((a, b) => a + b, 0), show.episodeCount);
  }
});

test('demoSeasons builds sequential, unique, deterministic episodes', () => {
  const show = D.DEMO_SERIES[0];
  const seasons = D.demoSeasons(show);
  assert.equal(seasons.length, show.seasonCount);
  assert.deepEqual(seasons, D.demoSeasons(show), 'same input, same seasons');

  const ids = new Set();
  for (const season of seasons) {
    const expected = D.DEMO_SEASON_LAYOUT[show.slug][season.seasonNumber - 1];
    assert.equal(season.episodes.length, expected);
    season.episodes.forEach((episode, index) => {
      assert.equal(episode.seasonNumber, season.seasonNumber);
      assert.equal(episode.episodeNumber, index + 1);
      assert.ok(episode.title.length > 0);
      assert.ok(!ids.has(episode.id), `duplicate episode id ${episode.id}`);
      ids.add(episode.id);
    });
  }
});

/* ---------------------------- playback manifest -------------------------- */

test('authorized playback accepts only HTTPS HLS/MP4 sources', () => {
  assert.deepEqual(P.sanitizePlaybackSource({ url: 'https://cdn.example.com/a/master.m3u8' }), {
    url: 'https://cdn.example.com/a/master.m3u8',
    type: 'hls',
    label: undefined,
  });
  assert.equal(P.sanitizePlaybackSource({ url: 'https://cdn.example.com/a.mp4' }).type, 'mp4');
  assert.equal(P.sanitizePlaybackSource({ url: 'https://cdn.example.com/a.m3u8', type: 'hls', label: 'HD' }).label, 'HD');
  assert.equal(P.sanitizePlaybackSource({ url: 'http://cdn.example.com/a.mp4' }), null, 'plain http is refused');
  assert.equal(P.sanitizePlaybackSource({ url: 'https://cdn.example.com/a.mkv' }), null);
  assert.equal(P.sanitizePlaybackSource({ url: '/local/file.mp4' }), null);
  // An unrecognised `type` still falls back to the URL extension rather than guessing DASH.
  assert.equal(P.sanitizePlaybackSource({ url: 'https://cdn.example.com/a.m3u8', type: 'dash' }).type, 'hls');
  assert.equal(P.sanitizePlaybackSource(null), null);
  assert.equal(P.sanitizePlaybackSource('https://cdn.example.com/a.mp4'), null);
});

test('manifest parsing drops bad entries and survives invalid JSON', () => {
  const manifest = P.parsePlaybackManifest(
    JSON.stringify({
      'movie/neon-monsoon': [{ url: 'https://cdn.example.com/neon.m3u8', type: 'hls' }, { url: 'http://insecure/a.mp4' }],
      'series/the-archive': [{ url: 'nope' }],
      broken: 'not an array',
    })
  );
  assert.deepEqual(Object.keys(manifest), ['movie/neon-monsoon']);
  assert.equal(manifest['movie/neon-monsoon'].length, 1);
  assert.deepEqual(P.parsePlaybackManifest(undefined), {});
  assert.deepEqual(P.parsePlaybackManifest('{not json'), {});
});
