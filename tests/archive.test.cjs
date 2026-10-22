const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

/**
 * The Internet Archive adapter's framework-free half: slug handling, document → title
 * mapping, Lucene query building and the offline snapshot. No network, no React.
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

const A = load('../src/lib/media/archive.ts');

/* --------------------------------- slugs --------------------------------- */

test('archive slugs round-trip and cannot escape the identifier path', () => {
  assert.equal(A.archiveSlug('his_girl_friday'), 'ia-his_girl_friday');
  assert.equal(A.archiveIdentifier('ia-his_girl_friday'), 'his_girl_friday');
  assert.equal(A.archiveIdentifier('ia-his_girl_friday'.toUpperCase()), null, 'prefix is case-sensitive');
  assert.equal(A.archiveIdentifier('603692-john-wick'), null);
  assert.equal(A.archiveIdentifier('ia-'), null);
  assert.equal(A.archiveIdentifier('ia-../../etc/passwd'), null);
  assert.equal(A.isArchiveSlug('ia-Escape_From_Sobibor.avi'), true);
  assert.equal(A.archiveIdentifier(encodeURIComponent('ia-Great_Guy.avi')), 'Great_Guy.avi');
});

test('archive URLs are https and scoped to archive.org', () => {
  assert.equal(A.archivePosterUrl('a b'), 'https://archive.org/services/img/a%20b');
  assert.equal(A.archiveEmbedUrl('x'), 'https://archive.org/embed/x');
  assert.equal(A.archiveDownloadUrl('x'), 'https://archive.org/download/x');
  assert.equal(A.archiveDetailsUrl('x'), 'https://archive.org/details/x');

  const sources = A.archivePlaybackSources('his_girl_friday');
  assert.equal(sources.length, 1);
  assert.equal(sources[0].type, 'embed');
  assert.equal(new URL(sources[0].url).origin, 'https://archive.org');
});

/* -------------------------------- mapping -------------------------------- */

const doc = {
  identifier: 'CarnivalofSouls',
  title: ['Carnival of Souls'],
  year: '1962',
  description: '<p>Herk Harvey&rsquo;s cult horror about a woman drawn to an empty pavilion.</p>',
  genre: ['Horror', 'Mystery', 'Horror'],
  language: 'eng',
  runtime: '01:18:00',
  downloads: 473137,
  avg_rating: 4.34,
};

test('archive documents map onto MediaTitle without inventing data', () => {
  const title = A.archiveDocToTitle(doc);
  assert.equal(title.id, 'CarnivalofSouls');
  assert.equal(title.slug, 'ia-CarnivalofSouls');
  assert.equal(title.kind, 'movie');
  assert.equal(title.title, 'Carnival of Souls');
  assert.equal(title.year, 1962);
  assert.equal(title.language, 'en');
  assert.equal(title.languageName, 'English');
  assert.equal(title.runtimeMinutes, 78);
  assert.equal(title.rating, 8.7, '5-star archive rating is rescaled to 10');
  assert.equal(title.popularity, 473137);
  assert.equal(title.free, true);
  assert.equal(title.demo, false);
  assert.equal(title.poster, 'https://archive.org/services/img/CarnivalofSouls');
  assert.equal(title.officialUrl, 'https://archive.org/details/CarnivalofSouls');
  assert.deepEqual(
    title.genres.map((g) => g.id),
    ['horror', 'mystery']
  );
  assert.ok(title.overview.startsWith('Herk Harvey'), 'HTML is stripped');
  assert.ok(!title.overview.includes('<'));
});

test('documents without an identifier or title are rejected', () => {
  assert.equal(A.archiveDocToTitle({ title: 'No id' }), null);
  assert.equal(A.archiveDocToTitle({ identifier: 'x' }), null);
  assert.equal(A.archiveDocToTitle({ identifier: 'x', title: '   ' }), null);
});

test('years, runtimes and languages are parsed defensively', () => {
  assert.equal(A.parseArchiveYear('1940-01-11'), 1940);
  assert.equal(A.parseArchiveYear(1938), 1938);
  assert.equal(A.parseArchiveYear('19xx'), undefined);
  assert.equal(A.parseArchiveYear('3000'), undefined);

  assert.equal(A.parseArchiveRuntime('01:15:00'), 75);
  assert.equal(A.parseArchiveRuntime('75 min'), 75);
  assert.equal(A.parseArchiveRuntime('2h 7m'), 127);
  assert.equal(A.parseArchiveRuntime(96), 96);
  assert.equal(A.parseArchiveRuntime(undefined), undefined);

  assert.deepEqual(A.archiveLanguage('spa'), { code: 'es', name: 'Spanish' });
  assert.deepEqual(A.archiveLanguage(['English']), { code: 'en', name: 'English' });
  assert.equal(A.archiveLanguage('klingon').code, 'en', 'unknown languages fall back to English');
});

test('long archive descriptions are trimmed on a sentence boundary', () => {
  const sentence = 'A short line. ';
  const overview = A.archiveOverview({ description: sentence.repeat(200) }, 120);
  assert.ok(overview.length <= 121);
  assert.ok(overview.endsWith('…'));
});

