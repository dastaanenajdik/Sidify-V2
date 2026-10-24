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

const adapt = loadTs('../src/lib/media/vaultAdapt.ts');

/**
 * These payloads mirror the reference client exactly.
 *
 * The reference strips the `data` envelope before adapting, so the adapter sees
 * `{ results: [...] }` for a search and `{ items: [...] }` for the homepage.
 */

/* ------------------------------- search ---------------------------------- */

test('search: the first result group holds the matches', () => {
  const titles = adapt.searchPayloadToTitles({
    results: [
      {
        subjects: [
          { subjectId: 100, title: 'Dune', subjectType: 1, releaseDate: '2021-09-15', cover: { url: 'https://img/d.jpg' } },
          { subjectId: 200, title: 'Foundation', subjectType: 2, releaseDate: '2021-02-01', cover: { url: 'https://img/f.jpg' } },
        ],
      },
    ],
  });
  assert.equal(titles.length, 2);
  assert.equal(titles[0].id, '100');
  assert.equal(titles[0].title, 'Dune');
  assert.equal(titles[0].kind, 'movie');
  assert.equal(titles[0].year, 2021);
  assert.equal(titles[1].kind, 'series');
});

test('search: an unwrapped payload with the data envelope still parses', () => {
  // The reference client strips `data`, but a raw payload must parse too.
  const titles = adapt.searchPayloadToTitles({
    data: {
      results: [{ subjects: [{ subjectId: 1, title: 'Solaris', subjectType: 1 }] }],
    },
  });
  assert.equal(titles.length, 1);
  assert.equal(titles[0].title, 'Solaris');
});

test('search: every result group is considered, not only the first', () => {
  const titles = adapt.searchPayloadToTitles({
    results: [
      { subjects: [{ subjectId: 1, title: 'A', subjectType: 1 }] },
      { subjects: [{ subjectId: 2, title: 'B', subjectType: 1 }] },
    ],
  });
  assert.equal(titles.length, 2, 'a second group must not be dropped');
});

test('search: a subject without an id is skipped', () => {
  const titles = adapt.searchPayloadToTitles({
    results: [{ subjects: [{ title: 'No Id', subjectType: 1 }, { subjectId: 9, title: 'Good', subjectType: 1 }] }],
  });
  assert.equal(titles.length, 1);
  assert.equal(titles[0].title, 'Good');
});

test('search: the same subject twice yields one title', () => {
  const titles = adapt.searchPayloadToTitles({
    results: [
      { subjects: [{ subjectId: 5, title: 'Same', subjectType: 1 }] },
      { subjects: [{ subjectId: 5, title: 'Same', subjectType: 1 }] },
    ],
  });
  assert.equal(titles.length, 1);
});

/* ------------------------------ homepage --------------------------------- */

test('homepage: banner subjects become titles', () => {
  const titles = adapt.homepagePayloadToTitles({
    items: [
      {
        banner: {
          banners: [
            { subject: { subjectId: 11, title: 'Spotlight', subjectType: 1, releaseDate: '2015-11-06' } },
          ],
        },
      },
    ],
  });
  assert.equal(titles.length, 1);
  assert.equal(titles[0].title, 'Spotlight');
  assert.equal(titles[0].kind, 'movie');
});

test('homepage: customData subjects become titles', () => {
  const titles = adapt.homepagePayloadToTitles({
    items: [
      {
        customData: {
          items: [
            { subject: { subjectId: 12, title: 'Arrival', subjectType: 1 } },
            { subject: { subjectId: 13, title: 'Severance', subjectType: 2 } },
          ],
        },
      },
    ],
  });
  assert.equal(titles.length, 2);
  assert.equal(titles[1].kind, 'series');
});

test('homepage: plain subjects become titles', () => {
  const titles = adapt.homepagePayloadToTitles({
    items: [{ subjects: [{ subjectId: 14, title: 'Heat', subjectType: 1 }] }],
  });
  assert.equal(titles.length, 1);
  assert.equal(titles[0].title, 'Heat');
});

test('homepage: the same subject in two groups is listed once', () => {
  const titles = adapt.homepagePayloadToTitles({
    items: [
      { banner: { banners: [{ subject: { subjectId: 21, title: 'Dune', subjectType: 1 } }] } },
      { subjects: [{ subjectId: 21, title: 'Dune', subjectType: 1 }] },
    ],
  });
  assert.equal(titles.length, 1);
});

test('homepage: an unwrapped payload with the data envelope still parses', () => {
  const titles = adapt.homepagePayloadToTitles({
    data: { items: [{ subjects: [{ subjectId: 31, title: 'Her', subjectType: 1 }] }] },
  });
  assert.equal(titles.length, 1);
  assert.equal(titles[0].title, 'Her');
});

test('homepage: an empty payload yields no titles', () => {
  assert.deepEqual(adapt.homepagePayloadToTitles({}), []);
  assert.deepEqual(adapt.homepagePayloadToTitles({ items: [] }), []);
});
