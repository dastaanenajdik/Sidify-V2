const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const cheerio = require('cheerio');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/**
 * Compile and load TS/TSX client components directly in Node, simulating mounted client
 * state (`useMounted() === true`) so we assert exact rendered DOM tags (`<a>` vs `<button>`),
 * `href` schemes, absence of `target="_blank"` on custom schemes, and platform routing.
 */
function createUiLoader({ mounted = true } = {}) {
  const cache = new Map();

  function resolveTarget(request, parentFilename) {
    let base;
    if (request.startsWith('@/')) {
      base = path.join(SRC, request.slice(2));
    } else if (request.startsWith('.') && parentFilename) {
      base = path.resolve(path.dirname(parentFilename), request);
    } else {
      return null;
    }

    for (const ext of ['', '.ts', '.tsx', '/index.ts', '/index.tsx']) {
      const full = base + ext;
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    }
    return null;
  }

  function loadModule(targetFile) {
    if (targetFile.endsWith(path.join('src', 'lib', 'useMounted.ts'))) {
      return { useMounted: () => mounted };
    }
    if (cache.has(targetFile)) return cache.get(targetFile).exports;

    const compiled = new Module(targetFile, module);
    compiled.filename = targetFile;
    compiled.paths = Module._nodeModulePaths(path.dirname(targetFile));
    cache.set(targetFile, compiled);

    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, parent, isMain) {
      const resolved = resolveTarget(request, parent && parent.filename);
      if (resolved) return loadModule(resolved);
      return originalLoad.call(this, request, parent, isMain);
    };

    try {
      const source = fs.readFileSync(targetFile, 'utf8');
      const output = ts.transpileModule(source, {
        fileName: targetFile,
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText;
      compiled._compile(output, targetFile);
      return compiled.exports;
    } finally {
      Module._load = originalLoad;
    }
  }

  return (relFromSrc) => loadModule(path.join(SRC, relFromSrc));
}

function withNavigator(mockNav, mockFinePointer, fn) {
  const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const prevWin = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'navigator', { value: mockNav, configurable: true });
  Object.defineProperty(globalThis, 'window', {
    value: {
      matchMedia: (q) => ({ matches: q === '(pointer: fine)' ? Boolean(mockFinePointer) : false }),
    },
    configurable: true,
  });
  try {
    return fn();
  } finally {
    if (prevNav) Object.defineProperty(globalThis, 'navigator', prevNav);
    else delete globalThis.navigator;
    if (prevWin) Object.defineProperty(globalThis, 'window', prevWin);
    else delete globalThis.window;
  }
}

test('VlcPlayButton with a resolved URL renders a real <a href="intent://..."> on Android (never a button)', () => {
  const load = createUiLoader({ mounted: true });
  const { VlcPlayButton } = load('components/media/VlcPlayButton.tsx');

  const html = withNavigator(
    { userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131.0', platform: 'Linux armv81', maxTouchPoints: 5 },
    false,
    () =>
      renderToStaticMarkup(
        React.createElement(VlcPlayButton, {
          url: 'https://pub-1.r2.dev/Movie.2026.1080p.mkv?tok=9',
          title: 'Movie 2026 (1080p)',
        })
      )
  );

  const $ = cheerio.load(html);
  assert.equal($('button').length, 0, 'must NOT wrap Android VLC launch in a <button>');
  const anchor = $('a');
  assert.equal(anchor.length, 1, 'must render a single real <a> anchor');
  assert.ok(anchor.attr('href').startsWith('intent://pub-1.r2.dev/Movie.2026.1080p.mkv?tok=9#Intent;'));
  assert.ok(anchor.attr('href').includes('package=org.videolan.vlc'));
  assert.equal(anchor.attr('target'), undefined, 'intent: links must not open blank tabs');
});

test('VlcPlayButton with a resolved URL renders a real <a href="vlc-x-callback://..."> on iOS', () => {
  const load = createUiLoader({ mounted: true });
  const { VlcPlayButton } = load('components/media/VlcPlayButton.tsx');

  const streamUrl = 'https://pub-1.r2.dev/Movie.2026.720p.mp4';
  const html = withNavigator(
    { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15', maxTouchPoints: 5 },
    false,
    () => React.createElement(VlcPlayButton, { url: streamUrl, title: 'Movie 2026' }) && renderToStaticMarkup(React.createElement(VlcPlayButton, { url: streamUrl, title: 'Movie 2026' }))
  );

  const $ = cheerio.load(html);
  assert.equal($('button').length, 0);
  assert.equal($('a').attr('href'), `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(streamUrl)}`);
});

test('ExternalPlayerLinks keeps Android VLC/MX/Other-app <a href> links even in Chrome Desktop-site mode', () => {
  const load = createUiLoader({ mounted: true });
  const { ExternalPlayerLinks } = load('components/media/ExternalPlayerLinks.tsx');

  const html = withNavigator(
    {
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
      platform: 'Linux armv81',
      maxTouchPoints: 5,
    },
    false,
    () =>
      renderToStaticMarkup(
        React.createElement(ExternalPlayerLinks, {
          url: 'https://pub-1.r2.dev/Episode.S01E01.1080p.mkv',
          title: 'Show S01E01',
        })
      )
  );

  const $ = cheerio.load(html);
  const hrefs = $('a')
    .map((_, el) => $(el).attr('href'))
    .get();
  assert.equal(hrefs.length, 3, 'VLC + MX Player + Other app anchors rendered');
  assert.ok(hrefs[0].includes('package=org.videolan.vlc'));
  assert.ok(hrefs[1].includes('package=com.mxtech.videoplayer.ad'));
});

test('VlcPlayButton with unresolved releases renders a synchronous sheet-trigger button and hides on archive-only rows', () => {
  const load = createUiLoader({ mounted: true });
  const { VlcPlayButton } = load('components/media/VlcPlayButton.tsx');

  let opened = 0;
  const html = renderToStaticMarkup(
    React.createElement(VlcPlayButton, {
      title: 'Show S01E01',
      releases: [
        {
          id: 'r1',
          title: '1080p',
          fileName: 'Show.S01E01.1080p.mkv',
          quality: '1080p',
          mirrors: [{ label: 'HubDrive', shortUrl: 'https://hubdrive.space/file/1' }],
        },
      ],
      onOpen: () => {
        opened += 1;
      },
    })
  );
  const $ = cheerio.load(html);
  assert.equal($('button').length, 1);
  assert.equal($('button').text().trim(), 'Play with VLC');
  assert.equal(opened, 0, 'never opens during render');

  const packOnly = renderToStaticMarkup(
    React.createElement(VlcPlayButton, {
      title: 'Show Season 1',
      releases: [
        {
          id: 'pack1',
          title: 'Season 1 Pack',
          fileName: 'Show.S01.COMPLETE.zip',
          quality: '1080p',
          container: 'ZIP',
          isPack: true,
          mirrors: [{ label: 'HubDrive', shortUrl: 'https://hubdrive.space/file/2' }],
        },
      ],
    })
  );
  assert.equal(packOnly, '', 'season ZIP packs never show Play with VLC');
});
