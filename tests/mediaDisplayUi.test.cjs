const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const filename = path.resolve(__dirname, '../src/lib/media/displayText.ts');
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, filename);
const { mediaDisplayText } = loaded.exports;

test('provider branding is removed from display text without altering other text', () => {
  assert.equal(mediaDisplayText('[HDHub4u.Tv] Movie.1080p.mkv'), 'Movie.1080p.mkv');
  assert.equal(mediaDisplayText('Movie via hdhub4ua'), 'Movie via');
  assert.equal(mediaDisplayText('www.4KHDHub.one', 'Download server'), 'Download server');
  assert.equal(mediaDisplayText('Movie.2026.1080p.mkv'), 'Movie.2026.1080p.mkv');
});

test('download and VLC sheets sanitize labels only, preserving resolver inputs', () => {
  for (const file of ['QualityPickerSheet.tsx', 'VlcPickerSheet.tsx']) {
    const src = fs.readFileSync(path.resolve(__dirname, '../src/components/media', file), 'utf8');
    assert.match(src, /mediaDisplayText\(release\.fileName/);
    if (file === "QualityPickerSheet.tsx") assert.match(src, /fileName: release\.fileName/);
    else assert.match(src, /resolveReleaseStreams\(release/);
  }
  const telegram = fs.readFileSync(path.resolve(__dirname, '../src/components/media/TelegramDownloadButton.tsx'), 'utf8');
  assert.match(telegram, /max-w-full/);
  assert.match(telegram, /break-words/);
  assert.doesNotMatch(telegram, /whitespace-nowrap/);
});
