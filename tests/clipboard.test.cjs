const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, '../src/lib/clipboard.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function setup(clipboard, fallback = true) {
  const state = { removed: false, restoredFocus: false, selected: false, restoredRange: false };
  class HTMLElement {
    focus() { state.restoredFocus = true; }
  }
  const range = { cloneRange() { return this; } };
  const textarea = {
    style: {}, value: '', setAttribute() {}, focus() {},
    select() { state.selected = true; },
    setSelectionRange(start, end) { state.range = [start, end]; },
    remove() { state.removed = true; },
  };
  const exports = {};
  vm.runInNewContext(code, {
    exports, navigator: { clipboard }, HTMLElement,
    window: { getSelection: () => ({
      rangeCount: 1, getRangeAt: () => range, removeAllRanges() {},
      addRange(value) { state.restoredRange = value === range; },
    }) },
    document: {
      activeElement: new HTMLElement(),
      createElement: () => textarea,
      body: { appendChild() {} },
      execCommand(command) {
        assert.equal(command, 'copy');
        state.copied = textarea.value;
        if (fallback instanceof Error) throw fallback;
        return fallback;
      },
    },
  });
  return { copyText: exports.copyText, state };
}

const lyrics = 'पहली पंक्ति 🎵\nSecond line\n\nFinal verse';

test('copies all lyrics and preserves Unicode and stanza breaks', async () => {
  let copied;
  const { copyText, state } = setup({ writeText: async (text) => { copied = text; } });
  await copyText(lyrics);
  assert.equal(copied, lyrics);
  assert.equal(state.selected, false);
});

for (const [name, clipboard] of [
  ['unavailable', undefined],
  ['denied', { writeText: async () => { throw new Error('Denied'); } }],
]) {
  test(`falls back when Clipboard API is ${name} and restores focus and selection`, async () => {
    const { copyText, state } = setup(clipboard);
    await copyText(lyrics);
    assert.equal(state.copied, lyrics);
    assert.deepEqual(state.range, [0, lyrics.length]);
    assert.equal(state.removed, true);
    assert.equal(state.restoredFocus, true);
    assert.equal(state.restoredRange, true);
  });
}

for (const fallback of [false, new Error('Unsupported')]) {
  test(`reports fallback failure (${fallback}) and removes the temporary textarea`, async () => {
    const { copyText, state } = setup(undefined, fallback);
    await assert.rejects(copyText(lyrics));
    assert.equal(state.removed, true);
    assert.equal(state.restoredFocus, true);
    assert.equal(state.restoredRange, true);
  });
}
