# Bug report — exclusive collection rebuild

Method: `replica-test` (read every flow, then click/request it) plus the two new
OpenDots probe personalities (`Naina`, `Ved`) in `testing/dots/` and
`scripts/qa-dots.mjs`. Every finding below was reproduced before it was fixed,
and the fix is covered by a test or a probe.

Severity: **S1** broken golden path / wrong catalogue · **S2** wrong data or a
dead end · **S3** confusing state · **S4** polish.

| # | Sev | Dot | Finding | Evidence | Fix | Guard |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | S1 | Ved | The new exclusive title endpoint returned the detail payload's `playback` (always empty for this catalogue) but never called the provider's `getPlaybackSources()`, so the player had **no DASH stream at all** — every title would have opened "No browser stream". | `getExclusiveTitle()` built `playback` from `detail.playback` + resource files only | `getPlaybackSources()` output is merged first, then direct MP4/HLS resources; both de-duplicated | `tests/exclusiveIntegration.test.cjs` — asserts a `dash` source whose URL starts with `/api/media/vault-stream/` |
| 1 | S1 | Ved | A series page's "More like this" rail was empty: `VaultMediaProvider.getRelated()` always called `loadDetail(slug, "movie")`, so a series never resolved and the rail returned `[]`. | `getRelated(_kind, slug)` ignored its kind argument | The real kind is passed through; recommendations come from the shared listing, then a title search fills the rest | `tests/vaultExclusiveRoute.test.cjs` (listing) + `tests/exclusiveCatalogue.test.cjs` (recommendations) |
| 2 | S2 | Naina | Genre, year, language and sort were **ignored** on the collection's own browse path: `browse()` returned `discoveryQuery()` as-is. A filter changed the URL and nothing on screen. | `browse()` had no `filterTitles`/`sortTitles` call | Filters and sorts run over the whole cached listing, then paginate | `tests/exclusiveCatalogue.test.cjs` — "filters narrow…", "every sort order is total" |
| 3 | S2 | Naina | Filter options were invented: every year from `now-20` and a fixed language list, so most options matched nothing. | `getFacets()` built static arrays | Years/languages/genres are derived from the titles actually in the collection | `tests/exclusiveCatalogue.test.cjs` (facets) |
| 4 | S2 | Ved | Silent audio on **adaptive** streams had no detection at all: the watchdog only monitored progressive `src=` MP4. DASH/HLS could play picture with no sound and never say so. | `MediaStreamPlayer` only polled after `handle.mode === "shaka-src"` | New `audioHealth` module + watchdog in the exclusive player: decoded bytes vs rendered frames → switch track → reload at position → explain | `tests/audioHealth.test.cjs` (7 cases), `tests/exclusiveUi.test.cjs` |
| 5 | S2 | Ved | No audio-track picker on the exclusive playback path, so a viewer with a silent Dolby default had no one-tap fix. | Player sheet exposed quality only | Audio adaptation sets are listed with language/channels/codec and are selectable | `tests/exclusiveUi.test.cjs` |
| 6 | S3 | Naina | An unreachable catalogue and an empty search looked identical in the old section ("Nothing here yet" for both). | Old `ExclusiveSection` used one empty state | Landing failure, search failure and "no matches" are three distinct states, each with its own copy and retry | `tests/exclusiveUi.test.cjs` |
| 7 | S3 | Ved | If a browser cannot run Shaka at all, the handle returned by `attachShakaPlayback` lacked the new quality methods and would throw when the UI called them. | `mode: "unsupported"` branch had a partial handle | No-op defaults added for `getVideoQualities`, `selectVideoQuality`, `setAdaptationEnabled` | `npx tsc --noEmit` (typed handle) |
| 8 | S3 | Dev | The search field used `aria-expanded` on a plain textbox — invalid ARIA, so the suggestion list was not announced as one control. | `jsx-a11y/role-supports-aria-props` warning | `role="combobox"` + `aria-controls` → listbox with `role="option"` rows | `npm run lint` clean |
| 9 | S3 | (self) | The parity matrix silently mis-parsed a row whose feature name contained an unquoted comma, dropping a must-have from the score. | `clone` column read `"details"` on a row with six fields shifted | Features with commas are quoted; the parser now rejects unknown `clone` values and fails the preflight | `tests/replicaParity.test.cjs` |
| 10 | S4 | Naina | Closing the player left the page scrolled/behind-interactive on mobile, and Escape did nothing. | Manual check of the overlay | Overlay locks body scroll, closes on Escape, focuses the close button, `role="dialog" aria-modal` | `tests/exclusiveUi.test.cjs` |
| 11 | S1 | Naina | **In production the section said "The exclusive collection is unavailable".** Every read was proxied through the serverless function, whose datacenter egress range the catalogue refuses or rate-limits — the same request from a home connection worked. | Live deploy: `GET /api/media/exclusive?mode=home` → coded `502 network_error`; sandbox reproduced it (`fetch failed` from the function, not the browser) | Reads now originate in the **user's browser**: `POST /api/media/exclusive/ticket` signs one batch of upstream calls (no `url` field, no secrets, ≤ 4 calls, `no-store`, rate-limited), the browser sends them itself, and the same composition code builds the payload. CORS refusal → silent relay fallback → labelled `localStorage` snapshot with Retry. | `tests/exclusiveDirect.test.cjs` (12 cases incl. a forced CORS `TypeError`), `tests/exclusiveTicket.test.cjs` (12), `tests/exclusiveSnapshot.test.cjs` (10), `scripts/qa-dots.mjs` Naina ticket probes |
| 12 | S1 | Naina | Title pages were still server-rendered for exclusive titles: `/movies/vault-…` asked the provider on the serverless function, so a production visit to a film returned 502/404 from the blocked datacenter IP even though the browser could reach the catalogue. Streams and downloads were resolved by `POST /api/media/exclusive/playback`, which needed the same blocked hop. | Live: `vault-*` detail page 502; the resolution route answered `440` upstream | Detail, streams and mirrors now come from **one signed browser batch** (`detail` + `playback` + `resource`); the resolution endpoint is deleted; `/movies|/series/vault-…` render a frame and resolve client-side, with the last saved copy of the title as fallback. DASH stays on the byte relay only because `Cookie` is a forbidden request header. | `tests/exclusiveDirect.test.cjs` (title batch, no server route), `tests/exclusivePlaybackDirect.test.cjs` (14 cases), `scripts/qa-dots.mjs` (route removed, three kinds in one ticket) |

## Probes that now pass

```
npm run build && npm run start
node scripts/qa-dots.mjs
# … 129 passed, 0 failed
```

The exclusive contract is asserted with the upstream **offline** (the sandbox
cannot reach it): the API must answer JSON, never a bare 500, never HTML, and an
outage must be a coded `502`/`503` — so the page can say "unavailable" instead
of "empty".

## Known limitations (recorded, not hidden)

- Filters live in component state; the API is URL-addressable, so shareable
  filter links are a small follow-up (`?genre=…` → section state).
- There is no cross-device "continue watching" rail; positions are per browser,
  which is the existing privacy stance of `resumePoints`.
- The upstream catalogue cannot be reached from CI, so QA asserts contracts,
  not live titles. That is deliberate: a green suite must never imply that a
  live upstream returned data.
