const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

/**
 * The feature matrix is the contract between the recon and the build. These
 * guards implement the `replica-diff` preflight rule: a malformed row or a
 * missing must-have means the work is not shippable.
 */
test('the replica feature matrix is complete, parseable and shippable', async () => {
  const module = await import(path.join(ROOT, 'tools/replica-parity.mjs'));
  const rows = module.loadFeatures(path.join(ROOT, 'replica/features.csv'));

  assert.ok(rows.length >= 20, `expected a real matrix, found ${rows.length} rows`);
  assert.ok(rows.every((row) => row.feature && row.area && row.priority), 'every row needs feature, area and priority');

  const result = module.scoreFeatures(rows);
  assert.deepEqual(result.malformed, [], 'no row may be shifted or use an unknown clone value');
  assert.deepEqual(result.missingMust, [], 'every must-have must be implemented');
  assert.equal(result.shippable, true);
  assert.ok(result.score >= 90, `parity should be at least 90%, got ${result.score}%`);
  assert.ok(result.skipped >= 3, 'content, brand and monetisation rows are explicitly out of scope');
});

test('the parity formula weights must > should > could and halves partials', async () => {
  const module = await import(path.join(ROOT, 'tools/replica-parity.mjs'));

  const rows = [
    { feature: 'a', area: 'x', priority: 'must', clone: 'yes' },
    { feature: 'b', area: 'x', priority: 'should', clone: 'partial' },
    { feature: 'c', area: 'x', priority: 'could', clone: 'no' },
    { feature: 'd', area: 'x', priority: '-', clone: 'skip' },
  ];
  const result = module.scoreFeatures(rows);
  // (5*1 + 3*0.5 + 1*0) / (5 + 3 + 1) = 6.5 / 9 = 72.2%
  assert.equal(result.score, 72.2);
  assert.equal(result.skipped, 1);
  assert.equal(result.shippable, true, 'a missing "could" is still shippable');

  const missingMust = module.scoreFeatures([{ feature: 'x', area: 'y', priority: 'must', clone: 'no' }]);
  assert.equal(missingMust.shippable, false);
  assert.deepEqual(missingMust.missingMust, ['x']);
});
