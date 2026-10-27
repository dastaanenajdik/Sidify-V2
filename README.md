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
| **Listen Together** | Rooms with a six-character code (no I/L/O), invite link and QR. Up to 5 people (host can raise it to 10), host-only control, remove members, host hand-over, shared queue, room AutoPlay, activity log. Devices share one server clock (round-trip-corrected) and correct drift, so playback stays aligned. **1:1 voice and 4K video calls** live inside every room: browser-to-browser WebRTC (Opus HD, echo cancellation, noise suppression), free public STUN, mute, camera toggle, live speaking indicators and a live quality readout. Voice calls duck the shared music; **video calls keep the song playing at full volume** (with an optional duck button). |
| **Recommendations** | Home: Top picks (your mix, song radio from your last play, top-artist radio), Quick picks, Recently played, New releases, Trending, From your likes. Explore: new releases, charts and mood / genre tiles. |
| **Movies & Series** | `/movies` and `/series`: featured backdrop hero, trending / new / top-rated / popular shelves, a **Free to watch** shelf of public-domain films, genre · year · language · sort filters, search, poster cards with a local watchlist. Detail pages carry official trailers, seasons and episodes, "more like this", and a real player — TMDb/JustWatch links for licensed titles, the Internet Archive's own player plus its download options for free films. Catalogue releases show **one row per movie / episode** with **Try Play (beta)**, **Play with VLC** and **Download** (Play with VLC opens a sheet that loads stream links across all qualities automatically so any link opens VLC in one real tap; Download picks quality on demand); series get **season tabs**, each holding its own episodes and complete-season packs. |
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

### Voice & 4K video calls (1:1)

Both call types are pure **peer-to-peer WebRTC** — no audio or video ever flows
through our servers, so there is no media bandwidth bill. Each room document
gains three ephemeral fields: `voiceCall` (the member ids currently in the
call), `callMode` (`"voice"` or `"video"`, set by the first seat so the other
side can ring with the right UI) and `signals` (SDP offers/answers and ICE
candidates). `POST /api/rooms/{code}/signal` appends an envelope; the regular
500ms room poll collects envelopes addressed to the recipient and deletes them
in the same read — no WebSocket, no second service, works with both the
Postgres and the in-memory store. While a call is being negotiated the poll
temporarily drops to ~60ms so SDP/ICE are not stuck behind a polling delay;
normal cadence resumes as soon as media is connected.

NAT traversal uses free public STUN (Google + Cloudflare); on networks where
peer-to-peer is blocked, a TURN server can be added to `ICE_CONFIG` in
`src/lib/rooms/voice.ts` without touching anything else. Signal envelopes are
allowed up to 48 KB (and 64 queued envelopes) because a 4K offer lists every
supported video codec.

**Low latency.** Microphone capture requests 48 kHz fullband Opus with echo
cancellation, noise suppression, a zero `latency` hint and voice isolation.
The pure helpers in `src/lib/rooms/media.ts` rewrite the local SDP to use
10 ms Opus frames with in-band FEC disabled (one less frame of playout delay),
and receivers are asked for a zero jitter-buffer/playout-delay target. Nothing
can make a network literally zero-latency, but these remove every buffer this
app controls; the video tile shows the live candidate-pair RTT and the
resolution/fps actually arriving.

**4K quality.** Video calls request 3840 × 2160 at up to 60 fps through a
ladder of `ideal` constraints (`media.ts`), so a lesser camera still connects
at its best mode rather than failing. VP9/H.264 are preferred (hardware 4K
encoders, unlike a software encoder, do not add a frame of latency), the video
sender gets a 24 Mbps `b=AS`/`b=TIAS` ceiling with
`degradationPreference: "maintain-resolution"`, and a 1s `getStats()` loop
steers the bitrate to the measured available bandwidth so frames are not
queued behind congestion. If the camera cannot do 4K, the tile honestly shows
the resolution that is really arriving.

**Music keeps playing.** A live voice call still calls `setMusicDuck()` to
lower the shared song to 22% so speech stays clear. A video call deliberately
leaves it at full volume — the song keeps playing — because the mic's echo
cancellation removes the speaker's own playback from the outgoing audio. The
call bar has a "Duck music" button for anyone who prefers it quieter.

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
POST /api/media/resolve   (JSON: { url, fileName?, label?, refresh? })
       -> { status: "resolved" | "partial" | "blocked" | "error", links, externalFallbackUrl?, reason?, message?, hops }
