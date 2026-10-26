# The exclusive collection

A second, separate film & series catalogue with its own landing page, search,
detail pages, player and downloads. It is the only catalogue `/exclusive` reads.

```
Browser
  /exclusive                        src/app/exclusive/page.tsx
    └─ ExclusiveSection             src/components/media/ExclusiveSection.tsx
        └─ useExclusive*            src/lib/media/hooks.ts
            └─ loadExclusive*       src/lib/media/exclusiveDirect.ts   ← "use client"
                ├─ 1. direct:   POST /api/media/exclusive/ticket → sign → fetch upstream
                ├─ 2. relay:    GET  /api/media/exclusive?mode=…
                └─ 3. snapshot: localStorage copy, labelled with its age
```

Every path — direct, relay and snapshot — runs the same composition in
`src/lib/media/exclusiveCore.ts`, so the rails, filters and recommendations do
not depend on which transport answered.

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

## Two transports: browser-direct, or server relay

The catalogue refuses, or rate-limits, shared datacenter ranges. A serverless
function egresses from exactly such a range, so proxying every read through it is
the one thing that reliably breaks the section in production — while the same
request from a home connection works. The fix is therefore about **where the
request originates**, not about headers:

```
direct (preferred)                          relay (fallback)
─────────────────                           ────────────────
browser ──POST /ticket {kind:"login"}  ┐
        ←─ signed login                │   browser ──GET /api/media/exclusive──> Vercel ──> upstream
browser ──login POST──────────> upstream│   ←─ JSON            (upstream sees the function's IP)
        ←─ visitor token               │
browser ──POST /ticket {token, calls}  ┘
        ←─ signed URLs + headers + body
browser ──signed requests────> upstream
        ←─ JSON
```

Both steps of the direct path run on the user's connection, so it works even
when the deployment cannot reach the catalogue at all. The relay only needs to
serve the ticket, and signing is local crypto.

`src/lib/media/exclusiveDirect.ts` picks the transport for each call:

| Outcome | What happens | What the user sees |
| --- | --- | --- |
| The signed fetch succeeds | transport `direct` | nothing — this is the normal path |
| `TypeError: Failed to fetch` (CORS refused) | transport disabled for the session, relay used, no retry loop | a one-line note that requests go through Sidify's servers |
| `502`/`503`/timeout on a single call | that call falls back to the relay; the transport stays on | nothing |
| Relay also fails | the last snapshot from `localStorage` is rendered | "Showing a saved copy from 2 hours ago" + **Retry** |
| Nothing cached either | the section's empty state | "The exclusive collection is unavailable" + **Retry** |

A CORS refusal is *expected* on some networks and is never surfaced as an error:
the browser path is an optimisation, not a requirement.

### What the ticket may contain

`POST /api/media/exclusive/ticket` is the only way the browser can obtain a
signature, and it is deliberately narrow:

- the caller names a **kind** of call (`home`, `search`, `detail`, `resource`)
  plus validated parameters — there is no `url`, `host` or `path` field, so the
  endpoint cannot be used as an open signing oracle;
- one batch is 1–4 calls and expands to at most 6 signed requests (`home` → its
  three tabs);
- the HMAC key never leaves the server. The response carries per-request
  signatures (bound to method + URL + body + timestamp) and an **anonymous
  ephemeral visitor token** minted for that browser key and reused for four
  minutes — never the process-wide session the relay keeps using;
- **the browser can log itself in.** Signing a login needs only the HMAC key,
  while *performing* the login needs a connection to the catalogue — the very
  thing this deployment may not have. So the route signs
  `{ kind: "login" }`, the browser posts it and gets an anonymous visitor token
  over its own connection, then sends that token back on the next batch. The
  token only ever becomes an `authorization` header, which the signature does
  not cover, so this cannot be turned into "sign my credential for me";
- browser-bound signatures **omit `x-forwarded-for`**: the request leaves from
  the user's own connection, so a fabricated address would only contradict the
  socket it actually arrives on (the relay keeps its spoofed header, because
  there the origin really is a datacenter);
