const { test } = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const filename = path.resolve(__dirname, '../src/lib/recommendations.ts');
const compiled = new Module(filename, module);
compiled._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, filename);
const { rankListeningArtists, matchesListeningArtist, curateListeningRecommendations } = compiled.exports;

const track = (id, artist, artistId, extra = {}) => ({
  id,
  title: `Song ${id}`,
  artist,
  artistId,
  artwork: `/art/${id}.jpg`,
  previewUrl: '',
  durationMs: 180000,
  ...extra,
});

test('ranks artists from the listener history, prioritizing artists with more played tracks', () => {
  const history = [
    track('a-new', 'Arijit Singh', 'arijit'),
    track('b-only', 'Shreya Ghoshal', 'shreya'),
    track('a-old', 'Arijit Singh - Topic', 'arijit'),
  ];

  const artists = rankListeningArtists(history);
  assert.deepEqual(artists.map(({ id, name, tracksPlayed }) => ({ id, name, tracksPlayed })), [
    { id: 'arijit', name: 'Arijit Singh', tracksPlayed: 2 },
    { id: 'shreya', name: 'Shreya Ghoshal', tracksPlayed: 1 },
  ]);
});

test('ignores duplicate history tracks and generic artist labels', () => {
  const sameSong = track('same', 'Various Artists', 'va');
  const artists = rankListeningArtists([
    sameSong,
    sameSong,
    track('unknown', 'Unknown Artist', ''),
    track('real', 'A. R. Rahman', 'rahman'),
  ]);
  assert.deepEqual(artists.map((artist) => artist.name), ['A. R. Rahman']);
});

test('matches exact listened artists and rejects unrelated search results', () => {
  const [artist] = rankListeningArtists([track('seed', 'Arijit Singh', 'arijit')]);
  assert.equal(matchesListeningArtist(track('match', 'Arijit Singh - Topic', 'other'), artist), true);
  assert.equal(matchesListeningArtist(track('collab', 'Arijit Singh, Mithoon', ''), artist), true);
  assert.equal(matchesListeningArtist(track('unrelated', 'Dua Lipa', 'dua'), artist), false);
});

test('recommendations exclude played/unrelated tracks, dedupe, and blend artists from taste history', () => {
  const history = [
    track('played-a', 'Arijit Singh', 'arijit'),
    track('played-s', 'Shreya Ghoshal', 'shreya'),
  ];
  const artists = rankListeningArtists(history);
  const result = curateListeningRecommendations(
    history,
    artists,
    [
      [
        history[0],
        track('new-a', 'Arijit Singh - Topic', 'arijit'),
        track('other', 'Dua Lipa', 'dua'),
        track('shared', 'Arijit Singh', 'arijit'),
      ],
      [track('new-s', 'Shreya Ghoshal', 'shreya'), track('shared', 'Shreya Ghoshal', 'shreya')],
    ],
    8
  );

  assert.deepEqual(result.map((item) => item.id), ['new-a', 'new-s', 'shared']);
  assert.ok(result.every((item) => ['arijit', 'shreya'].includes(item.artistId)));
});

test('no listening history means no made-for-you tracks or artist seeds', () => {
  assert.deepEqual(rankListeningArtists([]), []);
  assert.deepEqual(curateListeningRecommendations([], [], [], 14), []);
});
