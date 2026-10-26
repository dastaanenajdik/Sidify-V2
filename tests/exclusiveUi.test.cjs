const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const SECTION = read('src/components/media/ExclusiveSection.tsx');
const HERO = read('src/components/exclusive/ExclusiveHero.tsx');
const RAIL = read('src/components/exclusive/ExclusiveRail.tsx');
const POSTER = read('src/components/exclusive/ExclusivePoster.tsx');
const FILTERS = read('src/components/exclusive/ExclusiveFilters.tsx');
const PLAYER = read('src/components/exclusive/ExclusivePlayerSheet.tsx');

test('the section renders a landing page, results and a player from one component', () => {
  assert.match(SECTION, /useExclusiveHome/);
  assert.match(SECTION, /useExclusiveSearch/);
  assert.match(SECTION, /useExclusiveSuggestions/);
  assert.match(SECTION, /ExclusiveHero/);
  assert.match(SECTION, /ExclusiveRail/);
  assert.match(SECTION, /ExclusiveFilters/);
  assert.match(SECTION, /ExclusivePlayerSheet/);
  assert.match(SECTION, /role="search"/);
  assert.match(SECTION, /Search the exclusive collection/);
});

test('the landing rails come from the API, not from a hard-coded keyword search', () => {
  assert.match(SECTION, /home\.data\.rails/);
  assert.doesNotMatch(SECTION, /secondarySearch|searchTitles\(/);
  assert.match(RAIL, /rail\.items\.map/);
  assert.match(RAIL, /layout === "ranked"/);
});

test('each card shows rating, quality, rank and can start the player', () => {
  assert.match(POSTER, /title\.rating\.toFixed\(1\)/);
  assert.match(POSTER, /qualityBadge/);
  assert.match(POSTER, /rank/);
  assert.match(POSTER, /onPlay/);
  assert.match(POSTER, /mediaHref/);
  assert.match(POSTER, /ExclusiveBadge/);
});

test('the hero carries play, details, watchlist and a surprise pick', () => {
  assert.match(HERO, /Play now/);
  assert.match(HERO, /More info/);
  assert.match(HERO, /Watchlist/);
  assert.match(HERO, /Surprise me/);
  assert.match(HERO, /title\.cast/);
  assert.match(HERO, /title\.genres/);
});

test('filters map to real facets and reset the page when they change', () => {
  assert.match(FILTERS, /facets\.genres|popularGenres/);
  assert.match(FILTERS, /facets\.years/);
  assert.match(FILTERS, /facets\.languages/);
  assert.match(FILTERS, /page: 1/);
  assert.match(FILTERS, /onClear/);
  assert.match(FILTERS, /EXCLUSIVE_SORTS/);
});

test('the player exposes quality, audio and subtitle choice on top of Shaka', () => {
  assert.match(PLAYER, /attachShakaPlayback/);
  assert.match(PLAYER, /getVideoQualities|selectVideoQuality/);
  assert.match(PLAYER, /selectAudioTrack/);
  assert.match(PLAYER, /selectTextTrack/);
  assert.match(PLAYER, /Auto \(adaptive\)/);
  assert.match(PLAYER, /preferredAudioLanguages/);
  assert.match(PLAYER, /Audio OK|Checking audio/);
  assert.match(PLAYER, /role="dialog"/);
  assert.match(PLAYER, /Escape/);
  assert.match(PLAYER, /saveResumePoint/);
});

test('the Shaka engine exposes a quality ladder and an ABR switch', () => {
  const engine = read('src/lib/media/shakaPlayer.ts');
  assert.match(engine, /export interface ShakaVideoQualityOption/);
  assert.match(engine, /getVideoQualities: \(\) => ShakaVideoQualityOption\[\]/);
  assert.match(engine, /selectVideoQuality: \(height: number \| "auto"\) => void/);
  assert.match(engine, /setAdaptationEnabled: \(enabled: boolean\) => void/);
  assert.match(engine, /player\.configure\(\{ abr: \{ enabled: false \} \}\)/);
});

test('the exclusive page is indexable with its own metadata', () => {
  const page = read('src/app/exclusive/page.tsx');
  assert.match(page, /title: "Exclusive"/);
  assert.match(page, /canonical: "\/exclusive"/);
  assert.match(page, /description/);
});

test('an unresolvable stream list is explained and retryable, never a dead end', () => {
  const VIEW = read('src/components/media/MediaDetailView.tsx');
  const PAGE = read('src/components/media/ExclusiveDetailPage.tsx');

  // The empty player area knows why it is empty and can ask again.
  assert.match(VIEW, /onRetry\?: \(\) => void/);
  assert.match(VIEW, /streamIssueSentence\(status\.streamIssue, status\.streamIssueStatus\)/);
  assert.match(VIEW, /Retrying…/);
  assert.match(PAGE, /<MediaDetailView detail=\{detail\} onRetry=/);
});

test('detail pages are never served from a stale cache', () => {
  for (const page of ['src/app/movies/[slug]/page.tsx', 'src/app/series/[slug]/page.tsx']) {
    const source = read(page);
    assert.match(source, /export const dynamic = "force-dynamic"/, `${page} renders per request`);
    assert.doesNotMatch(source, /export const revalidate = 3600/, `${page} keeps no page cache`);
  }
});

test('a session rejection is retried once with a fresh token, and reported if it persists', () => {
  const DIRECT = read('src/lib/media/exclusiveDirect.ts');
  assert.match(DIRECT, /const SESSION_REJECTED = 440/);
  assert.match(DIRECT, /isSessionRejection/);
  assert.match(DIRECT, /forgetBrowserToken\(\);/);
  assert.match(DIRECT, /exclusiveStatus\.noteStreamIssue/);
  assert.match(DIRECT, /\[exclusive\] no playable source/);
  // A title with no playable source must not be pinned in the detail cache.
  assert.match(DIRECT, /function cacheDetail[\s\S]{0,220}playback \?\? \[\]\)\.length === 0\) return;/);
});
