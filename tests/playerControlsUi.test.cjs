const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { act } = React;
const { JSDOM } = require('jsdom');

const filename = path.resolve(__dirname, '../src/components/media/PlayerControls.tsx');
const componentModule = new Module(filename, module);
componentModule.filename = filename;
componentModule.paths = Module._nodeModulePaths(path.dirname(filename));
componentModule._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { PlayerControls, BUFFERING_TIP } = componentModule.exports;

test('in-player menus operate on the current stream and offer the release quality fallback', async () => {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.com' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const calls = [];
  const videoRef = { current: null };
  const handleRef = { current: { selectVideoQuality: (v) => calls.push(['quality', v]), selectTextTrack: (v) => calls.push(['text', v]), selectAudioTrack: (v) => calls.push(['audio', v]) } };
  const props = {
    videoRef, handleRef,
    audio: [{ id: 3, label: 'Hindi', active: true }],
    text: [{ id: 5, label: 'English', active: false }],
    video: [{ id: 8, height: 720, active: true }],
    releases: [{ label: '480p file', selected: false, onSelect: () => calls.push(['release', 0]) }],
  };
  await act(async () => root.render(React.createElement('div', null, React.createElement('video', { ref: videoRef }), React.createElement(PlayerControls, props))));
  const click = async (label) => {
    const button = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label || b.getAttribute('aria-label') === label);
    assert.ok(button, `button ${label} exists`);
    await act(async () => button.click());
  };
  await click('Quality'); await click('720p');
  await click('Quality'); await click('Auto (adaptive)');
  await click('Quality'); await click('480p file');
  await click('Subtitles'); await click('English');
  await click('Subtitles'); await click('Off');
  await click('Audio'); await click('Hindi');
  await click('Speed'); await click('1.5×');
  assert.equal(videoRef.current.playbackRate, 1.5);
  assert.deepEqual(calls, [['quality', 720], ['quality', 'auto'], ['release', 0], ['text', 5], ['text', null], ['audio', 3]]);
  assert.match(BUFFERING_TIP, /buffering.*quality kam/i);
  await act(async () => root.unmount());
  dom.window.close();
  delete global.window; delete global.document; delete global.IS_REACT_ACT_ENVIRONMENT;
});

test('homepage places movie recommendations and room after music', () => {
  const home = fs.readFileSync(path.resolve(__dirname, '../src/app/page.tsx'), 'utf8');
  assert.ok(home.indexOf('Top picks for you') < home.indexOf('Movies recommended for you'));
  assert.ok(home.indexOf('Movies recommended for you') < home.indexOf('<RoomInvite />'));
  assert.ok(home.indexOf('<RoomInvite />') < home.indexOf('Quick picks'));
});
