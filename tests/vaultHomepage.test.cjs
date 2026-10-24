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

/**
 * The upstream answers the homepage endpoint with `items`: groups of rows whose
 * subjects live in a banner, a custom row or a plain grid.
 */
const HOMEPAGE_PAYLOAD = {
  data: {
    items: [
      {
        banner: {
          banners: [
            { subject: { subjectId: 501, title: 'Arrival', subjectType: 1, releaseDate: '2016-11-11', cover: { url: 'https://img/a.jpg' } } },
          ],
        },
      },
      {
        customData: {
          items: [
            { subject: { subjectId: 502, title: 'Dark', subjectType: 2, releaseDate: '2017-12-01', cover: { url: 'https://img/d.jpg' } } },
          ],
        },
      },
      {
        subjects: [
          { subjectId: 503, title: 'Tenet', subjectType: 1, releaseDate: '2020-08-26', cover: { url: 'https://img/t.jpg' } },
          { subjectId: 504, title: 'Chernobyl', subjectType: 2, releaseDate: '2019-05-06', cover: { url: 'https://img/c.jpg' } },
        ],
      },
    ],
  },
};

function makeProvider(handler) {
  const seen = [];
  const fakeFetch = async (url, init) => {
    seen.push({ url, init });
    if (url.includes('visitor-login')) {
      return new Response(JSON.stringify({ data: { token: 'tok-home' } }), { status: 200 });
    }
    return handler(url);
  };
  return { provider: new VaultMediaProvider(new VaultClient({ fetchImpl: fakeFetch })), seen };
}

