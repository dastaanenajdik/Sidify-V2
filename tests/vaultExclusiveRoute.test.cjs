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
 * The whole way through: the provider's listing and search, exactly as the
 * `/api/media/exclusive` route calls them.
 */

const HOMEPAGE = {
  data: {
    items: [
      { banner: { banners: [{ subject: { subjectId: 9001, title: 'The Grand Budapest Hotel', subjectType: 1, releaseDate: '2014-02-28', cover: { url: 'https://img/g.jpg' } } }] } },
      { customData: { items: [{ subject: { subjectId: 9002, title: 'Dark Money', subjectType: 2, releaseDate: '2019-10-03', cover: { url: 'https://img/d.jpg' } } }] } },
      { subjects: [
        { subjectId: 9003, title: 'Killers of the Flower Moon', subjectType: 1, releaseDate: '2023-07-20', cover: { url: 'https://img/k.jpg' } },
        { subjectId: 9004, title: 'The Bear', subjectType: 2, releaseDate: '2022-06-23', cover: { url: 'https://img/b.jpg' } },
      ] },
    ],
  },
};

function makeProvider() {
  const fakeFetch = async (url) => {
    if (url.includes('visitor-login')) {
      return new Response(JSON.stringify({ data: { token: 'tok' } }), { status: 200 });
    }
    if (url.includes('tab-operating')) {
      return new Response(JSON.stringify(HOMEPAGE), { status: 200 });
    }
    if (url.includes('subject-api/search/v2')) {
      return new Response(JSON.stringify({
        data: { results: [{ subjects: [{ subjectId: 9003, title: 'Killers of the Flower Moon', subjectType: 1, cover: { url: 'https://img/k.jpg' } }] }] },
      }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  return new VaultMediaProvider(new VaultClient({ fetchImpl: fakeFetch }));
}

test('the section listing is never empty', async () => {
  const provider = makeProvider();
  const items = await provider.discovery('all', 24);
  assert.ok(items.length >= 4, `expected a populated listing, got ${items.length}`);
  for (const item of items) {
    assert.ok(item.slug.startsWith('vault-'), 'every listing item is an exclusive title');
    assert.ok(item.title, 'every listing item has a title');
  }
});

test('a search inside the section returns matches', async () => {
  const provider = makeProvider();
  const items = await provider.searchTitles('killers', 'all', 24);
  assert.ok(items.length >= 1, 'the search must find its title');
  assert.equal(items[0].title, 'Killers of the Flower Moon');
});

test('the section never mixes in a title from the main catalogue', async () => {
  const provider = makeProvider();
  const items = await provider.discovery('all', 24);
  // Every title must be an exclusive one — the main catalogue's slugs are not
  // namespaced with the `vault-` prefix.
  assert.ok(items.every((item) => item.slug.startsWith('vault-')));
});

test('the exclusive route answers with the collection and nothing else', () => {
  const route = fs.readFileSync(
    path.resolve(__dirname, '../src/app/api/media/exclusive/route.ts'),
    'utf8'
  );
  assert.match(route, /searchExclusive/);
  assert.doesNotMatch(route, /searchMedia\(/);
  assert.doesNotMatch(route, /getMediaProvider\(/);
});

test('the service answers the section from the collection alone', () => {
  const service = fs.readFileSync(
    path.resolve(__dirname, '../src/lib/media/service.ts'),
    'utf8'
  );
  const body = service.slice(service.indexOf('export async function searchExclusive'));
  const end = body.indexOf('/* --------------------------------- detail');
  const fn = body.slice(0, end === -1 ? undefined : end);
  assert.match(fn, /getSecondaryProvider\(\)/);
  assert.doesNotMatch(fn, /getMediaProvider\(\)/);
  assert.match(fn, /provider\.discovery\(/);
});

test('the browse shelf uses the collection listing, not a keyword search', () => {
  const service = fs.readFileSync(
    path.resolve(__dirname, '../src/lib/media/service.ts'),
    'utf8'
  );
  assert.match(service, /secondaryListing\(kind, 12\)/);
  assert.doesNotMatch(service, /secondarySearch\("2024"/);
});