- `cache-control: no-store` on every answer, tickets expire after ten minutes,
  and the route is rate-limited per caller (40 burst, 40/min) with `429` +
  `retry-after`;
- if the server cannot mint a session either, it answers `503`
  `ticket_unavailable` and the browser quietly uses the relay.

### Details, streams and downloads: all client-side

Opening a title costs **one ticket batch of three calls**, all executed by the
browser:

```
POST /api/media/exclusive/ticket { calls: [detail, playback, resource] }
  ├─ detail    subject-api/get?subjectId=…              → cast, synopsis, seasons
  ├─ playback  subject-api/play-info/v2?subjectId=…[&se=&ep=]  → DASH manifests + signed cookies
  └─ resource  subject-api/resource?subjectId=…&page=1   → download mirrors
```

Each is parsed in the browser by the same adapters the server uses
(`detailsPayloadToDetail`, `playInfoToReleases`, `resourceItemToRelease`), so a
title page, its episode list and its download sheet are built without a single
server-side catalogue call. There is no `POST /api/media/exclusive/playback`
endpoint any more — that hop (and its `440`s) is gone.

**What still touches the relay, and why.** A DASH manifest is authorised with a
signed `Cookie`, and `Cookie` is a forbidden header for `fetch`/XHR — no browser
can send it cross-origin, and a `<video>` cannot either. Those bytes therefore
stream through `/api/media/vault-stream/<token>`, which re-attaches the cookie.
Everything about *resolution* is client-side: the manifest URL is decoded from
the payload, and the token is plain base64url JSON built in the browser
(`vaultStreamToken.ts`), with no secret and no server round-trip. The relay only
accepts the CDN hosts on its allowlist and refuses private addresses, so a forged
token cannot reach anywhere new.

| Source | Path to the viewer |
| --- | --- |
| Direct MP4 / WebM / HLS from `resource` | straight from the CDN, no relay |
| DASH with a signed cookie | `/api/media/vault-stream/<token>` (bytes only) |
| DASH without a cookie | straight from the CDN, no relay |
| Episode files (`se`/`ep` in a flat listing) | attached to their episode, same rules |

If a stream's network request fails, the player switches to the next source — in
practice the relayed variant of the same manifest — before it shows an error, and
says which switch it made.

Exclusive title pages (`/movies/vault-…`, `/series/vault-…`) never call a
provider on the server: the route renders a frame and lets the browser resolve
the payload, and falls back to the last saved copy of that title when the network
does not cooperate. Playback URLs are deliberately **not** stored in a snapshot —
a relay token carries a cookie that expires, so replaying it later would only
produce a broken player.

### Caching

| Layer | Lifetime | Purpose |
| --- | --- | --- |
| React Query (`staleTime`) | 5 min (title pages: 50 min) | back/forward navigation costs nothing |
| `exclusiveDirect` module cache | 5–10 min | one upstream read per tab, even across query keys |
| `localStorage` snapshot (`sidify-exclusive-snapshot-v1`) | 7 days | landing page, searches and visited titles when both transports fail |

The snapshot is bounded (24 entries, 400 KB each, 1.5 MB total, newest-first
eviction, one retry with the newest four on a quota error) and versioned: a
payload-shape change bumps `SNAPSHOT_VERSION` and old entries are discarded
instead of being rendered as current.

### Header profiles

`buildSignedHeaders()` applies either the reversed Android identity (default) or
a coherent Chrome identity (`MEDIA_UPSTREAM_HEADER_PROFILE=browser`). This is a
**fingerprint** setting, not a fix for IP blocks — a spoofed `User-Agent` cannot
change where a request comes from. It exists so the browser-direct path can be
made consistent with the identity the request actually presents.

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
segments stay on the relay too. Anything after the token is a segment path and is
resolved against the manifest's own directory, never outside it — a traversal or
absolute segment is a `400` before any upstream call. Direct files
(MP4/WebM/HLS) bypass the relay. `tests/vaultStreamRoute.test.cjs` covers the
whole path (manifest, one segment, nested segments, stale query strings, byte
ranges, traversal, bad tokens, cross-site, `HEAD`).

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
