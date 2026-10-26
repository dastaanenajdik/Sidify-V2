const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function readJson(rel) {
  return JSON.parse(read(rel));
}

const DOTS_DIR = path.join(ROOT, 'testing', 'dots');
const dotFiles = fs
  .readdirSync(DOTS_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'space.json')
  .sort();

/**
 * The tester personalities are OpenDots Specialist Dots (see
 * testing/dots/README.md). Their shape must stay importable: every field of
 * the OpenDots `Dot` interface with the right type, pointed at the shared QA
 * Space, with instructions substantial enough to actually steer an agent.
 */
test('every QA Dot matches the OpenDots Dot shape', () => {
  assert.ok(dotFiles.length >= 5, `expected at least 5 Dots, found ${dotFiles.length}`);
  const space = readJson('testing/dots/space.json');
  assert.equal(typeof space.id, 'string');
  assert.equal(typeof space.name, 'string');

  const ids = new Set();
  const names = new Set();
  for (const file of dotFiles) {
    const dot = readJson(`testing/dots/${file}`);
    for (const key of ['id', 'spaceId', 'name', 'instructions']) {
      assert.equal(typeof dot[key], 'string', `${file}: ${key} must be a string`);
      assert.ok(dot[key].length > 0, `${file}: ${key} must not be empty`);
    }
    assert.ok(Array.isArray(dot.spaceIds) && dot.spaceIds.includes(space.id), `${file}: spaceIds must include the QA Space`);
    assert.equal(dot.spaceId, space.id, `${file}: spaceId must be the QA Space`);
    for (const key of ['researchAllowed', 'memoryAllowed', 'appsAllowed', 'skillDeliveryEnabled']) {
      assert.equal(typeof dot[key], 'boolean', `${file}: ${key} must be boolean`);
    }
    assert.ok(Array.isArray(dot.composioToolkits), `${file}: composioToolkits must be an array`);
    assert.equal(typeof dot.createdAt, 'number', `${file}: createdAt must be a number`);
    assert.equal(dot.appsAllowed, false, `${file}: tester Dots must not act on real accounts`);
    assert.ok(dot.instructions.length >= 500, `${file}: instructions too thin to steer a tester (${dot.instructions.length} chars)`);
    assert.ok(!ids.has(dot.id), `duplicate Dot id ${dot.id}`);
    assert.ok(!names.has(dot.name), `duplicate Dot name ${dot.name}`);
    ids.add(dot.id);
    names.add(dot.name);
    assert.equal(`${dot.id}.json`, file, `${file}: file name must be the Dot id`);
  }
});

test('the probe runner exercises every Dot by name', () => {
  const runner = read('scripts/qa-dots.mjs');
  for (const file of dotFiles) {
    const dot = readJson(`testing/dots/${file}`);
    const firstName = dot.name.split(' ')[0];
    assert.match(runner, new RegExp(firstName), `scripts/qa-dots.mjs never mentions ${dot.name}`);
  }
});

/**
 * Kabir's headline bug: library/writer routes parsing request bodies with a
 * bare `await req.json()` turned malformed JSON into a 500 with an empty
 * body. Every such route must go through the shared safe reader.
 */
const BODY_WRITERS = [
  'src/app/api/playlists/route.ts',
  'src/app/api/playlists/[id]/route.ts',
  'src/app/api/downloads/route.ts',
  'src/app/api/library/liked/route.ts',
  'src/app/api/library/recent/route.ts',
  'src/app/api/library/followed/route.ts',
  'src/app/api/library/blocked/route.ts',
  'src/app/api/library/restore/route.ts',
];

test('no body-writing route parses JSON without the safe reader', () => {
  for (const route of BODY_WRITERS) {
    const source = read(route);
    assert.match(source, /readJsonBody/, `${route} does not use readJsonBody`);
    assert.doesNotMatch(source, /await req\.json\(\)/, `${route} still calls req.json() directly`);
    assert.match(source, /Invalid JSON body/, `${route} does not answer 400 for a bad body`);
  }
});

test('the safe reader itself never throws and rejects non-objects', () => {
  const source = read('src/lib/readJsonBody.ts');
  assert.match(source, /try \{[\s\S]*req\.json\(\)[\s\S]*\} catch/);
  assert.match(source, /Array\.isArray/);
  assert.match(source, /!== null/);
});

test('unknown API paths have a JSON 404 catch-all', () => {
  const source = read('src/app/api/[...slug]/route.ts');
  assert.match(source, /status: 404/);
  assert.match(source, /NextResponse\.json/);
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.match(source, new RegExp(`export const ${method}`), `catch-all must handle ${method}`);
  }
});

test('release-stable public assets are browser-cached (Ira/Zoya)', () => {
  const config = read('next.config.ts');
  assert.match(config, /\/covers\/:path\*/, 'covers must have a cache header rule');
  assert.match(config, /max-age=604800/, 'icons/covers must cache for a week');
  // The service worker itself must stay revalidated or PWAs pin a stale shell.
  assert.match(config, /"\/sw\.js"[\s\S]*?max-age=0/);
});
