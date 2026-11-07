const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const moduleCache = new Map();

function resolveCandidate(basePath) {
  for (const ext of ['', '.ts', '.tsx']) {
    if (fs.existsSync(basePath + ext) && fs.statSync(basePath + ext).isFile()) {
      return basePath + ext;
    }
  }
  return null;
}

function loadTs(relOrAbsPath) {
  const filename = path.isAbsolute(relOrAbsPath)
    ? relOrAbsPath
    : path.resolve(ROOT, relOrAbsPath);
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;

  const compiled = new Module(filename, module);
  compiled.filename = filename;
  compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  moduleCache.set(filename, compiled);

  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.startsWith('@/')) {
      const candidate = resolveCandidate(path.join(ROOT, 'src', request.slice(2)));
      if (candidate) return loadTs(candidate);
    } else if (request.startsWith('.') && parent && parent.filename) {
      const candidate = resolveCandidate(path.resolve(path.dirname(parent.filename), request));
      if (candidate) return loadTs(candidate);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: filename,
    });
    compiled._compile(output.outputText, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

test('getSiteUrl resolves canonical origin cleanly and falls back to https://sidify.vercel.app', () => {
  const seo = loadTs('src/lib/seo.ts');
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  const prevVercel = process.env.VERCEL_PROJECT_PRODUCTION_URL;

  try {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    assert.equal(seo.getSiteUrl(), 'https://sidify.vercel.app');
    assert.equal(seo.absoluteUrl('/'), 'https://sidify.vercel.app/');
    assert.equal(seo.absoluteUrl('/explore/bollywood'), 'https://sidify.vercel.app/explore/bollywood');

    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'sidify-custom.vercel.app';
    assert.equal(seo.getSiteUrl(), 'https://sidify-custom.vercel.app');

    process.env.NEXT_PUBLIC_SITE_URL = 'https://sidify.example.com/some/subpath/';
    assert.equal(seo.getSiteUrl(), 'https://sidify.example.com');
  } finally {
    if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
    if (prevVercel === undefined) delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    else process.env.VERCEL_PROJECT_PRODUCTION_URL = prevVercel;
  }
});

test('SEO keywords cover brand (Sidify) and primary music, song and Spotify search terms', () => {
  const seo = loadTs('src/lib/seo.ts');
  const lower = seo.SEO_KEYWORDS.map((k) => k.toLowerCase());

  for (const term of ['sidify', 'spotify', 'music', 'song', 'songs', 'free music streaming', 'online music player']) {
    assert.ok(lower.includes(term), `expected keyword "${term}" in SEO_KEYWORDS`);
  }
  assert.match(seo.SITE_TITLE, /Sidify/);
  assert.match(seo.SITE_TITLE, /Music/i);
  assert.match(seo.SITE_TITLE, /Song/i);
});

test('Schema.org JSON-LD builders emit WebSite SearchAction, MusicApplication, Android APK & FAQ graphs safely', () => {
  const seo = loadTs('src/lib/seo.ts');
  const { MOODS } = loadTs('src/lib/explore.ts');

  const rootGraph = seo.buildRootJsonLd('https://sidify.vercel.app')['@graph'];
  assert.equal(rootGraph.length, 3);

  const website = rootGraph.find((n) => n['@type'] === 'WebSite');
  assert.equal(website.name, 'Sidify');
  assert.equal(website.url, 'https://sidify.vercel.app/');
  assert.equal(website.potentialAction['@type'], 'SearchAction');
  assert.equal(
    website.potentialAction.target.urlTemplate,
    'https://sidify.vercel.app/search?q={search_term_string}'
  );

  const webapp = rootGraph.find((n) => n['@type'] === 'WebApplication');
  assert.equal(webapp.applicationCategory, 'MusicApplication');
  assert.equal(webapp.isAccessibleForFree, true);

  const appGraph = seo.buildAndroidAppJsonLd('https://sidify.vercel.app')['@graph'];
  assert.ok(appGraph.some((n) => n['@type'] === 'SoftwareApplication'));
  const faq = appGraph.find((n) => n['@type'] === 'FAQPage');
  assert.ok(faq && faq.mainEntity.length >= 4);

  const moodGraph = seo.buildMoodJsonLd(MOODS[0], 'https://sidify.vercel.app')['@graph'];
  assert.ok(moodGraph.some((n) => n['@type'] === 'CollectionPage'));
  const crumbs = moodGraph.find((n) => n['@type'] === 'BreadcrumbList');
  assert.equal(crumbs.itemListElement.length, 3);

  const escaped = seo.serializeJsonLd({ x: '</script><script>alert(1)</script>' });
  assert.doesNotMatch(escaped, /<\/script>/);
  assert.match(escaped, /\\u003c\/script>/);
});

test('robots.ts allows Googlebot on public routes, blocks private routes and points to sitemap.xml', () => {
  const robots = loadTs('src/app/robots.ts').default;
  const out = robots();

  assert.equal(out.sitemap, `${out.host}/sitemap.xml`);
  assert.ok(Array.isArray(out.rules) && out.rules.length >= 2);
  const wildcard = out.rules.find((r) => r.userAgent === '*');
  assert.equal(wildcard.allow, '/');
  assert.ok(wildcard.disallow.includes('/api/'));
  assert.ok(wildcard.disallow.includes('/dev/'));
  assert.ok(wildcard.disallow.includes('/library/'));
});

test('sitemap.ts lists every public core route and all 26 mood & genre pages with unique URLs', () => {
  const sitemap = loadTs('src/app/sitemap.ts').default;
  const { MOODS } = loadTs('src/lib/explore.ts');
  const entries = sitemap();
  const urls = entries.map((e) => e.url);

  assert.equal(new Set(urls).size, urls.length, 'sitemap URLs must be unique');
  assert.equal(entries.length, 8 + MOODS.length);
  assert.equal(entries[0].priority, 1.0);

  for (const route of ['/', '/search', '/explore', '/rooms', '/app', '/movies', '/series', '/exclusive']) {
    assert.ok(urls.some((u) => u.endsWith(route)), `sitemap should contain ${route}`);
  }
  for (const mood of MOODS) {
    assert.ok(
      urls.some((u) => u.endsWith(`/explore/${mood.slug}`)),
      `sitemap should contain /explore/${mood.slug}`
    );
  }
});

test('dynamic mood and album layouts generate clean titles and self-referencing canonicals', async () => {
  const moodLayout = loadTs('src/app/explore/[slug]/layout.tsx');
  const albumLayout = loadTs('src/app/album/[id]/layout.tsx');
  const { encodePseudoAlbum } = loadTs('src/lib/parser.ts');

  const staticParams = moodLayout.generateStaticParams();
  assert.ok(staticParams.some((p) => p.slug === 'bollywood'));

  const bollywoodMeta = await moodLayout.generateMetadata({
    params: Promise.resolve({ slug: 'bollywood' }),
  });
  assert.equal(bollywoodMeta.alternates.canonical, '/explore/bollywood');
  assert.match(bollywoodMeta.title.absolute, /Bollywood Songs & Music/);

  const pseudoId = encodePseudoAlbum({ q: 'Arijit Singh hits', t: 'Best of Arijit', a: 'Arijit Singh' });
  const albumMeta = await albumLayout.generateMetadata({
    params: Promise.resolve({ id: pseudoId }),
  });
  assert.match(albumMeta.title, /Best of Arijit — Arijit Singh/);
  assert.equal(albumMeta.alternates.canonical, `/album/${encodeURIComponent(pseudoId)}`);
});

test('root and route layouts set metadataBase, social images, canonicals and crawler bypass rules', () => {
  const rootLayout = read('src/app/layout.tsx');
  assert.match(rootLayout, /metadataBase:\s*new URL\(/);
  assert.match(rootLayout, /buildRootJsonLd/);
  assert.match(rootLayout, /max-image-preview/);

  assert.ok(fs.existsSync(path.join(ROOT, 'src/app/opengraph-image.tsx')));
  assert.ok(fs.existsSync(path.join(ROOT, 'src/app/twitter-image.tsx')));
  assert.ok(fs.existsSync(path.join(ROOT, 'public/llms.txt')));
  assert.ok(fs.existsSync(path.join(ROOT, 'public/humans.txt')));

  // Every route layout defines its own canonical so child pages never inherit `/`
  for (const rel of [
    'src/app/search/layout.tsx',
    'src/app/explore/layout.tsx',
    'src/app/explore/[slug]/layout.tsx',
    'src/app/rooms/layout.tsx',
    'src/app/rooms/[code]/layout.tsx',
    'src/app/app/layout.tsx',
    'src/app/album/[id]/layout.tsx',
    'src/app/artist/[id]/layout.tsx',
    'src/app/playlist/[id]/layout.tsx',
    'src/app/library/layout.tsx',
    'src/app/downloads/layout.tsx',
    'src/app/settings/layout.tsx',
  ]) {
    const content = read(rel);
    assert.match(content, /canonical/, `${rel} should define alternates.canonical`);
  }

  const sw = read('public/sw.js');
  assert.match(sw, /\/robots\.txt/);
  assert.match(sw, /\/sitemap\.xml/);
  assert.match(sw, /\/llms\.txt/);
});
