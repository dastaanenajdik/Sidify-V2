# Sidify QA Dots — tester personalities

Seven AI tester personalities for Sidify, written in the **Specialist Dot**
format of [CopilotKit/OpenDots](https://github.com/CopilotKit/OpenDots)
(cloned and read at commit `8091324942b86789ed0da7facbee855145d933b0`).

In OpenDots a Dot is `{ id, spaceId, spaceIds, name, instructions,
researchAllowed, memoryAllowed, appsAllowed, composioToolkits, createdAt, … }`
(`src/shared/types.ts`), and its system prompt is built as
"You are {name}, a specialist Dot in OpenDots. Role instructions:
{instructions} …" (`src/server/dot-agent.ts`). Every file here follows that
exact shape, so the same personalities can be created inside a running
OpenDots instance (create the Space from `space.json`, then one Dot per JSON
file, copying `name` + `instructions` + the permission flags).

> Running OpenDots *live* needs a CopilotKit Intelligence project key
> (`CPK_INTELLIGENCE_API_KEY`) and a model key (`OPENAI_API_KEY`). The
> measurements and fixes that these Dots produced for Sidify were gathered by
> executing each Dot's checklist directly plus the deterministic probe runner
> [`scripts/qa-dots.mjs`](../../scripts/qa-dots.mjs); the JSON files are the
> portable personalities, the script is the repeatable evidence.

| Dot | Personality | Hunts for |
| --- | --- | --- |
| Aarav — First-time Mobile Listener | New user, low-end Android, zero patience | Broken golden paths, blank pages, confusing first screens |
| Meera — Power Listener & Curator | Playlists/library/rooms power user | Library API contracts, persistence, backup/restore, rooms |
| Kabir — Chaos & Security Tester | Polite attacker | 500s on bad input, HTML from APIs, SSRF/traversal, uncapped params |
| Ira — Performance Hawk | Performance engineer | First-load JS weight, cache headers, oversized assets, dead code shipped to everyone |
| Dev — Accessibility & SEO Auditor | Keyboard/screen-reader/crawler view | Titles/meta/headings/alt text, soft-404s, indexable dev pages |
| Zoya — Slow-Network & Offline User | Flaky 3G, installed PWA | Repeat-visit caching, SW/manifest health, timeout behaviour |
| Rian — Movies & Series Viewer | Film-first user | Media browsing/player flows and provider failure shapes |
| Naina — Exclusive Binger | Film-first viewer who only opens `/exclusive` | The exclusive catalogue's landing/search/filters/empty states, and that no main-catalogue title leaks in |
| Ved — Audio & Picture Sync Inspector | Playback engineer | Typed playback sources, quality/audio/subtitle controls, silent-audio recovery, resume |

Run the probes against any running deploy:

```sh
npm run build && npm run start
node scripts/qa-dots.mjs            # or QA_BASE_URL=https://… node scripts/qa-dots.mjs
```

Schema and regression guards live in `tests/qaDots.test.cjs`.

## What the first run found (and what changed)

| # | Dot | Finding | Fix |
| --- | --- | --- | --- |
| 1 | Kabir | 8 API files called `await req.json()` bare — malformed/empty/`null`/array bodies crashed with `500` + empty body (playlists, downloads, library liked/recent/followed/blocked/restore) | Shared `src/lib/readJsonBody.ts`; every writer now answers `400 {"error":"Invalid JSON body"}`; restore also tolerates non-array sections; playlist names type-checked |
| 2 | Kabir | Unknown `/api/*` (e.g. `/api/album/`) returned the 45 KB HTML 404 page | `src/app/api/[...slug]/route.ts` returns a JSON 404 for every method |
| 3 | Kabir | `/api/search` forwarded unbounded queries upstream; `/api/radio` spent InnerTube calls on garbage ids | Query capped at 200 chars (media search already capped at 120); radio validates with the existing `isVideoId` and short-circuits to its normal empty answer |
| 4 | Ira/Zoya | Icons, favicon and `/covers/*` were served `Cache-Control: public, max-age=0` — revalidated on every visit | `next.config.ts` now serves them `max-age=604800, stale-while-revalidate=86400` |
| 5 | Ira | `public/covers/phonk-funk.jpg` shipped 1024×1024 / 247 KB for a ~220 px mood card | Recompressed to 640×640 q80 → 92 KB (−63%) |
| 6 | Dev | Search, Settings, Explore, Downloads, Rooms and all Library pages had the bare title "Sidify"; `/dev/lyrics-sync` was indexable | Metadata-only `layout.tsx` per route (root `%s · Sidify` template), playground gets `robots: noindex` |
| 7 | Ira | Artwork CDNs were only dns-prefetched | `i.ytimg.com` upgraded to preconnect, `lh3.googleusercontent.com` preconnected in the root layout |
| 8 | (lint) | One stale `eslint-disable` warning in `src/lib/ytPlayer.ts` | Removed — lint is warning-free |

Checked and already healthy (evidence in the probe output): all 271 existing
tests, the PWA manifest/icons/service worker, SSRF guards on `/api/art` and
`/api/media/stream` (127.0.0.1 and the cloud metadata IP are refused),
CDN caching on home/explore/search/media APIs, lazy loading of the
shaka-player (1.25 MB) and eac3 WASM (774 KB) chunks — they only load when a
video is actually played — and `loading="lazy"`/`decoding="async"` on list
artwork.

Known remaining lever, deliberately not pulled in a bug-fix pass: first-load
JS is ~314 KB gzip on every page, dominated by the app shell
(React + framer-motion + player chrome). Moving framer-motion consumers to
`LazyMotion`/`m` components is the next safe step if more speed is needed.

## Second run — the exclusive collection rebuild

Nine Dots ran over the rebuilt `/exclusive` section and its new player
(`node scripts/qa-dots.mjs` → 116 checks, 0 failed with the upstream offline).
The findings, evidence and fixes are in
[`replica/test/bug-report.md`](../../replica/test/bug-report.md); the recon and
feature matrix live in [`replica/`](../../replica).

The two new probes:

- **Naina** asserts the home payload is a spotlight + rails contract, that the
  search page returns items/page/facets, that the page size is capped at 60, that
  a 5000-character query and an unknown sort never produce a `500`, that suggest
  returns `{items: []}`, and that a blank/unknown title slug answers JSON 400/404.
- **Ved** asserts every playback source is typed (`dash|hls|mp4|webm`), absolute
  and browser-playable, that no MKV is ever offered as a stream, that the relay
  rejects an invalid token and refuses cross-site hotlinking, and that the title
  payload can carry audio/quality metadata.

Both accept a **coded upstream error** (`502`/`503`) as a valid answer: the
sandbox cannot reach the catalogue, and a QA run must never pretend otherwise.
