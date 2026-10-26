const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const { NextRequest } = require('next/server');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

/**
 * The ticket route signs upstream requests on demand, so its *contract* is what
 * matters: what a caller may ask for, what comes back, and what must never come
 * back. The real signer needs the deployment's HMAC key, so the vault client is
 * stubbed here — everything above that line (validation, caps, rate limiting,
 * token handling, response headers) is the code under test.
 */

const AUTH_TOKENS = [];
const SIGNED_PATHS = [];

function createLoader({ failMint = false } = {}) {
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

    // The signer is replaced: this test must not depend on a deployment key.
    if (targetFile.endsWith(path.join('lib', 'media', 'vaultClient.ts'))) {
      const fake = {
        getVaultClient: () => ({
          async mintEphemeralSession() {
            AUTH_TOKENS.push('minted');
            if (failMint) throw new Error('upstream login refused');
            return 'visitor-token-0001';
          },
          signedCall(method, pathAndQuery, body, token, options) {
            SIGNED_PATHS.push({ method, pathAndQuery, body, token, options });
            return {
              url: `https://upstream.test${pathAndQuery}`,
              headers: {
                'user-agent': 'Fixture/1.0',
                'x-tr-signature': `sig-${SIGNED_PATHS.length}`,
                'x-client-token': 'client-token',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
              },
              body,
            };
          },
        }),
      };
      cache.set(targetFile, { exports: fake });
      return fake;
    }

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

const route = createLoader().load(path.join(SRC, 'app/api/media/exclusive/ticket/route.ts'));

/** A POST with a distinct caller address, so tests do not share a rate bucket. */
let callerIndex = 0;
function post(body, { ip } = {}) {
  callerIndex += 1;
  const address = ip || `203.0.113.${callerIndex % 250}`;
  const request = new NextRequest('http://localhost/api/media/exclusive/ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return route.POST(request);
}

/* -------------------------------- success -------------------------------- */

test('a home ticket expands to one signed call per homepage tab', async () => {
  SIGNED_PATHS.length = 0;
  const response = await post({ key: 'abcdefgh1234', calls: [{ kind: 'home' }] });
  assert.equal(response.status, 200);

  const payload = await response.json();
  assert.equal(payload.calls.length, 3, 'three tabs, three requests');
  assert.ok(payload.expiresAt > payload.issuedAt, 'the ticket states when it goes stale');
  for (const call of payload.calls) {
    assert.equal(call.kind, 'home');
    assert.equal(call.method, 'GET');
    assert.match(call.url, /^https:\/\/upstream\.test\/wefeed-mobile-bff\/tab-operating\?/);
    assert.match(call.url, /tabId=(?:2|1|3)\b/);
    assert.ok(call.headers['x-tr-signature'], 'each call carries its own signature');
    assert.equal(call.expiresAt, payload.expiresAt);
  }

  // Signed, never cached: a browser cache or CDN must not replay signatures.
  assert.match(response.headers.get('cache-control') || '', /no-store/);

  // The request will leave from the user's own connection, so it must not
  // claim a forwarded address that contradicts the socket.
  assert.ok(
    SIGNED_PATHS.every((entry) => entry.options?.forwardedFor === false),
    'browser-bound calls are signed with the truthful origin'
  );
});

test('a search ticket signs the POST with the validated keyword only', async () => {
  SIGNED_PATHS.length = 0;
  const response = await post({ calls: [{ kind: 'search', term: '  night train  ' }] });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const [call] = payload.calls;

  assert.equal(call.kind, 'search');
  assert.equal(call.method, 'POST');
  assert.equal(call.url, 'https://upstream.test/wefeed-mobile-bff/subject-api/search/v2');
  assert.deepEqual(JSON.parse(call.body), { keyword: 'night train', page: 1, perPage: 15, subjectType: 0 });
  assert.equal(SIGNED_PATHS[0].body, call.body, 'the signature covers the body the browser will send');
});

test('a detail batch signs the subject and its resource list together', async () => {
  SIGNED_PATHS.length = 0;
  const response = await post({
    calls: [
      { kind: 'detail', subjectId: '101' },
      { kind: 'resource', subjectId: '101', se: 2, ep: 7 },
    ],
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.deepEqual(payload.calls.map((call) => call.id), ['detail', 'resource']);
  assert.match(payload.calls[0].url, /subject-api\/get\?subjectId=101$/);
  assert.match(payload.calls[1].url, /subject-api\/resource\?subjectId=101&se=2&ep=7&page=1&perPage=20$/);
});

test('the caller names a kind of call — never a URL', async () => {
  SIGNED_PATHS.length = 0;
  const response = await post({
    calls: [{ kind: 'home', url: 'https://evil.test/collect', host: 'evil.test', path: '/etc/passwd' }],
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  for (const call of payload.calls) {
    assert.ok(call.url.startsWith('https://upstream.test/'), `unexpected host: ${call.url}`);
    assert.ok(!call.url.includes('evil.test'));
    assert.ok(!call.url.includes('/etc/passwd'));
  }
  assert.ok(SIGNED_PATHS.every((entry) => entry.pathAndQuery.startsWith('/wefeed-mobile-bff/')),
    'only the known upstream paths are ever signed');
});

test('ephemeral visitor tokens are reused per browser key and never shared across keys', async () => {
  const before = AUTH_TOKENS.length;
  await post({ key: 'browserkey01', calls: [{ kind: 'detail', subjectId: '101' }] });
  const afterFirst = AUTH_TOKENS.length;
  assert.equal(afterFirst - before, 1, 'the first request mints a visitor token');

  await post({ key: 'browserkey01', calls: [{ kind: 'detail', subjectId: '102' }] });
  assert.equal(AUTH_TOKENS.length, afterFirst, 'a repeat within the TTL reuses it');

  await post({ key: 'browserkey02', calls: [{ kind: 'detail', subjectId: '103' }] });
  assert.equal(AUTH_TOKENS.length, afterFirst + 1, 'another browser gets its own token');

  // Every signed call is bound to the ephemeral token, not to a process session.
  const lastCalls = SIGNED_PATHS.slice(-1);
  assert.equal(lastCalls[0].token, 'visitor-token-0001');
});

test('a login ticket needs no credential and is signed for the browser', async () => {
  SIGNED_PATHS.length = 0;
  AUTH_TOKENS.length = 0;
  const response = await post({ calls: [{ kind: 'login' }] });
  assert.equal(response.status, 200, 'signing a login works without any upstream reachability');

  const payload = await response.json();
  assert.equal(payload.calls.length, 1);
  const [call] = payload.calls;
  assert.equal(call.id, 'login');
  assert.equal(call.kind, 'login');
  assert.equal(call.method, 'POST');
  assert.match(call.url, /user-api\/visitor-login$/);
  assert.equal(call.body, '{}');
  assert.equal(call.headers.authorization, undefined, 'a login carries no token');
  assert.ok(call.headers['x-tr-signature'], 'but it is signed');

  assert.equal(AUTH_TOKENS.length, 0, 'signing a login must not require the server to log in');
});

test("the browser's own token is attached instead of minting one", async () => {
  SIGNED_PATHS.length = 0;
  AUTH_TOKENS.length = 0;
  const response = await post({
    key: 'browsertoken01',
    token: 'browser-obtained-token-9999',
    calls: [{ kind: 'detail', subjectId: '101' }],
  });
  assert.equal(response.status, 200);

  assert.equal(AUTH_TOKENS.length, 0, 'no server-side login was needed');
  assert.equal(SIGNED_PATHS[0].token, 'browser-obtained-token-9999');
  const payload = await response.json();
  assert.equal(payload.calls[0].headers.authorization, 'Bearer browser-obtained-token-9999');
});

test('a junk token is ignored, not echoed', async () => {
  SIGNED_PATHS.length = 0;
  const response = await post({
    key: 'junktoken0001',
    token: 'x',
    calls: [{ kind: 'detail', subjectId: '101' }],
  });
  assert.equal(response.status, 200);
  // Too short to be a token, so the route mints its own instead.
  assert.notEqual(SIGNED_PATHS[0].token, 'x');
  assert.ok(SIGNED_PATHS[0].token.length > 8);
  const payload = await response.json();
  assert.doesNotMatch(payload.calls[0].headers.authorization || '', /Bearer x$/);
});

/* ------------------------------- rejections ------------------------------ */

test('malformed batches are rejected before any signing happens', async () => {
  SIGNED_PATHS.length = 0;
  const cases = [
    {},
    { calls: [] },
    { calls: [{ kind: 'home' }, { kind: 'home' }, { kind: 'home' }, { kind: 'home' }, { kind: 'home' }] },
    { calls: [{ kind: 'unknown' }] },
    { calls: [{ kind: 'search' }] },
    { calls: [{ kind: 'search', term: '   ' }] },
    { calls: [{ kind: 'search', term: 'x'.repeat(200) }] },
    { calls: [{ kind: 'detail' }] },
    { calls: [{ kind: 'detail', subjectId: 'DROP TABLE' }] },
    { calls: [null] },
  ];

  for (const body of cases) {
    const response = await post(body);
    assert.equal(response.status, 400, `expected 400 for ${JSON.stringify(body)}`);
    const payload = await response.json();
    assert.ok(payload.error, 'a rejection explains itself');
  }

  assert.equal(SIGNED_PATHS.length, 0, 'a rejected batch must never cost an upstream signature');
});

test('an out-of-range episode hint is dropped, not fatal', async () => {
  const response = await post({ calls: [{ kind: 'resource', subjectId: '101', se: -3, ep: 99999 }] });
  assert.equal(response.status, 200, 'a bad hint must not cost the whole batch');
  const payload = await response.json();
  assert.doesNotMatch(payload.calls[0].url, /[?&]se=/, 'the invalid season is not forwarded');
});

test('a batch cannot expand past the signing cap', async () => {
  // Two home calls = six signed requests, which is exactly the cap.
  const allowed = await post({ calls: [{ kind: 'home' }, { kind: 'home' }] });
  assert.equal(allowed.status, 200);

  // Two home calls plus a search = seven: refused.
  const refused = await post({ calls: [{ kind: 'home' }, { kind: 'home' }, { kind: 'search', term: 'night' }] });
  assert.equal(refused.status, 400);
});

test('a broken signer answers 503, not a 500', async () => {
  const failing = createLoader({ failMint: true }).load(path.join(SRC, 'app/api/media/exclusive/ticket/route.ts'));
  const request = new NextRequest('http://localhost/api/media/exclusive/ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.77' },
    body: JSON.stringify({ calls: [{ kind: 'home' }] }),
  });
  const response = await failing.POST(request);
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.code, 'ticket_unavailable');
  assert.equal(response.headers.get('cache-control'), 'no-store');
});

test('one caller cannot spin the signer: the route rate-limits', async () => {
  let limited = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await post({ calls: [{ kind: 'detail', subjectId: '101' }] }, { ip: '192.0.2.55' });
    if (response.status === 429) {
      limited = response;
      break;
    }
  }
  assert.ok(limited, 'the burst must eventually be refused');
  assert.match(limited.headers.get('retry-after') || '', /^\d+$/);
  assert.match(limited.headers.get('cache-control') || '', /no-store/);

  // Another caller is unaffected.
  const other = await post({ calls: [{ kind: 'detail', subjectId: '101' }] }, { ip: '192.0.2.56' });
  assert.equal(other.status, 200);
});

/* ------------------------------ no leakage ------------------------------- */

test('the ticket response carries signatures and an ephemeral token — no secrets', async () => {
  const response = await post({ key: 'leakcheck01', calls: [{ kind: 'detail', subjectId: '101' }] });
  const text = await response.text();

  // Nothing that identifies this deployment may appear in the body.
  for (const forbidden of ['MEDIA_VAULT', 'VAULT_HMAC', 'HMAC', 'hmac', 'secret', 'SECRET', process.env.HOME || '###']) {
    assert.ok(!text.includes(forbidden), `the ticket body must not include "${forbidden}"`);
  }
  const payload = JSON.parse(text);
  const keys = JSON.stringify(Object.keys(payload));
  assert.match(keys, /issuedAt/);
  assert.match(keys, /expiresAt/);
  assert.match(keys, /calls/);
});

test('the route holds no signing implementation of its own', () => {
  const source = fs.readFileSync(path.join(SRC, 'app/api/media/exclusive/ticket/route.ts'), 'utf8');
  assert.doesNotMatch(source, /createHmac/, 'signing stays in vaultCrypto.ts');
  assert.doesNotMatch(source, /process\.env\.[A-Z_]*SECRET/, 'no secret is read or echoed here');
  // The HMAC key is the one thing that must never travel.
  assert.doesNotMatch(source, /hmacKey|signKey/i);
});
