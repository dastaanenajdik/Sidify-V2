# Recon — a film-first catalogue experience for the exclusive collection

> **Method.** This recon follows the `replica-recon` skill (screen inventory →
> flows → components → inferred data model → feature matrix → what cannot be
> cloned → size). It rebuilds **what the experience does**, clean-room: no
> catalogue content, artwork, copy, code or file links were taken from any
> reference site.
>
> **Scope note.** The reference URL was not reachable from the build sandbox
> (outbound traffic is limited to package registries and GitHub) and it is not a
> source this project may take content from. The recon below therefore maps the
> *public, widely used pattern* of a film-catalogue page — spotlight, rails,
> filters, detail page with cast and ratings, quality picker, playback — onto
> the catalogue this app already has (`vaultProvider`). The result is Sidify's
> own design system, copy and code.

## 1. Scope

| Question | Answer |
| --- | --- |
| What | The **exclusive collection**: a second, separate film/series catalogue with its own search |
| Platform | Web (Next.js App Router), mobile-first, PWA |
| Users | People who came for one film and want to find the next one without leaving the page |
| Core loop | Open `/exclusive` → recognise something (spotlight/rail) → search or filter → open a title → play → get recommendations |

## 2. Sources consulted

| Source | What it gave |
| --- | --- |
| The product's own brief (`EXCLUSIVE_COLLECTION_DEBUG_BRIEF.md`) | the catalogue's payload shapes, failure modes and constraints |
| The existing app (`src/lib/media/*`, `src/components/media/*`) | design tokens, detail page, mirror resolution, Shaka setup, resume points |
| Public streaming-UX conventions | rail composition, poster metadata, filter order, player control set |
| `shaka-player` 5.x docs (in `node_modules`) | adaptation sets, variant tracks, text tracks, ABR configuration |

Deliberately **not** used: the reference site's content, branding, copy, source
or file links; any logged-in surface; anything behind a paywall.

## 3. Screen inventory

| ID | Screen | Route | Purpose | Key components | States recorded |
| --- | --- | --- | --- | --- | --- |
| S01 | Exclusive landing | `/exclusive` | recognise something to watch | spotlight hero, rails, filter bar, search | loading skeleton, error, empty, populated |
| S02 | Search suggestions | `/exclusive` (open field) | jump to a title while typing | combobox + listbox, mini poster rows | idle, fetching, no match |
| S03 | Results grid | `/exclusive` (filters set) | narrow the collection | result header, poster grid, pager | loading, error, empty, page > 1 |
| S04 | Title detail — film | `/movies/[slug]` | decide, then play or download | backdrop hero, rating, cast, actions, related | loading, not found, no releases |
| S05 | Title detail — series | `/series/[slug]` | pick a season and episode | season tabs, episode rows, per-episode releases | loading, not found, empty season |
| S06 | Player | overlay on S01 | watch without leaving | Shaka stage, quality/audio/subtitle menus, stats, audio banner | starting, ready, silent audio, decode error, network error, no source |
| S07 | Download / quality picker | sheet on S04 | pick an encode or mirror | release list, resolve progress, direct links | resolving, resolved, blocked, error |
| S08 | External player picker | sheet on S04 | hand off to VLC/IINA/MPV | app list, copy link, QR | available, unavailable |
| S09 | Watchlist | `/library` | keep titles for later | saved grid | empty, populated |
| S10 | Global search | `/search` | mixed results across music and both catalogues | sectioned results | loading, error, empty |

Every screen above has an explicit **loading**, **empty** and **error** state.
The two empty states are worded differently on purpose: "no matches" is a
result, "unavailable" is a failure, and the UI never confuses them.

## 4. Flows