```

### Exclusive collection

`/exclusive` is a second, separate catalogue with its own landing page, search,
filters, recommendations and player. Nothing from the main catalogue is merged
into it. Design, ranking rules and the playback/audio model are documented in
[docs/exclusive-collection.md](docs/exclusive-collection.md).

```text
GET /api/media/exclusive?mode=home[&type=movie|series|all]
       -> { mode, spotlight, rails, genres, facets, total, updatedAt, provider }
GET /api/media/exclusive?mode=search&q=&type=&genre=&year=&language=&sort=&page=&limit=
       -> { mode, query, items, page, totalPages, totalResults, pageSize, filters, facets, genres, provider, tookMs }
GET /api/media/exclusive/suggest?q=&limit=
       -> { query, items, tookMs }
GET /api/media/exclusive/title/<slug>[?type=movie|series]
       -> { detail, recommendations, provider }
```

#### Browser-direct fetching (and when it falls back)

The catalogue blocks or rate-limits shared datacenter ranges, and a serverless
function egresses from one. So the browser fetches it directly whenever it can:

1. `POST /api/media/exclusive/ticket` — the server signs one batch of upstream
   requests (no `url` field, no secrets, ≤ 4 calls, `no-store`, rate-limited).
   Signing is local crypto, so this works even if the deployment itself cannot
   reach the catalogue; the browser then performs the visitor login itself and
   sends its own token back on the next batch.
2. The browser sends those signed requests itself, so **the upstream sees the
   user's address**; payloads are composed by the same code as the server path.
3. If the upstream's CORS policy refuses, the call quietly falls back to the
   relay routes above, and if those fail too the last `localStorage` snapshot is
   shown with a "saved copy, 2 hours ago" label and a **Retry** button. The rest
   of Sidify is never affected.

`NEXT_PUBLIC_EXCLUSIVE_DIRECT=0` pins the relay path. `MEDIA_UPSTREAM_HEADER_PROFILE`
(`mobile` | `browser`) and `MEDIA_UPSTREAM_RELAY_URL` cover the server side; see
[docs/exclusive-collection.md](docs/exclusive-collection.md#two-transports-browser-direct-or-server-relay).

Title pages resolve entirely in the browser too: one ticket batch signs
`detail` (`subject-api/get`), `playback` (`subject-api/play-info/v2`) and
`resource` (download mirrors), and all three run from the viewer's connection —
there is no server-side resolution endpoint left. A cookie-signed DASH manifest
still streams through `/api/media/vault-stream/` because a browser cannot send
the CDN's `Cookie`, but its relay URL is built in the browser; direct MP4/HLS
files never touch the relay.

Playback uses Shaka Player with a quality ladder, audio-track picker, subtitles,
an audio watchdog (decoded audio vs rendered video, with an ordered recovery)
and resume points shared with the title page.

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
  - `.mkv` releases (including extensionless PixelDrain/R2 download URLs paired with `.mkv` filenames) are never *marked* playable — the resolver keeps them `playable: false, delivery: "download"`. Only the explicit **Try Play (beta)** action attempts them in `<video>` (see below); `.zip` season archives are download-only.
  - `.m3u8` URLs are treated strictly as HLS manifest candidates (never claimed guaranteed-playable from file extension alone): `hlsPlayer.ts` first probes `video.canPlayType("application/vnd.apple.mpegurl")` (Safari / iOS native HLS), falls back to `hls.js` over MediaSource Extensions (`Hls.isSupported()`) on Chrome / Firefox / Edge with bounded 1-attempt recovery, and shows a plain "Something went wrong" alert with Copy/Open URL fallback if MSE is unsupported, CORS blocks manifest/segment requests, or segment codecs fail to decode.

### Try Play (beta), quality popup and season tabs

- **Search**: the main search (the one that finds music) also searches movies & series, and both answers land in the same place — the **Top results** tab puts the top result and the songs first, the movies & series list directly under them (two columns when there is room). There's also a **Movies & series** tab for nothing but posters.

- **One row per item.** A movie, an episode and a season's packs each show a single row with **Try Play (beta)**, **Play with VLC** and **Download**. Download opens a popup listing that item's qualities (best first, with size and codec *hints*); a quality's mirrors are resolved only after it is picked, trying the next mirror if one fails. Links come with Download, Copy URL and "open in a player app".
- **Try Play (beta)** (`src/lib/media/playbackPlan.ts` + `BetaPlayerSheet.tsx`) starts with the highest quality and steps down (2160p → 1080p → 720p → 480p). A file counts as playing only on real media events: first a frame with a picture (`loadeddata` + `videoWidth > 0`), then — in Chromium (Chrome, Edge, Android Chrome) — **sound that actually decodes**: the decoder byte counters (`webkitAudioDecodedByteCount` vs `webkitVideoDecodedByteCount`) must show audio within ~2 s of playback. Video that plays with zero decoded audio (Dolby DD / DDP in Chrome) is a `no-audio` failure and the next quality is tried. Elsewhere (Firefox, Safari) there are no live counters, so releases whose file name names only browser-unsupported audio are simply tried after the others. A decode failure, "no supported streams", no picture or no sound skips the other servers of that encode; network-type failures (403/404, DNS, expired tokens, 15 s without a frame) try the next server/mirror. Each session is capped at 12 attempts / 180 s.
- **When nothing plays with sound here**, the player says so plainly and leads with **Play with VLC** (opens the file in VLC, where Dolby / HEVC / MKV play with sound and picture), next to the original file (**Download … (video + audio)**) and **Play without sound** for the best silent version. Downloads are always the host's original file with every audio track.
- **Player controls**: ⟲ 10s / 10s ⟳ buttons and ← / → (or J / L) keys jump 10 seconds — in the Try Play player and the operator stream player.
- **Continue where you stopped** (`resumePoints.ts`): the position of each movie / episode is saved in this browser (localStorage; seconds only — no URLs or tokens) every few seconds, on pause, on close and when the tab is hidden. Reopening resumes there ("Resumed from 23:10 · Start over"), and the Try Play button reads "Resume 23:10". The last ~3% (credits) counts as finished.
- **At most one re-resolve per session** (`refresh: true`, honoured only when the cached result is ≥ 15 s old). A mirror that returns `blocked` (CAPTCHA / 401–403) is skipped — never retried or bypassed. A link that dies mid-playback is recovered in the same session and resumes at the same second.
- **Hints, not promises.** Codec tags from file names (HEVC, 10-bit, DV, DDP, AAC…) and `canPlayType()` self-reports only produce hedged notes ("there may be no sound") and the try order — never a verdict. **"No sound / black screen?"** still offers the next quality, the file itself, and external players.
- **External players** (`externalPlayers.ts`) are best-effort per platform — Android `intent:` links for VLC / MX Player / app chooser, iOS VLC / Infuse URL schemes, IINA on macOS, an `.m3u` playlist for desktop players — always next to **Copy URL**.
- **Play with VLC** (`VlcPickerSheet.tsx` + `VlcPlayButton.tsx` + `externalLaunch.ts` + `externalStream.ts`) opens a popup sheet that automatically resolves direct stream links across **every available quality** (2160p, 1080p, 720p, 480p…), ranking verified streams and byte-range CDN servers (`FSL Server` / R2) ahead of two-step redirects and rate-limited hosts while showing every resolved server link. Because every link is already resolved and rendered as a genuine `<a href>` (`intent:` with `package=org.videolan.vlc` on Android, `vlc-x-callback:` on iOS, `.m3u` playlist download on desktop), tapping any link carries a real user gesture and opens VLC immediately to start playback. Packs / archives remain Download-only.
- **No media through Sidify's servers.** `/api/media/resolve` only fetches small HTML hops; the browser (or the external app) loads the media URL directly. Nothing is proxied or transcoded, so this works unchanged on Vercel.
- **User-facing errors** in the movies & series UI are always just "Something went wrong" (with Try again / alternatives). Resolver hops and upstream reasons stay in API responses and server logs.
- **Diagnostics for developers.** Failures are logged to the browser console as `[Sidify media] …`. Logged: the resolve call's HTTP status / content type, the media error code and message, `readyState` / `networkState`, and the HLS error category. URLs are cut to host + file name, so no tokens are logged.
- **Protected preview deployments.** The browser's resolve call sends same-origin cookies (`credentials: "same-origin"`), so Vercel Deployment Protection's `_vercel_jwt` cookie lets it reach `/api/media/resolve`. With `omit`, every resolve on a protected preview got Vercel's 401 page. The route never reads those cookies or forwards them upstream.
- **When only the host page resolves** (`partial`: no direct server links found), the Download popup offers **Open download page** — the validated HubCloud / HubDrive page — rather than an error.
- **Autoplay.** If the browser refuses autoplay with sound (Safari / iOS when `play()` runs after resolving the link), playback starts muted with a **Turn sound on** button. It is not counted as a broken link.

---

## Icons

The app icon is a white **S** on a red squircle. The PNGs in `public/` are generated by
`tools/gen-icons.mjs` (`npm i --no-save @resvg/resvg-js && node tools/gen-icons.mjs`).