test('the collection listing comes from the homepage endpoint', async () => {
  const { provider, seen } = makeProvider(async (url) => {
    if (url.includes('tab-operating')) {
      return new Response(JSON.stringify(HOMEPAGE_PAYLOAD), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });

  const titles = await provider.discovery('all', 24);

  assert.ok(titles.length >= 4, `expected the homepage rows, got ${titles.length}`);
  const names = titles.map((t) => t.title);
  assert.ok(names.includes('Arrival'), 'a banner subject must be listed');
  assert.ok(names.includes('Dark'), 'a custom row subject must be listed');
  assert.ok(names.includes('Tenet'), 'a plain grid subject must be listed');
  assert.ok(names.includes('Chernobyl'));

  // Every listing title is an exclusive title.
  assert.ok(titles.every((t) => t.slug.startsWith('vault-')), 'listing titles must be exclusive');

  // The homepage endpoint is what was asked for.
  assert.ok(seen.some((r) => r.url.includes('tab-operating')), 'the homepage endpoint must be used');
});

test('the listing keeps movies and series apart', async () => {
  const { provider } = makeProvider(async (url) => {
    if (url.includes('tab-operating')) {
      return new Response(JSON.stringify(HOMEPAGE_PAYLOAD), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });

  const movies = await provider.discovery('movie', 24);
  const series = await provider.discovery('series', 24);

  assert.ok(movies.length > 0);
  assert.ok(series.length > 0);
  assert.ok(movies.every((t) => t.kind === 'movie'), 'only movies in the movie listing');
  assert.ok(series.every((t) => t.kind === 'series'), 'only series in the series listing');
});

test('the listing is read once and then served from the cache', async () => {
  let homepageCalls = 0;
  const { provider } = makeProvider(async (url) => {
    if (url.includes('tab-operating')) {
      homepageCalls++;
      return new Response(JSON.stringify(HOMEPAGE_PAYLOAD), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });

  await provider.discovery('all', 24);
  await provider.discovery('all', 24);
  await provider.discovery('movie', 12);

  // Three tabs are read once; the later calls come from the cache.
  assert.equal(homepageCalls, 3, 'the homepage tabs must not be re-read on every request');
});

test('every tab is read, not only the first one that fills the list', async () => {
  const tabs = [];
  const { provider } = makeProvider(async (url) => {
    if (url.includes('tab-operating')) {
      const tab = new URL(url).searchParams.get('tabId');
      tabs.push(tab);
      // Each tab carries its own subject, so a listing built from one tab only
      // would miss the others.
      return new Response(JSON.stringify({
        data: { items: [{ subjects: [{ subjectId: Number(tab) * 10, title: `Tab ${tab}`, subjectType: 1 }] }] },
      }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });

  const titles = await provider.discovery('all', 30);

  assert.equal(tabs.length, 3, 'all three tabs must be read');
  assert.equal(titles.length, 3, 'the subjects of every tab must be listed');
  assert.deepEqual(
    titles.map((t) => t.title).sort(),
    ['Tab 1', 'Tab 2', 'Tab 3']
  );
});

test('a failing homepage tab does not break the listing', async () => {
  const { provider } = makeProvider(async (url) => {
    if (url.includes('tab-operating')) {
      const tab = new URL(url).searchParams.get('tabId');
      if (tab === '2') return new Response(JSON.stringify(HOMEPAGE_PAYLOAD), { status: 200 });
      return new Response('nope', { status: 500 });
    }
    return new Response('{}', { status: 404 });
  });

  const titles = await provider.discovery('all', 24);
  assert.ok(titles.length >= 4, 'the tabs that do answer must still be used');
});

test('a search inside the collection finds its titles', async () => {
  const { provider, seen } = makeProvider(async (url) => {
    if (url.includes('subject-api/search/v2')) {
      return new Response(JSON.stringify({
        data: {
          results: [
            { subjects: [{ subjectId: 601, title: 'Dune', subjectType: 1, releaseDate: '2021-09-15', cover: { url: 'https://img/d.jpg' } }] },
            { subjects: [{ subjectId: 602, title: 'Dune: Part Two', subjectType: 1, releaseDate: '2024-03-01', cover: { url: 'https://img/d2.jpg' } }] },
          ],
        },
      }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });

  const titles = await provider.searchTitles('dune', 'all', 10);

  assert.equal(titles.length, 2, 'a match in the second result group must not be dropped');
  assert.equal(titles[0].title, 'Dune');
  assert.equal(titles[1].title, 'Dune: Part Two');
  assert.ok(titles.every((t) => t.slug.startsWith('vault-')));

  const searchCall = seen.find((r) => r.url.includes('subject-api/search/v2'));
  assert.ok(searchCall, 'the search endpoint must be used');
  const body = JSON.parse(searchCall.init.body);
  assert.equal(body.keyword, 'dune');
  assert.equal(body.subjectType, 0);
});

test('an empty homepage falls back to a search so the section is never blank', async () => {
  const { provider } = makeProvider(async (url) => {
    if (url.includes('tab-operating')) {
      // The homepage answers, but with nothing in it.
      return new Response(JSON.stringify({ data: { items: [] } }), { status: 200 });
    }
    if (url.includes('subject-api/search/v2')) {
      return new Response(JSON.stringify({
        data: { results: [{ subjects: [{ subjectId: 701, title: 'Fallback', subjectType: 1 }] }] },
      }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  });

  const titles = await provider.discovery('all', 24);

  assert.ok(titles.length > 0, 'the section must not be blank when the homepage is empty');
  assert.equal(titles[0].title, 'Fallback');
});

test('the collection listing uses the homepage endpoint, not keyword guessing', async () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/lib/media/vaultProvider.ts'),
    'utf8'
  );
  // The listing and the search are the collection's own two endpoints.
  assert.match(source, /tab-operating/);
  assert.match(source, /subject-api\/search\/v2/);
  // The listing reads the homepage; it no longer guesses with generic keywords.
  const discovery = source.slice(source.indexOf('async discovery('));
  const listing = discovery.slice(0, discovery.indexOf('private async loadHomepage'));
  assert.match(listing, /this\.homepage\(/);
  assert.doesNotMatch(listing, /searchTitles\(/);
});
