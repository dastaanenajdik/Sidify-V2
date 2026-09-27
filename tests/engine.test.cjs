const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Compiles a src/lib module to CommonJS and evaluates only the exports we need, with
// the imports stubbed. `engine.ts` pulls in youtubei.js lazily (dynamic import) so
// loading it here never touches the network.
function load(name, modules = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.resolve(__dirname, `../src/lib/${name}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(code, {
    exports, module: { exports }, console, URL, URLSearchParams, TextEncoder, TextDecoder, atob, btoa,
    setTimeout, clearTimeout, Date, Map, Set, Promise, Error, globalThis: {},
    require: (id) => {
      if (id === 'node:vm') return { ...vm, default: vm };
      if (modules[id]) return modules[id];
      throw new Error(`unexpected import ${id}`);
    },
  });
  return exports;
}

const parserStub = new Proxy({}, { get: () => () => null });
const engine = load('engine', { './parser': parserStub, './types': {} });
const naming = load('downloadName');

/* --------------------------- decipher / n-transform --------------------------- */

// A miniature `base.js` with the exact structure youtubei.js's nsig matcher looks for:
// a 3-arg function that wraps the URL in a constructor and calls `.set("alr","yes")`.
// The URL class rewrites `n` when any of its methods runs — like the real player does.
const FAKE_PLAYER_JS = `
var _yt_player = {};
(function(g) {
var window = this;
var Nz = function(a) { return a.split('').reverse().join('') + '_ok'; };
g.Ka = class { constructor(url) { this.params = new Map(); var q = url.split('?')[1] || ''; var parts = q.split('&'); for (var i = 0; i < parts.length; i++) { var kv = parts[i].split('='); this.params.set(kv[0], decodeURIComponent(kv[1] || '')); } }
  set(k, v) { this.params.set(k, v); return this; }
  get(k) { return this.params.get(k); }
  fix() { var n = this.params.get('n'); if (n) this.params.set('n', Nz(n)); } };
var Rq = function(url, sigName = "", sigValue = "") {
  url = new g.Ka(url);
  url.set("alr", "yes");
  if (sigValue) url.set(sigName, sigValue.split('').reverse().join(''));
  return url;
};
var cfg = function() { return { signatureTimestamp: 20345 }; };
g.Rq = Rq;
})(_yt_player);
`;

async function buildFakePlayer() {
  const yt = await import('youtubei.js');
  const analyzer = new yt.JsAnalyzer(FAKE_PLAYER_JS, {
    extractions: [
      { friendlyName: 'nsigFunction', match: yt.JsMatchers.nsigMatcher },
      { friendlyName: 'signatureTimestampVar', match: yt.JsMatchers.timestampMatcher, collectDependencies: false },
    ],
  });
  const data = new yt.JsExtractor(analyzer).buildScript({
    disallowSideEffectInitializers: true,
    exportRawValues: true,
    rawValueOnly: ['signatureTimestampVar'],
  });
  assert.ok(data.exported.includes('nsigFunction'), 'fixture must be extractable like a real player');
  return { yt, data, player: new yt.Player('fake-player', 20345, data) };
}

test('the script youtubei.js builds is a function body: a plain vm script rejects it', async () => {
  const { yt, data } = await buildFakePlayer();
  // This is exactly what Player.decipher hands to Platform.shim.eval.
  const output = `${data.output}\n${yt.Utils.getNsigProcessorFn('abc', '', '')}`;
  assert.match(output, /return process\(/);
  assert.throws(() => vm.runInNewContext(output, {}), /Illegal return statement/);
});

test('evaluatePlayerScript runs the function-body script and returns { sig, n }', async () => {
  const { yt, data } = await buildFakePlayer();
  const script = { ...data, output: `${data.output}\n${yt.Utils.getNsigProcessorFn('abc', '', '')}` };
  const result = engine.evaluatePlayerScript(script.output, { n: 'abc' });
  assert.equal(result.n, 'cba_ok');
});

test('Player.decipher through our evaluator transforms the n throttle token on pre-signed URLs', async () => {
  const { yt, player } = await buildFakePlayer();
  yt.Platform.load({ ...yt.Platform.shim, eval: (d, env) => engine.evaluatePlayerScript(d.output, env) });
  const url = await player.decipher('https://rr1.googlevideo.com/videoplayback?expire=1&n=abc123&itag=140', undefined, undefined, new Map());
  const u = new URL(url);
  assert.equal(u.searchParams.get('n'), '321cba_ok');
  assert.equal(u.searchParams.get('itag'), '140');
});

test('Player.decipher through our evaluator also solves signature ciphers', async () => {
  const { yt, player } = await buildFakePlayer();
  yt.Platform.load({ ...yt.Platform.shim, eval: (d, env) => engine.evaluatePlayerScript(d.output, env) });
  const inner = 'https://rr1.googlevideo.com/videoplayback?expire=1&n=qwe&itag=140';
  const url = await player.decipher(undefined, `s=XYZsig&sp=sig&url=${encodeURIComponent(inner)}`, undefined, new Map());
  const u = new URL(url);
  assert.equal(u.searchParams.get('sig'), 'gisZYX');
  assert.equal(u.searchParams.get('n'), 'ewq_ok');
});

test('evaluatePlayerScript still accepts legacy completion-value scripts', () => {
  const out = engine.evaluatePlayerScript('({ sig: "s", n: "x" })');
  assert.equal(out.sig, 's');
  assert.equal(out.n, 'x');
});

/* ------------------------------ format ranking ------------------------------ */

test('audio-only AAC beats muxed video, OTF, dubbed and DRC variants', () => {
  const rank = engine.rankAudioFormat;
  const aac = { has_audio: true, has_video: false, mime_type: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 130000, is_original: true };
  const opus = { has_audio: true, has_video: false, mime_type: 'audio/webm; codecs="opus"', bitrate: 160000, is_original: true };
  const muxed = { has_audio: true, has_video: true, mime_type: 'video/mp4', bitrate: 700000, is_original: true };
  const otf = { ...aac, is_type_otf: true };
  const dub = { ...aac, is_original: false, is_dubbed: true, bitrate: 256000 };
  const drc = { ...aac, is_drc: true, bitrate: 256000 };
  assert.ok(rank(aac) > rank(opus), 'mp4/AAC preferred for Safari compatibility');
  assert.ok(rank(aac) > rank(muxed), 'never stream a video file for its audio');
  assert.ok(rank(aac) > rank(otf));
  assert.ok(rank(aac) > rank(dub));
  assert.ok(rank(aac) > rank(drc));
  assert.ok(rank({ ...aac, bitrate: 256000 }) > rank(aac), 'higher bitrate wins among equals');
});

/* ------------------------------- file naming ------------------------------- */

test('download file names are honest about the container and safe on every OS', () => {
  assert.equal(naming.audioExtension('audio/mp4; codecs="mp4a.40.2"'), 'm4a');
  assert.equal(naming.audioExtension('audio/webm; codecs="opus"'), 'webm');
  assert.equal(naming.audioExtension(null), 'm4a');
  assert.equal(naming.downloadFileName('Kesariya (From "Brahmastra")', 'Arijit Singh', 'audio/mp4'), 'Kesariya (From Brahmastra ) - Arijit Singh.m4a');
  assert.equal(naming.downloadFileName('a/b\\c:d*e?f<g>h|i', '', 'audio/webm'), 'a b c d e f g h i.webm');
  assert.equal(naming.downloadFileName('', '', undefined), 'audio.m4a');
});

test('Content-Disposition carries an ASCII fallback and a UTF-8 filename*', () => {
  const header = naming.contentDisposition('तुम ही हो - Arijit Singh.m4a');
  assert.match(header, /^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''/);
  assert.ok(header.includes(encodeURIComponent('तुम ही हो')));
});
