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
      for (const ext of ['.ts', '.js']) {
        const candidate = path.resolve(path.dirname(parent.filename), `${request}${ext}`);
        if (fs.existsSync(candidate)) return loadTs(path.relative(__dirname, candidate));
      }
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    const out = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    compiled._compile(out, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const { TokenBucketLimiter, callerKey } = loadTs('../src/lib/media/rateLimit.ts');

/** A limiter with a controllable clock. */
function clocked(options) {
  let now = 0;
  const limiter = new TokenBucketLimiter({ ...options, now: () => now });
  return { limiter, advance: (ms) => (now += ms) };
}

test('a bucket allows exactly its capacity, then refuses', () => {
  const { limiter } = clocked({ capacity: 3, refillPerSecond: 1 });
  assert.equal(limiter.take('a').allowed, true);
  assert.equal(limiter.take('a').allowed, true);
  const third = limiter.take('a');
  assert.equal(third.allowed, true);
  assert.equal(third.remaining, 0);

  const fourth = limiter.take('a');
  assert.equal(fourth.allowed, false, 'the fourth call in the burst is refused');
  assert.equal(fourth.remaining, 0);
  assert.ok(fourth.retryAfterMs > 0, 'a refusal says when to come back');
});

test('tokens refill over time, and a refusal reports the wait', () => {
  const { limiter, advance } = clocked({ capacity: 2, refillPerSecond: 1 });
  limiter.take('a');
  limiter.take('a');
  assert.equal(limiter.take('a').allowed, false);

  advance(1_000);
  assert.equal(limiter.take('a').allowed, true, 'one second buys one token');

  // After being refused with 0 tokens, the wait is `1 / refillPerSecond`.
  const refused = limiter.take('a');
  assert.equal(refused.allowed, false);
  assert.ok(refused.retryAfterMs >= 900 && refused.retryAfterMs <= 1_100, `unexpected wait ${refused.retryAfterMs}`);
});

test('the bucket never refills past its capacity', () => {
  const { limiter, advance } = clocked({ capacity: 2, refillPerSecond: 1 });
  advance(60_000);
  assert.equal(limiter.take('a').allowed, true);
  assert.equal(limiter.take('a').allowed, true);
  assert.equal(limiter.take('a').allowed, false, 'a long idle period does not create an unbounded burst');
});

test('callers do not share a bucket', () => {
  const { limiter } = clocked({ capacity: 1, refillPerSecond: 0.01 });
  assert.equal(limiter.take('alice').allowed, true);
  assert.equal(limiter.take('alice').allowed, false);
  assert.equal(limiter.take('bob').allowed, true, "bob's burst is unaffected by alice");
});

test('the bucket table is bounded', () => {
  const { limiter } = clocked({ capacity: 1, refillPerSecond: 1, maxKeys: 16 });
  for (let index = 0; index < 200; index += 1) limiter.take(`caller-${index}`);
  assert.ok(limiter.size <= 16, `expected a bounded table, got ${limiter.size}`);
});

test('reset clears every bucket', () => {
  const { limiter } = clocked({ capacity: 1, refillPerSecond: 0.01 });
  limiter.take('a');
  limiter.reset();
  assert.equal(limiter.size, 0);
  assert.equal(limiter.take('a').allowed, true);
});

test("the caller key prefers the proxy's first forwarded address", () => {
  assert.equal(callerKey(new Headers({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' })), '203.0.113.9');
  assert.equal(callerKey(new Headers({ 'x-forwarded-for': '  203.0.113.9  ' })), '203.0.113.9');
  assert.equal(callerKey(new Headers({ 'x-real-ip': '198.51.100.4' })), '198.51.100.4');
  assert.equal(callerKey(new Headers({ 'cf-connecting-ip': '198.51.100.5' })), '198.51.100.5');
  // A header-less request still gets a bucket, never an unlimited pass.
  assert.equal(callerKey(new Headers()), 'unknown');
});
