# Sidify

A music streaming web app with a calm, Apple-Music-style interface: instant
YouTube-powered search, full-length playback, word-by-word lyrics, AutoPlay that keeps
the music going, and **Listen Together** rooms where everyone hears the same song at the
same second.

Built with Next.js 16 (App Router) · React 19 · Tailwind v4 · Zustand · React Query ·
Drizzle ORM + PostgreSQL · `youtubei.js` (InnerTube extraction) · PWA service worker.

---

## What's inside

| Area | Highlights |
|---|---|
| **Shell** | Desktop: frosted sidebar (search, Home / Explore / Library, Listen Together, playlists), a top bar that *is* the player (transport, "LCD" with progress, volume, lyrics / queue / room toggles) and a right-hand column for lyrics or the queue. Phones: floating glass tab bar and pill mini player. Dark and light themes. |
| **Now Playing** | Full-screen player whose backdrop is a mesh of colours sampled from the artwork. The cover eases down when paused; lyrics and the queue take the artwork's place (their own column on wide screens). Capsule for playback options (video mode, speed, sleep timer, equalizer, stats for nerds) and Listen Together. |
| **Lyrics** | Timed lines in big type: the sung line lit with a soft wipe, the rest dimmed and blurred by distance; tap a line to seek, scroll to browse. Per-song timing offset, plain/timed switch, copy, and a **share card** (pick up to four lines → image). Lyrics finder in the Library. |
| **Up next & AutoPlay** | Queue in sections — *Now playing*, *Next in queue*, *Next from …* and *AutoPlay* — with drag to reorder. AutoPlay lines up similar songs (YouTube Music's own radio) *before* the queue runs out, so what plays next is always visible. "Start radio" from any song. |
| **Listen Together** | Rooms with a six-character code (no I/L/O), invite link and QR. Up to 5 people (host can raise it to 10), host-only control, remove members, host hand-over, shared queue, room AutoPlay, activity log. Devices share one server clock (round-trip-corrected) and correct drift, so playback stays aligned. |
| **Recommendations** | Home: Top picks (your mix, song radio from your last play, top-artist radio), Quick picks, Recently played, New releases, Trending, From your likes. Explore: new releases, charts and mood / genre tiles. |
| **Movies & Series** | `/movies` and `/series`: featured backdrop hero, trending / new / top-rated / popular shelves, a **Free to watch** shelf of public-domain films, genre · year · language · sort filters, search, poster cards with a local watchlist. Detail pages carry official trailers, seasons and episodes, "more like this", and a real player — TMDb/JustWatch links for licensed titles, the Internet Archive's own player plus its download options for free films. |
| **Replay** | Minutes listened, top songs, top artists, streak and listening hours — counted on the device, shown as wallet-style cards. |
| **Library** | Likes, playlists (pin to the top, grid / list), history and downloads are server-backed **and** locally mirrored, so nothing is lost when the API or DB is unavailable. |
| **PWA** | Installable, app-shell caching and media-session (lock-screen) controls. |

Tech deep-dive: [`TECH_STACK.md`](./TECH_STACK.md).

Keyboard: <kbd>Space</kbd> play/pause · <kbd>Shift</kbd>+<kbd>←</kbd>/<kbd>→</kbd> previous/next ·
<kbd>L</kbd> lyrics · <kbd>Q</kbd> queue.

---

## Local development

```bash
npm install
cp .env.example .env.local     # optional — add DATABASE_URL
npm run dev                    # http://localhost:3000
```

Useful scripts:

```bash
npm run dev        # dev server
npm run build      # production build (verify before deploying)
npm run start      # serve the production build
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm test           # node --test tests/*.test.cjs
npm run db:push    # create/update Postgres tables from src/db/schema.ts
```

The app works **without** a database — search, playback and lyrics need no env at all.
`DATABASE_URL` unlocks the server-side library (likes, playlists, history), `/api/health`
and shared Listen Together rooms; everything else falls back to browser storage.

### Listen Together and the database

Rooms live in Postgres (`listen_rooms`, created automatically on first use) when
`DATABASE_URL` is set, so every server instance sees the same room. Without it they are
kept in the server's memory — fine for `npm run dev` or a single long-running Node
server, but **on serverless hosts (Vercel) set `DATABASE_URL`**, otherwise two requests
can land on different instances and miss each other's room.

How it works without any database setup (`src/lib/rooms/store.ts`): `roomStore()`
picks Postgres when `DATABASE_URL` exists and otherwise an in-memory store — a
`Map` kept on `globalThis` in the same Node process. Creating a room just inserts
the room record under a random six-character code; joining is a lookup of that code
(`POST /api/rooms/{code}/join`), and members poll `GET /api/rooms/{code}` about once
a second (that poll is also the heartbeat and carries the server clock everyone
syncs playback to). No signup, no extra service: the code *is* the address.

So why does a code from one Sidify site connect on another Sidify site? The client
always calls `/api/rooms/…` **relative to the site you are on**, so the code only
resolves where the room record actually lives. It connects across two sites only
when both sites share that store — either both deployments use the **same**
`DATABASE_URL` (the same `listen_rooms` table), or both domains point at the
**same** deployment/process (the same in-memory Map). If it joined, that sharing
is why; a fully separate deployment with its own (or no) database would answer
“No room with that code”.

---

## Deploy on Vercel

1. **Import the repo** — [vercel.com/new](https://vercel.com/new) → pick
   `dastaanenajdik/Sidify-V2`. Framework preset auto-detects **Next.js**; leave the
   build command (`next build`) and output defaults as they are.
2. **Add a Postgres database** (recommended — required for Listen Together on Vercel) —
   Neon, Supabase or Vercel Postgres. Copy its connection string.
3. **Set the environment variable** — Vercel → Project → *Settings → Environment
   Variables* → add `DATABASE_URL` for **Production, Preview and Development**.
4. **Create the tables** — from your machine, with the same URL:

   ```bash
   DATABASE_URL="postgres://…" npm run db:push
   ```

5. **Deploy** — every push to the production branch ships automatically; pull requests
   get preview deployments. No `vercel.json` is needed: YouTube extraction endpoints are
   pinned to the Node.js runtime and `youtubei.js` is kept out of the bundle
   (`serverExternalPackages`), which is what keeps the build green on Vercel.

Environment variables:

| Key | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | runtime, optional | Likes, playlists, downloads, listening history, Listen Together rooms, `/api/health` |
| `LRCLIB_BASE` | optional | Self-hosted lyrics mirror (defaults to `https://lrclib.net`) |
| `LYRICS_OVH_BASE` | optional | Secondary lyrics provider (defaults to `https://api.lyrics.ovh`) |
| `MEDIA_PROVIDER` | optional | `auto`/`merged` (default) · `tmdb` · `archive` · `demo` — which movies/series adapter answers |
| `MEDIA_ARCHIVE` | optional | `off` hides the free Internet Archive shelf and playback |
| `TMDB_READ_ACCESS_TOKEN` / `TMDB_API_KEY` | optional | Official TMDb metadata (either one). Without it the demo catalogue is used |
| `TMDB_LANGUAGE`, `TMDB_REGION` | optional | Metadata language (default `en-US`) and availability region (default `IN`) |
| `MEDIA_PLAYBACK_MANIFEST` | optional | JSON map of **authorized** HLS/MP4 URLs, `{"movie/<slug>":[{"url":"https://…","type":"hls"}]}` |

---

## Movies & Series

`/movies` and `/series` reuse the same shell, theme tokens, shelves, chips and type
scale as the music side. Detail routes are `/movies/[slug]` and `/series/[slug]`, with
`generateMetadata` for SEO and server-side provider fetches so pages arrive with real
HTML.

### Provider model

Everything goes through one interface (`src/lib/media/provider.ts`):

```ts
getTrendingMovies()  getTrendingSeries()  getPopularMovies()  getPopularSeries()
getNewMovieReleases()  getNewSeriesReleases()  getTopRatedMovies()  getTopRatedSeries()
browse(kind, query)  searchTitles(query, kind, limit)  getGenres(kind)  getFacets(kind)
getMovieDetails(slug)  getSeriesDetails(slug)  getSeriesSeasons(slug, season?)
getRelated(kind, slug, limit)  getPlaybackSources?(kind, slug)
```

Three adapters implement it, and `mergedProvider.ts` routes between them:

| Adapter | When | Notes |
|---|---|---|
| `demoProvider.ts` + `demoCatalog.ts` | `MEDIA_PROVIDER=demo`, or no free/metadata source answers | Fictional titles, original synopses, generated SVG artwork. Every card carries a **Demo** badge and every response is marked `demo: true`. |
| `tmdbProvider.ts` | `TMDB_READ_ACCESS_TOKEN` or `TMDB_API_KEY` set | Official TMDb v3 API — real metadata, artwork, YouTube trailer keys and JustWatch availability links/searches (India by default). Terms require the attribution line rendered on detail pages. |
| `archiveProvider.ts` | always available (default catalogue when no TMDb key) | Internet Archive Scrape API: real public-domain / openly licensed films from `feature_films`, `film_noir`, `sci-fi_horror`, `silent_films` and related collections. Supplies posters, ratings, genres and — uniquely — **lawful playback**: archive.org's own `/embed/<id>` player and `/download/<id>` files. Falls back to a verified snapshot (`archive.ts`) if archive.org is unreachable, so the shelf never breaks. |
| `mergedProvider.ts` | `MEDIA_PROVIDER=auto` (default) | TMDb metadata plus the archive: a "Free to watch" shelf, archive results merged into search, `ia-<identifier>` slugs routed to the archive provider, and free playback attached to a TMDb title when the same film (title + year) exists in the archive. Every call degrades instead of throwing. |

Routes:

```text
GET /api/media/browse?type=movie|series&q=&genre=&year=&language=&sort=&page=
GET /api/media/search?q=&type=movie|series|all&limit=
GET /api/media/title/movie|series/<slug>
GET /api/media/seasons/<slug>?season=2
```

`src/lib/media/query.ts` holds the framework-free filtering, sorting, pagination,
facet and "more like this" maths (covered by `tests/media.test.cjs`), so a new adapter
only has to map its catalogue onto the models in `src/lib/media/types.ts`.

### Playback policy

There is **no** scraper, torrent, DRM bypass or third-party file host anywhere in this
feature — no `4khdhub`/`hubcloud`/`greenmotors` style resolution, no CORS-proxy scraping
of protected pages. A title becomes playable only when:

1. a provider that actually holds the rights returns `getPlaybackSources(...)`:
   the Internet Archive does, for public-domain / openly licensed items, using its own
   embed player and download endpoints; TMDb does not, because it licenses metadata,
   not streams;
2. a TMDb title has an unambiguous archive match (same normalised title, year within
   ±1) — then the archive player is attached and labelled as a free copy; or
3. the operator lists an HTTPS HLS/MP4 URL in `MEDIA_PLAYBACK_MANIFEST`.

Otherwise the detail page states that no playback source is configured and shows the
official trailer plus TMDb/JustWatch availability links (or a region-scoped JustWatch
search when provider listings are missing). Downloads are only ever the archive's own
files, linked from the item's download page. Non-HTTPS manifest entries are discarded
(`src/lib/media/playback.ts`). HLS plays natively in Safari/iOS; other browsers need an
MP4 rendition from the same source.

Watchlist entries persist in `localStorage` (`src/store/watchlist.ts`), rehydrated like
the other Sidify stores, so no account is required.

### Connecting a real catalogue

```bash
# .env.local
MEDIA_PROVIDER=auto               # merged: TMDb metadata + free archive films
TMDB_READ_ACCESS_TOKEN="…"        # optional; enables the rich metadata catalogue
```

With no keys at all, `/movies` serves the Internet Archive catalogue, so free films,
posters, playback and downloads work out of the box. Restart `npm run dev` (or
redeploy) — the demo notice disappears and detail pages get real posters, trailers and
availability links. `MEDIA_PROVIDER=archive` serves only free films; `MEDIA_ARCHIVE=off`
switches the free shelf and archive playback off.

The server needs outbound HTTPS to `archive.org` (and `api.themoviedb.org` when TMDb is
configured). If archive.org is blocked the shelf falls back to the verified snapshot in
`src/lib/media/archive.ts`; playback still works because the browser loads the archive's
embed player directly.

To add another provider, implement the same interface and route to it in
`getMediaProvider()` (`src/lib/media/service.ts`).

---

## Icons

The app icon is a white **S** on a red squircle. The PNGs in `public/` are generated by
`tools/gen-icons.mjs` (`npm i --no-save @resvg/resvg-js && node tools/gen-icons.mjs`).
