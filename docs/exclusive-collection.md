# The exclusive collection

A second, separate film & series catalogue with its own landing page, search,
detail pages, player and downloads. It is the only catalogue `/exclusive` reads.

```
Browser
  /exclusive                        src/app/exclusive/page.tsx
    └─ ExclusiveSection             src/components/media/ExclusiveSection.tsx
        ├─ GET /api/media/exclusive?mode=home
        │     └─ getExclusiveHome()              src/lib/media/exclusive.ts
        │         └─ VaultMediaProvider.listing()  (one cached upstream read)
        ├─ GET /api/media/exclusive?mode=search&q=&type=&genre=&year=&language=&sort=&page=
        │     └─ searchExclusiveCatalogue()
        ├─ GET /api/media/exclusive/suggest?q=
        │     └─ suggestExclusive()
        └─ GET /api/media/exclusive/title/<slug>
              └─ getExclusiveTitle() → detail + playback + recommendations
```

## Endpoints

| Method & path | Answers |
| --- | --- |
| `GET /api/media/exclusive?mode=home[&type=movie\|series\|all]` | `ExclusiveHome`: spotlight, rails, genres, facets, total, `updatedAt`. One upstream read, cached 5 min per instance. |
| `GET /api/media/exclusive?mode=search&q=&type=&genre=&year=&language=&sort=&page=&limit=` | `ExclusiveSearchPage`: items, page, totalPages, totalResults, pageSize, filters, facets, `tookMs`. `limit` is capped at 60. |
| `GET /api/media/exclusive/suggest?q=&limit=` | `{ query, items, tookMs }` — listing text match first, catalogue search as fallback. |
| `GET /api/media/exclusive/title/<slug>[?type=]` | `{ detail, recommendations, provider }` — metadata, cast/director, seasons, `playback[]`, `releases[]`. 404 JSON when the title is not in this collection. |

All four answer JSON only. An upstream outage is a coded `502`/`503`, never a
bare `500`, never HTML, and never an empty-but-successful page — the UI has to
be able to tell "unavailable" from "no matches".

## Landing composition

`buildExclusiveHome(pool, provider, now)` is pure, so the rails are testable
without a network call. Given the collection's deduplicated listing it emits:

| Rail | Rule |
| --- | --- |
| Spotlight | highest rating (votes break ties), art preferred |
| Trending this week | `rankScore` |
| Top 10 right now | rating, descending |
| New releases | newest year first |
| Films / Series | `rankScore` within each kind |
| Critically acclaimed | rating ≥ 7.5 |
| Timeless classics | older than ten years |

`rankScore = (rating/10) × 3 + popularity(0–1) + freshness(0–1 over 6 years) + log-votes(0–1)`

Popularity is normalised against the pool's own min/max, because catalogues
report it as a rank, a view count or a "hot" score and the raw values are not
comparable. Every sort has a stable tie-break, so the same pool always produces
the same page (otherwise CDN caching would be pointless).

## Search, filters and facets

`searchExclusiveCatalogue()` takes the catalogue's own search results for a term
**and** the text matches from the cached listing, then de-duplicates. A keyword
search that misses a title the collection clearly holds is the failure mode this
guards against.

`filterTitles()` supports kind, genre (id or display name), year (`2024` or
`2020s`), language (code or name) and free text. `sortTitles()` supports
`trending | newest | oldest | rating | title`. Facets are derived from the
titles that actually exist, so a filter never offers a value that matches
nothing.

## Recommendations

`recommendTitles(seed, pool, limit)` scores neighbours:

```
+2 per shared genre (cap 6)
+1 same kind
+1 same language
+1 release within 3 years
```

Rating is **not** part of the score — a well-reviewed title in an unrelated
genre is not "more like this". It is only the tie-break, after the pool order,
which keeps the rail stable between requests.

## Playback: why audio can cut, and how audio + video arrive

