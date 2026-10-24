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
      for (const ext of ['.ts', '.tsx']) {
        const c = path.resolve(path.dirname(parent.filename), `${request}${ext}`);
        if (fs.existsSync(c)) return loadTs(path.relative(path.resolve(__dirname, '..'), c));
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
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText;
    compiled._compile(out, filename);
    return compiled.exports;
  } finally { Module._load = originalLoad; }
}

test('every title of the exclusive collection is marked and links to its detail page', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/components/media/PosterCard.tsx'),
    'utf8'
  );
  assert.match(source, /export function isExclusiveTitle/);
  assert.match(source, /slug\.startsWith\("vault-"\)/);
  assert.match(source, /export function mediaHref/);
  assert.match(source, /`\/\$\{KIND_PATH\[title\.kind\]\}\/\$\{encodeURIComponent\(title\.slug\)\}`/);
});

test('the vault slug namespace routes to the exclusive detail pages', () => {
  const { isVaultSlug } = loadTs('../src/lib/media/vaultAdapt.ts');
  assert.equal(isVaultSlug('vault-42-the-thing'), true);
  assert.equal(isVaultSlug('7-the-thing'), false);
});

test('the exclusive API route only ever calls the exclusive catalogue', () => {
  const route = fs.readFileSync(
    path.resolve(__dirname, '../src/app/api/media/exclusive/route.ts'),
    'utf8'
  );
  assert.match(route, /searchExclusive/);
  // The route must not reach for the main catalogue's search.
  assert.doesNotMatch(route, /searchMedia\(/);
  assert.doesNotMatch(route, /getMediaProvider\(/);
});

test('the exclusive service never mixes the main catalogue into its results', () => {
  const service = fs.readFileSync(
    path.resolve(__dirname, '../src/lib/media/service.ts'),
    'utf8'
  );
  const body = service.slice(service.indexOf('export async function searchExclusive'));
  const end = body.indexOf('/* --------------------------------- detail');
  const fn = body.slice(0, end === -1 ? undefined : end);
  assert.match(fn, /getSecondaryProvider\(\)/);
  assert.doesNotMatch(fn, /getMediaProvider\(\)/);
  assert.doesNotMatch(fn, /mergeSearchResults/);
});

test('the exclusive page ships a search box of its own', () => {
  const section = fs.readFileSync(
    path.resolve(__dirname, '../src/components/media/ExclusiveSection.tsx'),
    'utf8'
  );
  assert.match(section, /useExclusiveSearch/);
  assert.match(section, /Search the exclusive collection/);
  assert.match(section, /role="search"/);
});

test('the exclusive search hook targets the exclusive endpoint only', () => {
  const hooks = fs.readFileSync(
    path.resolve(__dirname, '../src/lib/media/hooks.ts'),
    'utf8'
  );
  assert.match(hooks, /mediaApi\.exclusive\(/);
  const client = fs.readFileSync(
    path.resolve(__dirname, '../src/lib/media/client.ts'),
    'utf8'
  );
  assert.match(client, /\/api\/media\/exclusive/);
});
