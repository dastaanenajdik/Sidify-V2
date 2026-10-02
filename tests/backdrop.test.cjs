const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const filename = path.resolve(__dirname, '../src/lib/backdrop.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { DELUXE_ART, ART_COUNT } = compiled.exports;

test('catalogue excludes salon images and keeps the original asset IDs', () => {
  assert.equal(ART_COUNT, 10);
  assert.deepEqual(DELUXE_ART.map(a => a.id), [2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
  for (const art of DELUXE_ART) {
    for (const src of [art.src, art.srcSmall]) {
      assert.ok(fs.existsSync(path.resolve(__dirname, '../public' + src)), src);
      assert.ok(src.includes(`lux-${String(art.id).padStart(2, '0')}`));
    }
  }
});

test('slideshow and its controls are mounted only inside the full player', () => {
  const read = p => fs.readFileSync(path.resolve(__dirname, '../src/' + p), 'utf8');
  assert.doesNotMatch(read('app/layout.tsx'), /DeluxeBackdrop/);
  assert.doesNotMatch(read('app/page.tsx'), /DeluxeArtDots/);
  assert.match(read('components/FullPlayer.tsx'), /<DeluxeBackdrop \/>/);
  assert.match(read('components/FullPlayer.tsx'), /<DeluxeArtDots/);
  assert.match(read('components/DeluxeBackdrop.tsx'), /absolute inset-0 z-0/);
});