```
F01 Land and start watching
    S01 spotlight -> Play -> S06 ready
    edge: no stream in this browser -> S06 explains and links to S04

F02 Find a specific film
    S01 search field -> S02 suggestions -> S04 -> Play -> S06
    edge: no match in this collection, catalogue unreachable

F03 Browse by genre and rating
    S01 genre chip -> S01 sort=Top rated -> S03 grid -> S04
    edge: filter combination with zero results, page 3 of 4

F04 Watch a series
    S01 rail -> S05 season tabs -> episode -> S06
    edge: season with no episode releases

F05 Download instead of stream
    S04 Download -> S07 -> resolve mirror -> direct file
    edge: mirror blocked by a challenge, expired link, archive pack

F06 Keep something for later
    S01/S04 Watchlist -> S09 -> open again
```

Click count on F02's happy path: **3** (field → suggestion → play).

## 5. Components

| Component | Variants | States | Used on |
| --- | --- | --- | --- |
| `ExclusiveHero` | with/without surprise, saved/unsaved | art fallback | S01 |
| `ExclusiveRail` | poster, ranked (Top 10) | empty rail hidden | S01 |
| `ExclusivePoster` | plain, ranked, playing | art fallback, saved | S01, S03 |
| `ExclusiveFilters` | kind segmented, genre chips, selects | active / cleared | S01, S03 |
| `ExclusivePlayerSheet` | DASH/HLS/file source | loading, ready, error, empty, silent audio | S06 |
| `ExclusiveBadge` | compact, full | — | S01, S03, S06 |
| `Shelf` (existing) | horizontal scroller | edge arrows | S01 |
| `EmptyState` / `Skeleton` (existing) | — | — | all |

## 6. Inferred data model

```
MediaTitle   id, slug (vault-<subjectId>-<slug>), kind, title, overview, year,
             genres[], language/languageName, rating, votes, runtimeMinutes,
             certification, poster, backdrop, cast[], director[], audioLanguages[],
             quality, popularity, seasonCount, episodeCount
             evidence: vaultAdapt.subjectToTitle; S01/S03/S04 rendering
             confidence: high (fields exist in the payload; cast/quality optional)

ExclusiveRail id, title, subtitle, layout(poster|ranked), items[MediaTitle]
             evidence: S01 shelf headings; S03
             confidence: high (new, derived server-side)

ExclusiveSearchPage  items[], page, totalPages, totalResults, pageSize,
             filters{kind,genre,year,language,sort}, facets{genres,years,languages}
             evidence: S02/S03 behaviour
             confidence: high

PlaybackSource  url, type(dash|hls|mp4|webm), label, container, note
             evidence: existing detail payload; S06
             confidence: high

Ranking rule  rating*3 + normalised popularity + freshness(6y) + log(votes)
             evidence: rail ordering must be explainable and stable
             confidence: medium (a product decision, tested)

Recommendation  shared genres*2 (cap 6) + same kind + same language + within 3 years
             evidence: S04 "more like this", S06 footer
             confidence: medium (a product decision, tested)
```

Marked guesses: the reference's exact ranking weights and its personalisation.
This build uses an explicit, documented formula instead of imitating hidden
behaviour.

## 7. What cannot be cloned — `skip` rows

- **Its catalogue, artwork, metadata and file links.** Those belong to rights
  holders, not to a UI pattern. This build runs on the catalogue the app already
  integrates.
- **Its brand, logo, screenshots and copy.** Sidify keeps its own.
- **Its monetisation and its ad landing pages.** Out of scope.
- **Any technique for evading access controls, paywalls or takedowns.** Not
  implemented, not studied.

## 8. Size

10 screens, 6 flows, 8 components, 6 entities. The hard parts are playback
(DASH relay, audio adaptation sets, codec fallbacks) and caching a listing that
costs one upstream round trip per page view. Size: **M** — a few weeks of
product work; this change implements the vertical slice end to end.

## 9. Parity

`replica/features.csv` is machine-checked:

```bash
npm run parity
```

Missing must-have rows fail the check (the skill's "not shippable" rule).
Skipped rows (content, brand, monetisation) never count toward the score.
