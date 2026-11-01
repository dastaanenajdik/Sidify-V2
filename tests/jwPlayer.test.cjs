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
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request.startsWith('.') && parent && parent.filename) {
      const candidateTs = path.resolve(path.dirname(parent.filename), `${request}.ts`);
      if (fs.existsSync(candidateTs)) return loadTs(candidateTs);
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    compiled._compile(output, filename);
    return compiled.exports;
  } finally {
    Module._load = originalLoad;
  }
}

const Jw = loadTs('../src/lib/media/jwPlayer.ts');

test('resolveJwLibraryUrl only accepts the operator\u2019s own JW-hosted library', () => {
  assert.equal(
    Jw.resolveJwLibraryUrl('https://cdn.jwplayer.com/libraries/AbCd1234.js'),
    'https://cdn.jwplayer.com/libraries/AbCd1234.js'
  );
  assert.equal(
    Jw.resolveJwLibraryUrl(' https://ssl.p.jwpcdn.com/player/v/8.38.4/jwplayer.js '),
    'https://ssl.p.jwpcdn.com/player/v/8.38.4/jwplayer.js'
  );
  for (const bad of [
    '',
    undefined,
    'http://cdn.jwplayer.com/libraries/x.js', // not https
    'https://evil.example.com/jwplayer.js', // arbitrary script host
    'https://cdn.jwplayer.com/libraries/x', // not a .js library
    'https://user:pass@cdn.jwplayer.com/libraries/x.js',
    'javascript:alert(1)',
  ]) {
    assert.equal(Jw.resolveJwLibraryUrl(bad), null, JSON.stringify(bad));
  }
  assert.equal(Jw.isJwConfigured(), Jw.getJwLibraryUrl() !== null);
});

test('jwSourceType maps HLS/DASH/MP4/WebM and refuses containers JW cannot open', () => {
  assert.equal(Jw.jwSourceType({ url: 'https://cdn.example.com/master.m3u8' }), 'hls');
  assert.equal(Jw.jwSourceType({ url: 'https://cdn.example.com/movie.mp4', container: 'MKV' }), 'mp4', 'URL wins');
  assert.equal(Jw.jwSourceType({ url: 'https://cdn.example.com/v', streamType: 'dash' }), 'dash');
  assert.equal(Jw.jwSourceType({ url: 'https://cdn.example.com/v.webm' }), 'webm');
  assert.equal(Jw.jwSourceType({ url: 'https://pixeldrain.com/api/file/AbC', container: 'MP4', fileName: 'A.1080p.mp4' }), 'mp4');
  // The "video chalti hai aawaz nahi" encodes: MKV is never handed to JW.
  assert.equal(Jw.jwSourceType({ url: 'https://fsl.example.net/Show.mkv' }), null);
  assert.equal(Jw.jwSourceType({ url: 'https://pixeldrain.com/api/file/AbC', container: 'MKV', fileName: 'Show.1080p.DDP5.1.mkv' }), null);
  assert.equal(Jw.isJwPlayableCandidate({ url: 'https://cdn.example.com/master.m3u8' }), true);
  assert.equal(Jw.isJwPlayableCandidate({ url: 'https://fsl.example.net/Show.mkv' }), false);
});

test('buildJwPlaylistItem emits a JW-format playlist item with the quality label', () => {
  const item = Jw.buildJwPlaylistItem({
    candidate: { url: 'https://cdn.example.com/master.m3u8', kind: 'hls' },
    title: 'Dark',
    poster: 'https://img.example.com/p.jpg',
    qualityLabel: '1080p',
  });
  assert.deepEqual(item, {
    title: 'Dark',
    image: 'https://img.example.com/p.jpg',
    sources: [{ file: 'https://cdn.example.com/master.m3u8', type: 'hls', label: '1080p', default: true }],
  });
  assert.equal(Jw.buildJwPlaylistItem({ candidate: { url: 'https://x.example.com/a.mkv' } }), null);
});

test('JW track maps keep indices (audio languages + captions) and mark the active one', () => {
  assert.deepEqual(
    Jw.mapJwAudioTracks(
      [
        { label: 'Hindi', language: 'hin' },
        { label: 'English', language: 'eng' },
      ],
      1
    ),
    [
      { index: 0, label: 'Hindi', language: 'hin', active: false },
      { index: 1, label: 'English', language: 'eng', active: true },
    ]
  );
  // Captions entry 0 is JW's synthetic "Off" — dropped from the chip list.
  assert.deepEqual(
    Jw.mapJwCaptionTracks([{ label: 'Off' }, { label: 'English', language: 'en' }], 1).map((t) => [t.index, t.label, t.active]),
    [[1, 'English', true]]
  );
  assert.equal(Jw.classifyJwError('Network error: manifest load failed'), 'network');
  assert.equal(Jw.classifyJwError('The video could not be played'), 'decode');
});
