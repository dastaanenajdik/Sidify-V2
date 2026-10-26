const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/* ------------------------- a TS loader with the @/ alias ---------------- */

function createLoader() {
  const cache = new Map();

  function resolveTarget(request, parentFilename) {
    let base;
    if (request.startsWith('@/')) base = path.join(SRC, request.slice(2));
    else if (request.startsWith('.') && parentFilename) base = path.resolve(path.dirname(parentFilename), request);
    else return null;
    for (const ext of ['', '.ts', '.tsx', '.js']) {
      const full = base + ext;
      if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
    }
    return null;
  }

  function loadModule(targetFile) {
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
      const output = ts.transpileModule(fs.readFileSync(targetFile, 'utf8'), {
        fileName: targetFile,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      }).outputText;
      compiled._compile(output, targetFile);
      return compiled.exports;
    } finally {
      Module._load = originalLoad;
    }
  }

  return { load: loadModule };
}

/* ------------------------------- the browser ---------------------------- */

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

/**
 * Installs the globals the browser transport expects and returns the modules
 * loaded fresh against them. Every test gets its own module instances, because
 * `exclusiveDirect` deliberately remembers that the direct path is blocked.
 */
function createBrowserWorld({
  corsBlocked = false,
  failTicket = false,
  upstreamDown = false,
  loginRefused = false,
  playback = [],
} = {}) {
  const storage = memoryStorage();
  const calls = [];
  const upstreamRequests = [];
  const ticketRequests = [];

  const titles = TITLES;
  const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status });

  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, init });

    if (href.startsWith('/api/media/exclusive/ticket')) {
      ticketRequests.push(JSON.parse(String(init.body || '{}')));
      if (failTicket) return json({ error: 'nope' }, 503);
      const body = JSON.parse(String(init.body || '{}'));
      // Mirrors the real route: the credential ends up as a bearer header.
      const auth = body.token ? { authorization: `Bearer ${body.token}` } : {};
      const signed = [];
      for (const call of body.calls || []) {
        if (call.kind === 'login') {
          signed.push({
            id: 'login',
            kind: 'login',
            method: 'POST',
            url: 'https://upstream.test/wefeed-mobile-bff/user-api/visitor-login',
            headers: { 'x-sig': 'signed' },
            body: '{}',
          });
        } else if (call.kind === 'home') {
          for (const tabId of ['2', '1', '3']) {
            signed.push({
              id: `home:${tabId}`,
              kind: 'home',
              method: 'GET',
              url: `https://upstream.test/wefeed-mobile-bff/tab-operating?page=1&tabId=${tabId}&version=`,
              headers: { 'x-sig': 'signed', ...auth },
            });
          }
        } else if (call.kind === 'search') {
          signed.push({
            id: 'search',
            kind: 'search',
            method: 'POST',
            url: 'https://upstream.test/wefeed-mobile-bff/subject-api/search/v2',
            headers: { 'x-sig': 'signed', ...auth },
            body: JSON.stringify({ keyword: call.term, page: 1, perPage: 15, subjectType: 0 }),
          });
        } else if (call.kind === 'detail') {
          signed.push({
            id: 'detail',
            kind: 'detail',
            method: 'GET',
            url: `https://upstream.test/wefeed-mobile-bff/subject-api/get?subjectId=${call.subjectId}`,
            headers: { 'x-sig': 'signed', ...auth },
          });
        } else if (call.kind === 'resource') {
          signed.push({
            id: 'resource',
            kind: 'resource',
            method: 'GET',
            url: `https://upstream.test/wefeed-mobile-bff/subject-api/resource?subjectId=${call.subjectId}&page=1&perPage=20`,
            headers: { 'x-sig': 'signed', ...auth },
          });
        }
      }
      return json({ issuedAt: Date.now(), expiresAt: Date.now() + 600_000, calls: signed });
    }

    if (href.startsWith('/api/media/exclusive/playback')) {
      return json({ sources: playback });
    }

    if (href.startsWith('https://upstream.test/')) {
      upstreamRequests.push({ href, init });
      // A CORS refusal is what the browser surfaces for a cross-origin fetch it
      // is not allowed to make: an opaque `TypeError`, with no detail.
      if (corsBlocked) throw new TypeError('Failed to fetch');
      if (upstreamDown) return json({ error: 'nope' }, 502);

      if (href.includes('visitor-login')) {
        if (loginRefused) return json({ error: 'no visitor session for you' }, 403);
        return json({ data: { token: 'browser-token-abc123' } });
      }
      if (href.includes('tab-operating')) return json({ data: { items: [{ subjects: titles }] } });
      if (href.includes('subject-api/search/v2')) {
        const keyword = String(JSON.parse(String(init.body || '{}')).keyword || '').toLowerCase();
        const matches = titles.filter((title) => title.title.toLowerCase().includes(keyword));
        return json({ data: { results: [{ subjects: matches }] } });
      }
      if (href.includes('subject-api/get')) {
        const id = Number(href.match(/subjectId=(\d+)/)?.[1] || 0);
        const subject = titles.find((title) => title.subjectId === id) || titles[0];
        return json({ data: { subject: { ...subject, description: 'Fixture synopsis.', seasons: { seasons: [] } } } });
      }
      if (href.includes('subject-api/resource')) {
        return json({
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
            ],
          },
        });
      }
      return json({}, 404);
    }

    throw new Error(`unexpected fetch: ${href}`);
  };

  const previous = {
    window: global.window,
    localStorage: global.localStorage,
    fetch: global.fetch,
  };
  global.window = global.window || {};
  global.localStorage = storage;
  global.fetch = fetchImpl;

  const loader = createLoader();
  const direct = loader.load(path.join(SRC, 'lib/media/exclusiveDirect.ts'));
  const status = loader.load(path.join(SRC, 'lib/media/exclusiveStatus.ts'));

  function restore() {
    global.window = previous.window;
    global.localStorage = previous.localStorage;
    global.fetch = previous.fetch;
  }

  return { direct, status, storage, calls, upstreamRequests, ticketRequests, restore };
}

