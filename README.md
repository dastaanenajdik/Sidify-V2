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
| `MEDIA_PROVIDER` | optional | `auto` / `4khdhub` (default) · `merged` · `tmdb` · `archive` · `demo` — active movies/series provider adapter |
| `FOURKHDHUB_BASE_URL` | optional | Override upstream catalogue base URL when domains rotate (HTTPS public host only; defaults to `https://4khdhub.one`) |
| `FOURKHDHUB_EXTRA_HOSTS` | optional | Optional comma-separated public hostnames appended to the strict mirror/catalogue allowlist |
| `TMDB_READ_ACCESS_TOKEN` / `TMDB_API_KEY` | optional | Official TMDb metadata credentials (used when `MEDIA_PROVIDER=tmdb` or `merged`) |
| `TMDB_LANGUAGE`, `TMDB_REGION` | optional | Metadata language (default `en-US`) and availability region (default `IN`) |
| `MEDIA_PLAYBACK_MANIFEST` | optional | JSON map of verified HTTPS HLS/MP4/WebM URLs, `{"movie/<slug>":[{"url":"https://…","type":"hls"}]}` |

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

Four adapters implement it, plus an optional `mergedProvider.ts` router:

| Adapter | When | Notes |
|---|---|---|
| `hubProvider.ts` + `hubScraper.ts` + `hubResolver.ts` | `MEDIA_PROVIDER=auto` / `4khdhub` (default) | Server-side catalogue & mirror resolver using `safeFetch.ts` (explicit host allowlist, manual redirect validation, private/IMDS IP blocking, 2 MiB body cap, per-hop timeouts, bounded retries, zero credential forwarding) and sanitized `cheerio` parsing. Never substitutes Demo or Archive data on upstream failure. |
| `demoProvider.ts` + `demoCatalog.ts` | `MEDIA_PROVIDER=demo` | Explicit placeholder catalogue; every card carries a **Demo** badge. |
| `tmdbProvider.ts` | `MEDIA_PROVIDER=tmdb` (requires key) | Official TMDb v3 API — metadata, artwork, YouTube trailer keys and JustWatch availability links. |
| `archiveProvider.ts` | `MEDIA_PROVIDER=archive` | Internet Archive Scrape API + `/embed/<id>` and `/download/<id>` endpoints. Note: upload to an Internet Archive collection is not proof of public-domain status. |
| `mergedProvider.ts` | `MEDIA_PROVIDER=merged` | Explicit opt-in router combining TMDb metadata with Internet Archive items. |

Routes & root-level JSON response shapes:

```text
GET  /api/media/browse?type=movie|series&q=&genre=&year=&language=&sort=&page=
       -> { kind, items, page, totalPages, totalResults, pageSize, featured, rails, facets, provider, filtered }
GET  /api/media/search?q=&type=movie|series|all&limit=
       -> { query, items, provider }
GET  /api/media/title/movie|series/<slug>
       -> { title, seasons, related, playback, downloads?, releases?, provider, attribution? }
GET  /api/media/seasons/<slug>?season=2
       -> { seasons }
POST /api/media/resolve   (JSON: { url, fileName?, label? })
       -> { status: "resolved" | "partial" | "blocked" | "error", links, externalFallbackUrl?, reason?, message?, hops }
```

Manual verification (`curl` + `jq`, normal internet environment with `npm run dev`):

```bash
# 1. Search (root `.items`)
curl -s "http://localhost:3000/api/media/search?q=inception&type=movie" \
  | jq '{query, provider: .provider.id, count: (.items | length), first: .items[0] | {slug, title, year, poster}}'

# 2. Movie detail (root `.title`, `.releases`)
curl -s "http://localhost:3000/api/media/title/movie/hub-moana-movie-8014" \
  | jq '{title: .title.title, year: .title.year, releases: (.releases | map({quality, size, container, mirrors: (.mirrors | length)}))}'

# 3. Series detail (root `.title`, `.releases` season packs, `.seasons`)
curl -s "http://localhost:3000/api/media/title/series/hub-marvels-the-punisher-series-2288" \
  | jq '{title: .title.title, packCount: (.releases | length), seasons: (.seasons | map({seasonNumber, episodes: (.episodes | length)}))}'

# 4. Multi-hop mirror resolution (root `.status`, `.hops`, `.links`)
BODY=$(curl -s "http://localhost:3000/api/media/title/movie/hub-moana-movie-8014" \
  | jq -c '{url: .releases[0].mirrors[0].shortUrl, fileName: .releases[0].fileName, label: .releases[0].mirrors[0].label}')
curl -s -X POST "http://localhost:3000/api/media/resolve" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  | jq '{status, reason, hops: (.hops | map({step, host, status})), links}'

# 5. Browser HLS player check (`Native HLS` on Safari, `HLS · hls.js MSE` on Chrome/Firefox)
MEDIA_PLAYBACK_MANIFEST='{"movie/hub-moana-movie-8014":[{"url":"https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8","type":"hls","label":"HLS Test Stream"}]}' npm run dev
```

### Playback & media container policy

- **Server-side fetch security (`src/lib/media/safeFetch.ts`)**: No public CORS proxies are used. Outbound requests run server-side over HTTPS (port 443 only), verify every hop against explicit `catalogue` / `mirror` host allowlists, resolve DNS ahead of socket connect to block private/loopback/link-local/CGNAT/IMDS addresses, cap streamed HTML at 2 MiB, enforce timeouts and bounded retries, and strip all caller cookies/credentials.
- **No access-control or CAPTCHA bypass**: Public Base64/ROT13 redirect tokens (`s('o', '...')`) and standard HTTP redirects are inspected statically without executing script code. If any hop encounters a CAPTCHA/Turnstile challenge or 401/403 restriction, resolution stops immediately (`status: "blocked"`) and surfaces the last validated HTTPS link as an external fallback.
- **Browser-compatible playback truth (`src/lib/media/hubResolver.ts` + `src/lib/media/hlsPlayer.ts`)**:
  - `.mkv` releases (including extensionless PixelDrain/R2 download URLs paired with `.mkv` filenames) and `.zip` season archives are never passed to `<video>` — they are marked `playable: false, delivery: "download"` with direct download and URL-copy controls for external players (VLC / IINA / MPV).
  - `.m3u8` URLs are treated strictly as HLS manifest candidates (never claimed guaranteed-playable from file extension alone): `hlsPlayer.ts` first probes `video.canPlayType("application/vnd.apple.mpegurl")` (Safari / iOS native HLS), falls back to `hls.js` over MediaSource Extensions (`Hls.isSupported()`) on Chrome / Firefox / Edge with bounded 1-attempt recovery, and surfaces a diagnostic alert + Copy/Open URL fallback if MSE is unsupported, CORS blocks manifest/segment requests, or segment codecs fail to decode.

---

## Icons

The app icon is a white **S** on a red squircle. The PNGs in `public/` are generated by
`tools/gen-icons.mjs` (`npm i --no-save @resvg/resvg-js && node tools/gen-icons.mjs`).
