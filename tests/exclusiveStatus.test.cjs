const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

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
  return loadModule;
}

/** Fresh modules per test: the status store is deliberately module-level. */
function fresh() {
  const load = createLoader();
  return {
    status: load(path.join(SRC, 'lib/media/exclusiveStatus.ts')),
    banner: load(path.join(SRC, 'components/exclusive/ExclusiveStatusBanner.tsx')),
  };
}

test('the status store starts empty, before any transport has run', () => {
  const { status } = fresh();
  const snapshot = status.exclusiveStatus.getSnapshot();
  assert.equal(snapshot.transport, null);
  assert.equal(snapshot.directAvailable, false);
  assert.equal(snapshot.lastError, null);
  assert.equal(status.exclusiveStatus.getServerSnapshot().transport, null);
});

test('a successful direct read marks the browser path as working', () => {
  const { status } = fresh();
  status.exclusiveStatus.noteDirectFallback('cors_or_network');
  assert.equal(status.exclusiveStatus.getSnapshot().directAvailable, false);

  status.exclusiveStatus.noteSuccess('direct');
  const snapshot = status.exclusiveStatus.getSnapshot();
  assert.equal(snapshot.transport, 'direct');
  assert.equal(snapshot.directAvailable, true);
  assert.equal(snapshot.directFallbackReason, null, 'a working transport clears the old excuse');
  assert.equal(snapshot.lastError, null);
});

test('a relay answer carries the reason the browser path was abandoned', () => {
  const { status } = fresh();
  status.exclusiveStatus.noteDirectFallback('cors_or_network');
  status.exclusiveStatus.noteSuccess('relay');
  const snapshot = status.exclusiveStatus.getSnapshot();
  assert.equal(snapshot.transport, 'relay');
  assert.equal(snapshot.directFallbackReason, 'cors_or_network');
  assert.equal(snapshot.directAvailable, false);
});

test('a snapshot answer is labelled with the age of the copy', () => {
  const { status } = fresh();
  status.exclusiveStatus.noteSuccess('snapshot', 1_700_000_000_000);
  const snapshot = status.exclusiveStatus.getSnapshot();
  assert.equal(snapshot.transport, 'snapshot');
  assert.equal(snapshot.cachedAt, 1_700_000_000_000);
});

test('subscribers are notified on a real change and not on a no-op', () => {
  const { status } = fresh();
  let notifications = 0;
  const unsubscribe = status.exclusiveStatus.subscribe(() => (notifications += 1));

  status.exclusiveStatus.noteSuccess('direct');
  assert.equal(notifications, 1);

  status.exclusiveStatus.noteSuccess('direct');
  assert.equal(notifications, 1, 'the same state must not re-render the section');

  status.exclusiveStatus.noteError('upstream 502');
  assert.equal(notifications, 2);
  assert.equal(status.exclusiveStatus.getSnapshot().transport, null, 'an error clears the transport');
  assert.equal(status.exclusiveStatus.getSnapshot().lastError, 'upstream 502');

  unsubscribe();
  status.exclusiveStatus.noteSuccess('direct');
  assert.equal(notifications, 2, 'an unsubscribed listener is not called');
});

test('the snapshot object identity is stable between reads', () => {
  const { status } = fresh();
  status.exclusiveStatus.noteSuccess('direct');
  assert.equal(status.exclusiveStatus.getSnapshot(), status.exclusiveStatus.getSnapshot());
});

test('age is worded the way a person says it', () => {
  const { banner } = fresh();
  const now = 1_700_000_000_000;
  assert.equal(banner.relativeAge(now - 5_000, now), 'just now');
  assert.equal(banner.relativeAge(now - 60_000, now), '1 minute ago');
  assert.equal(banner.relativeAge(now - 9 * 60_000, now), '9 minutes ago');
  assert.equal(banner.relativeAge(now - 2 * 3_600_000, now), '2 hours ago');
  assert.equal(banner.relativeAge(now - 30 * 3_600_000, now), '1 day ago');
  assert.equal(banner.relativeAge(now - 3 * 24 * 3_600_000, now), '3 days ago');
  // A clock that went backwards must not produce "-4 minutes ago".
  assert.equal(banner.relativeAge(now + 60_000, now), 'just now');
});

test('the banner is quiet in the normal case and loud only about a saved copy', () => {
  const source = fs.readFileSync(path.join(SRC, 'components/exclusive/ExclusiveStatusBanner.tsx'), 'utf8');

  // The direct path is the normal path: say nothing at all.
  assert.doesNotMatch(source, /transport === "direct"/, 'no badge for the normal path');
  assert.doesNotMatch(source, /Live from your connection/);

  // A saved copy must say so, with its age and a Retry control.
  assert.match(source, /Showing a saved copy from/);
  assert.match(source, /relativeAge\(status\.cachedAt\)/);
  assert.match(source, /Retry/);
  assert.match(source, /role="status"/, 'the banner is announced without stealing focus');

  // Raw internal codes are never shown to a person.
  assert.match(source, /plainReason\(status\.directFallbackReason\)/);
  assert.doesNotMatch(source, /\{status\.directFallbackReason\}/);
});

test('a stream issue is recorded without blanking the transport badge', () => {
  const { status } = fresh();
  status.exclusiveStatus.noteSuccess('direct');
  status.exclusiveStatus.noteStreamIssue('session_rejected', 440);

  const snapshot = status.exclusiveStatus.getSnapshot();
  assert.equal(snapshot.transport, 'direct', 'the title itself loaded fine');
  assert.equal(snapshot.streamIssue, 'session_rejected');
  assert.equal(snapshot.streamIssueStatus, 440);
  assert.equal(snapshot.lastError, null, 'a missing stream is not a transport error');
});

test('a resolved source clears the note, and clearing twice is a no-op', () => {
  const { status } = fresh();
  let notifications = 0;
  const unsubscribe = status.exclusiveStatus.subscribe(() => (notifications += 1));

  status.exclusiveStatus.noteStreamIssue('empty');
  assert.equal(notifications, 1);

  status.exclusiveStatus.clearStreamIssue();
  assert.equal(status.exclusiveStatus.getSnapshot().streamIssue, null);
  assert.equal(notifications, 2);

  status.exclusiveStatus.clearStreamIssue();
  assert.equal(notifications, 2, 'nothing changed, so nobody is notified');
  unsubscribe();
});

test('every stream issue has one plain sentence, and none leaks upstream text', () => {
  const { status } = fresh();
  const issues = ['cors_or_network', 'ticket_unavailable', 'session_rejected', 'refused', 'upstream_error', 'empty'];
  for (const issue of issues) {
    const sentence = status.streamIssueSentence(issue, 440);
    assert.equal(typeof sentence, 'string');
    assert.ok(sentence.length > 20, `${issue} explains itself`);
    assert.doesNotMatch(sentence, /undefined|null|\[object/, `${issue} reads like prose`);
  }

  assert.match(status.streamIssueSentence('session_rejected', 440), /440/);
  assert.match(status.streamIssueSentence('refused', 403), /403/);
  assert.equal(status.streamIssueSentence(null), null);
});