/* ------------------------------- fixtures ------------------------------- */

const TITLES = [
  {
    subjectId: 101,
    title: 'Night Train',
    subjectType: 1,
    releaseDate: '2025-03-01',
    genre: ['Thriller', 'Drama'],
    imdbRatingValue: 8.4,
    lanName: 'English',
    cover: { url: 'https://img.test/101.jpg' },
  },
  {
    subjectId: 102,
    title: 'Night Train Returns',
    subjectType: 1,
    releaseDate: '2023-05-10',
    genre: ['Thriller'],
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
];

const NEVER = async () => {
  throw new Error('the relay must not be called');
};

/* --------------------------------- tests -------------------------------- */

test('the home payload is fetched by the browser itself, from signed calls', async () => {
  const world = createBrowserWorld();
  try {
    const home = await world.direct.loadExclusiveHome('all', NEVER);

    // The request really went to the catalogue, not through this app.
    assert.ok(world.upstreamRequests.length >= 3, 'one request per homepage tab');
    assert.ok(
      world.upstreamRequests.every((entry) => entry.href.startsWith('https://upstream.test/')),
      'every catalogue request is made against the upstream host'
    );
    assert.ok(
      world.upstreamRequests.every((entry) => entry.init.mode === 'cors' && entry.init.credentials === 'omit'),
      'cross-origin, without this app cookies'
    );
    assert.ok(
      world.upstreamRequests.every((entry) => entry.init.headers['x-sig'] === 'signed'),
      'the requests carry the signatures the ticket handed out'
    );

    // …and the payload is composed exactly like the server path composes it.
    assert.equal(home.mode, 'home');
    assert.equal(home.provider.id, 'vault');
    assert.equal(home.total, TITLES.length);
    assert.ok(home.rails.length >= 3, `expected rails, got ${home.rails.length}`);
    assert.ok(home.facets.genres.some((genre) => genre.id === 'thriller'));

    assert.equal(world.status.exclusiveStatus.getSnapshot().transport, 'direct');
    assert.equal(world.status.exclusiveStatus.getSnapshot().directAvailable, true);
  } finally {
    world.restore();
  }
});

test('the ticket holds no secrets and no arbitrary URLs', async () => {
  const world = createBrowserWorld();
  try {
    await world.direct.loadExclusiveHome('all', NEVER);

    const [login, data] = world.ticketRequests;
    assert.deepEqual(Object.keys(login).sort(), ['calls', 'key'], 'no credential on the login batch');
    assert.deepEqual(login.calls, [{ kind: 'login' }]);
    assert.deepEqual(data.calls, [{ kind: 'home' }], 'the browser only names the kind of call');
    assert.equal(data.token, 'browser-token-abc123', "the browser's own token is what gets attached");

    // The signed batch is bounded: three tab calls for one home request.
    const homeCalls = world.upstreamRequests.filter((entry) => entry.href.includes('tab-operating'));
    assert.equal(homeCalls.length, 3);
    assert.ok(
      homeCalls.every((entry) => entry.init.headers.authorization === 'Bearer browser-token-abc123'),
      'the credential came from the browser, not from the server'
    );
  } finally {
    world.restore();
  }
});

test('the browser logs itself in, so the server never has to reach the catalogue', async () => {
  const world = createBrowserWorld();
  try {
    await world.direct.loadExclusiveHome('all', NEVER);

    const loginRequest = world.upstreamRequests.find((entry) => entry.href.includes('visitor-login'));
    assert.ok(loginRequest, 'the login POST was made by the browser itself');
    assert.equal(loginRequest.init.method, 'POST');
    assert.equal(loginRequest.init.credentials, 'omit');
    assert.equal(loginRequest.init.headers.authorization, undefined, 'a login needs no credential');

    // …and the login is cached, so a second read reuses the token instead of
    // asking for another one.
    const loginsBefore = world.upstreamRequests.filter((entry) => entry.href.includes('visitor-login')).length;
    await world.direct.loadExclusiveSearch({ q: 'night' }, NEVER);
    const loginsAfter = world.upstreamRequests.filter((entry) => entry.href.includes('visitor-login')).length;
    assert.equal(loginsAfter, loginsBefore, 'the visitor token is reused');
  } finally {
    world.restore();
  }
});

test('a login the catalogue refuses falls back to a server-minted ticket', async () => {
  const world = createBrowserWorld({ loginRefused: true });
  try {
    const home = await world.direct.loadExclusiveHome('all', NEVER);
    assert.ok(home.rails.length > 0, 'the collection still loads');
    const last = world.ticketRequests[world.ticketRequests.length - 1];
    assert.equal(last.token, undefined, 'no browser token means the route mints one');
    assert.equal(world.direct.directStatus().enabled, true, 'a refused login is not a CORS refusal');
  } finally {
    world.restore();
  }
});

test('a CORS refusal is silent: it falls back to the relay and never retries the browser path', async () => {
  const world = createBrowserWorld({ corsBlocked: true });
  let relayCalls = 0;
  const relay = async () => {
    relayCalls += 1;
    return { mode: 'home', provider: { id: 'vault', label: 'Vault', attribution: 'relayed', demo: false }, spotlight: null, rails: [], genres: [], facets: { genres: [], years: [], languages: [] }, total: 0, tookMs: 1 };
  };

  try {
    const home = await world.direct.loadExclusiveHome('all', relay);
    assert.equal(relayCalls, 1, 'the relay answers when the browser is refused');
    assert.ok(home);

    const snapshot = world.status.exclusiveStatus.getSnapshot();
    assert.equal(snapshot.transport, 'relay');
    assert.equal(snapshot.directAvailable, false);
    assert.equal(snapshot.directFallbackReason, 'cors_or_network');

    // Second call: the browser path is not attempted again at all.
    const upstreamBefore = world.upstreamRequests.length;
    await world.direct.loadExclusiveHome('movie', relay);
    assert.equal(world.upstreamRequests.length, upstreamBefore, 'a blocked transport is not retried per call');
    assert.equal(relayCalls, 2);
    assert.equal(world.direct.directStatus().enabled, false);

    // Crucially: no user-facing error was raised for a blocked optimisation.
    assert.equal(world.status.exclusiveStatus.getSnapshot().lastError, null);
  } finally {
    world.restore();
  }
});

test('when both transports fail, the saved copy is shown and labelled', async () => {
  const world = createBrowserWorld({ corsBlocked: true });
  try {
    // Prime the snapshot through a healthy direct run first.
    const healthy = createBrowserWorld();
    const seeded = await healthy.direct.loadExclusiveHome('all', NEVER);
    const snapshotJson = healthy.storage.getItem('sidify-exclusive-snapshot-v1');
    healthy.restore();
    world.storage.setItem('sidify-exclusive-snapshot-v1', snapshotJson);

    const home = await world.direct.loadExclusiveHome('all', async () => {
      throw new Error('relay 502');
    });

    assert.ok(home.rails.length > 0, 'the saved copy still has shelves');
    assert.equal(home.total, seeded.total, 'the saved copy is the payload that was saved');
    const status = world.status.exclusiveStatus.getSnapshot();
    assert.equal(status.transport, 'snapshot');
    assert.ok(status.cachedAt > 0, 'the age of the saved copy is known');
  } finally {
    world.restore();
  }
});

test('a relay answer seeds the snapshot, so later outages still show something', async () => {
  const world = createBrowserWorld({ corsBlocked: true });
  try {
    const title = {
      id: 'vault-101',
      slug: 'vault-101-night-train',
      title: 'Night Train',
      kind: 'movie',
      overview: '',
      genres: [{ id: 'thriller', name: 'Thriller' }],
      language: 'en',
    };
    const relayHome = {
      mode: 'home',
      provider: { id: 'vault', label: 'Vault', attribution: 'relayed', demo: false },
      spotlight: title,
      rails: [{ id: 'top10', title: 'Top 10', items: [title] }],
      genres: [],
      facets: { genres: [], years: [], languages: [] },
      total: 1,
      tookMs: 1,
    };

    await world.direct.loadExclusiveHome('all', async () => relayHome);
    const stored = world.direct.cachedListing();
    assert.ok(stored, 'the relay payload was saved as a snapshot');
    assert.equal(stored.titles.length, 1, 'duplicates are collapsed');
    assert.equal(stored.titles[0].slug, 'vault-101-night-train');

    // And that snapshot is what comes back when the relay dies later.
    const fallback = await world.direct.loadExclusiveHome('all', async () => {
      throw new Error('relay 502');
    });
    assert.ok(fallback.rails.length > 0);
    assert.equal(world.status.exclusiveStatus.getSnapshot().transport, 'snapshot');
  } finally {
    world.restore();
  }
});

test('with no direct path and no snapshot, the relay error is the one raised', async () => {
  const world = createBrowserWorld({ corsBlocked: true });
  try {
    await assert.rejects(
      () => world.direct.loadExclusiveHome('all', async () => {
        throw new Error('relay 502');
      }),
      /relay 502/
    );
    assert.equal(world.direct.cachedListing(), null, 'no snapshot was invented');
  } finally {
    world.restore();
  }
});

test('search returns the public page and never leaks the ranking pool', async () => {
  const world = createBrowserWorld();
  try {
    const page = await world.direct.loadExclusiveSearch({ q: 'night' }, NEVER);
    assert.equal(page.mode, 'search');
    assert.ok(page.items.length >= 2, 'both Night Train titles match');
    assert.equal('pool' in page, false, 'the internal pool never reaches the component tree');

    const request = world.upstreamRequests.find((entry) => entry.href.includes('search/v2'));
    assert.ok(request, 'the search was sent from the browser');
    assert.equal(JSON.parse(request.init.body).keyword, 'night');
  } finally {
    world.restore();
  }
});

test('an empty search returns the listing (a landing page, not an empty result set)', async () => {
  const world = createBrowserWorld();
  try {
    const page = await world.direct.loadExclusiveSearch({}, NEVER);
    assert.equal(page.items.length, TITLES.length);
    assert.ok(world.upstreamRequests.every((entry) => !entry.href.includes('search')),
      'an empty query never spends a search request');
  } finally {
    world.restore();
  }
});

test('a title page merges the browser catalogue with server-resolved playback', async () => {
  const world = createBrowserWorld({
    playback: [
      { id: 'dash', url: '/api/media/vault-stream/abc/manifest.mpd', kind: 'dash', quality: '1080p', label: 'Server' },
    ],
  });
  try {
    const payload = await world.direct.loadExclusiveTitle('vault-101-night-train', 'movie', NEVER);
    assert.ok(payload, 'the title resolved');
    assert.equal(payload.detail.title.slug, 'vault-101-night-train');
    assert.equal(payload.detail.title.kind, 'movie');
    assert.ok(payload.detail.playback.length >= 1, 'playback sources are attached');
    assert.ok(
      payload.detail.playback.some((source) => source.url.includes('/api/media/vault-stream/')),
      'the server-signed stream is kept'
    );
    assert.ok(
      payload.detail.releases.length >= 1,
      'direct files from the catalogue are offered as releases'
    );
    assert.ok(payload.recommendations.length >= 1, 'the rest of the collection seeds recommendations');
  } finally {
    world.restore();
  }
});

test('a dead playback route still leaves the catalogue data usable', async () => {
  const world = createBrowserWorld();
  try {
    const payload = await world.direct.loadExclusiveTitle('vault-101-night-train', 'movie', NEVER);
    assert.ok(payload);
    assert.ok(Array.isArray(payload.detail.playback), 'playback is always a list');
    assert.equal(world.direct.directStatus().enabled, true, 'a playback hiccup does not disable the transport');
  } finally {
    world.restore();
  }
});

test('an upstream 502 keeps the transport and lets the caller fall back per request', async () => {
  const world = createBrowserWorld({ upstreamDown: true });
  let relayCalls = 0;
  try {
    const page = await world.direct.loadExclusiveSearch({ q: 'night' }, async () => {
      relayCalls += 1;
      return { mode: 'search', items: [], total: 0, page: 1, pageSize: 24, hasMore: false, tookMs: 1, query: 'night' };
    });
    assert.equal(relayCalls, 1);
    assert.equal(page.query, 'night');
    assert.equal(world.direct.directStatus().enabled, true, 'a 502 is not a CORS refusal');
    // The error was recorded for the console, then cleared by the successful
    // relay answer — the user is looking at real data, so nothing is "wrong".
    assert.equal(world.status.exclusiveStatus.getSnapshot().lastError, null);
  } finally {
    world.restore();
  }
});

test('the direct module never imports a server secret', () => {
  const source = fs.readFileSync(path.join(SRC, 'lib/media/exclusiveDirect.ts'), 'utf8');
  assert.doesNotMatch(source, /vaultCrypto/, 'the HMAC implementation must not be in the browser bundle');
  assert.doesNotMatch(source, /process\.env\.MEDIA_VAULT/, 'no upstream secret is read in the browser');
  assert.doesNotMatch(source, /Buffer\./, 'no Node-only globals');
  assert.match(source, /^"use client";/m);
});

test('the browser path and the relay path compose byte-identical shelves', async () => {
  const world = createBrowserWorld();
  try {
    const viaBrowser = await world.direct.loadExclusiveHome('all', NEVER);

    // The same catalogue pool read through a relay-shaped reader: this is what
    // `/api/media/exclusive` composes from. Both must land on the same rails,
    // spotlight and facets — the transport only decides where bytes come from.
    const core = (() => {
      const loader = createLoader();
      return loader.load(path.join(SRC, 'lib/media/exclusiveCore.ts'));
    })();
    const kinds = { 1: 'movie', 2: 'series' };
    const pool = TITLES.map((subject) => ({
      id: `vault-${subject.subjectId}`,
      slug: `vault-${subject.subjectId}-${subject.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      title: subject.title,
      kind: kinds[subject.subjectType],
      overview: '',
      year: Number(subject.releaseDate.slice(0, 4)),
      rating: subject.imdbRatingValue,
      poster: subject.cover.url,
      genres: subject.genre.map((name) => ({ id: name.toLowerCase(), name })),
      language: 'en',
      languageName: subject.lanName,
    }));
    const relayReader = {
      source: 'relay',
      listing: async () => pool,
      search: async () => pool,
      detail: async () => null,
    };
    const viaRelay = await core.getExclusiveHome(relayReader, 'all');

    assert.deepEqual(
      viaBrowser.rails.map((rail) => [rail.id, rail.items.map((item) => item.slug)]),
      viaRelay.rails.map((rail) => [rail.id, rail.items.map((item) => item.slug)]),
      'every rail holds the same titles in the same order'
    );
    assert.equal(viaBrowser.spotlight?.slug, viaRelay.spotlight?.slug);
    assert.deepEqual(viaBrowser.facets.genres, viaRelay.facets.genres);
    assert.deepEqual(viaBrowser.facets.years, viaRelay.facets.years);
    assert.equal(viaBrowser.total, viaRelay.total);
  } finally {
    world.restore();
  }
});