/* -------------------------------- queries -------------------------------- */

test('archive queries stay inside the openly available movie collections', () => {
  const spec = A.buildArchiveQuery({ q: 'horror', sort: 'trending' });
  assert.match(spec.q, /mediatype:movies/);
  assert.match(spec.q, /collection:"feature_films"/);
  assert.match(spec.q, /title:\("horror"\) OR description:\("horror"\)/);
  assert.equal(spec.sort, 'downloads desc');
});

test('genre, year, decade and language filters are translated to Lucene', () => {
  const noir = A.buildArchiveQuery({ genre: 'film-noir' });
  assert.match(noir.q, /subject:\("Film Noir"\) OR genre:\("Film Noir"\)/);

  assert.match(A.buildArchiveQuery({ year: '1962' }).q, /year:1962/);
  assert.match(A.buildArchiveQuery({ year: '1960s' }).q, /year:\[1960 TO 1969\]/);
  assert.match(A.buildArchiveQuery({ language: 'hi' }).q, /language:\("HI" OR "Hindi"\)/);
});

test('sort options map onto archive sorts and quotes are stripped from user text', () => {
  assert.equal(A.buildArchiveQuery({ sort: 'newest' }).sort, 'year desc');
  assert.equal(A.buildArchiveQuery({ sort: 'oldest' }).sort, 'year asc');
  assert.equal(A.buildArchiveQuery({ sort: 'rating' }).sort, 'avg_rating desc');
  assert.equal(A.buildArchiveQuery({ sort: 'title' }).sort, 'title asc');

  const escaped = A.buildArchiveQuery({ q: 'dune" OR identifier:*' });
  assert.ok(!escaped.q.includes('"dune"'), 'quotes are removed from user input');
  assert.ok(!escaped.q.includes('identifier:'));

  const params = A.archiveSearchParams('mediatype:movies', 3, 24, 'downloads desc');
  assert.equal(params.get('rows'), '24');
  assert.equal(params.get('page'), '3');
  assert.equal(params.get('output'), 'json');
  assert.equal(params.get('sort[]'), 'downloads desc');
  assert.ok(params.getAll('fl[]').includes('identifier'));
});

test('title matching only accepts the same film', () => {
  const candidate = { id: 'x', slug: 'ia-x', kind: 'movie', title: 'His Girl Friday', overview: '', genres: [], language: 'en', year: 1940 };
  assert.equal(A.archiveMatchScore(candidate, 'His Girl Friday', 1940), 10);
  assert.equal(A.archiveMatchScore(candidate, 'his girl friday', undefined), 6, 'title alone is an exact match');
  assert.equal(A.archiveMatchScore(candidate, 'his girl friday (1940)', undefined), 2, 'only a substring match, never played automatically');
  assert.equal(A.archiveMatchScore(candidate, 'His Girl Friday', 1994), 0, 'year mismatch is a reject');
  assert.equal(A.archiveMatchScore(candidate, 'Charade', 1940), 0);
  assert.equal(A.archiveMatchScore({ ...candidate, year: 1941 }, 'His Girl Friday', 1940), 8);
});

/* -------------------------------- snapshot ------------------------------- */

test('the offline snapshot is real, unique and safe to serve', () => {
  const docs = A.ARCHIVE_SNAPSHOT;
  assert.ok(docs.length >= 30, 'enough films to fill a shelf and a detail page');

  const identifiers = new Set();
  for (const entry of docs) {
    assert.ok(entry.identifier, 'every snapshot entry has an identifier');
    assert.ok(!identifiers.has(entry.identifier), `duplicate identifier ${entry.identifier}`);
    identifiers.add(entry.identifier);
    assert.ok(A.archiveIdentifier(A.archiveSlug(entry.identifier)), `${entry.identifier} is URL-safe`);
    assert.ok(entry.identifier.startsWith('ia-') === false, 'snapshot stores bare identifiers');
    assert.ok(entry.title, 'every entry has a title');
    assert.ok(Number(entry.year) >= 1910 && Number(entry.year) <= new Date().getFullYear() + 1, `${entry.identifier} has a real year`);
    assert.ok(entry.description && entry.description.length > 40, `${entry.identifier} has a summary`);
  }
});

test('the snapshot maps to sorted, deduped titles', () => {
  const titles = A.archiveSnapshotTitles();
  assert.equal(titles.length, A.ARCHIVE_SNAPSHOT.length);
  for (const title of titles) {
    assert.equal(title.kind, 'movie');
    assert.equal(title.free, true);
    assert.ok(title.poster.startsWith('https://archive.org/services/img/'));
  }
  for (let i = 1; i < titles.length; i++) {
    assert.ok((titles[i - 1].popularity ?? 0) >= (titles[i].popularity ?? 0), 'sorted by popularity');
  }
});

test('genre vocabulary is unique and slug-safe (used as a filter id)', () => {
  const genres = A.archiveGenreList();
  assert.ok(genres.length >= 15);
  const ids = genres.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const genre of genres) assert.match(genre.id, /^[a-z0-9-]+$/);
});