A DASH/HLS stream is not one file. The manifest describes **separate adaptation
sets**: one ladder of video renditions, one or more audio renditions, optional
text tracks. Shaka Player picks one video rendition (ABR) **and one audio
adaptation set**, then feeds both into MSE as separate SourceBuffers.

That separation explains nearly every "the video plays but there is no sound"
report:

1. **The default audio set is a codec this browser cannot decode.** The usual
   culprit is Dolby (`ec-3` / `ac-3`) or DTS; Chrome/Firefox on most desktops
   have no decoder for it. The picture is H.264 and plays fine; the audio
   SourceBuffer never starts.
2. **The default audio set is the wrong language.** The manifest may list Hindi
   and English, and the player picked the one the viewer did not want.
3. **The audio SourceBuffer failed while the video one recovered.** Shaka retries
   each stream independently; a recovered video stream can hide a dead audio one.

This build handles all three:

- **Selection** — `preferredAudio` asks for Hindi/English with
  `channelCount: 2` first, so a stereo AAC track wins over a surround track when
  both exist. `abr.allowAudioFallback` lets Shaka drop to a playable audio
  rendition instead of stalling.
- **Choice** — every audio adaptation set is listed in the player with its
  language, channel layout and codec, and is selectable
  (`getAudioTracks` → `selectAudioTrack`).
- **Verification** — the watchdog samples `webkitAudioDecodedByteCount` and
  `webkitVideoDecodedByteCount`/rendered frames once a second. Decoded audio
  bytes → **Audio OK**. Zero audio bytes while frames advance for 2.5 s →
  **No sound**, then an ordered recovery:
  1. switch to the next audio track,
  2. reload the same source at the same position (repairs a dead SourceBuffer),
  3. stop guessing: explain the likely cause and point at the title page.
  Browsers without decoder counters show **Audio n/a** — the player never fakes
  a verdict it cannot measure.
- **Transcoding where it is possible** — the existing Dolby→FLAC WASM
  transmuxers are still registered before load, so `ec-3`/`ac-3` can be played
  on platforms without a native decoder. Where neither the platform nor the
  transcoder can decode a track, the picker and the watchdog make the limitation
  visible instead of silent.

Video quality is independent of all this: the quality menu lists every distinct
height the manifest offers, `Auto` hands control back to ABR, and pinning a
height disables ABR before selecting the variant.

### Same-origin relay

The collection's CDN requires a signed cookie. A browser cannot attach that
cookie to a cross-origin media request, so manifests and segments are relayed by
`/api/media/vault-stream/<token>/…`; the DASH `<BaseURL>` is rewritten so
segments stay on the relay too. Direct files (MP4/WebM/HLS) bypass the relay.

## Player surface

`src/components/exclusive/ExclusivePlayerSheet.tsx`

| Control | Behaviour |
| --- | --- |
| Quality | Auto + every height from the manifest |
| Audio | Every adaptation set, labelled `Language · channels · codec` |
| Subtitles | Off + every text track |
| Watchdog | Audio OK / Checking / No sound / Audio n/a + the explanation banner |
| Stats | Picture size, buffer ahead, estimated bandwidth, dropped frames |
| Streams | Every playback source the title exposes, DASH first |
| Resume | Same key as the title page player (`movie-<slug>`) |
| Links | Title page (cast, seasons, downloads, external players) |

Dialogs lock body scroll, close on Escape and on the close button, and start
focused on it. The `<video>` keeps native controls, so keyboard and
screen-reader behaviour is the platform's, not a reimplementation.

## Testing

```bash
npm test                 # 300+ Node tests, incl. ranking, filters, audio verdicts
npm run typecheck
npm run lint
npm run build
npm run parity           # replica feature matrix (must-haves must be complete)
node scripts/qa-dots.mjs # against a running server; Naina + Ved cover this section
```

The relay, the catalogue API and CI all run with the upstream **offline**: tests
assert contracts and fixtures, not live data. A green suite never claims that a
live upstream answered.
