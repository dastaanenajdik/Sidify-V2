# Sidify V2 — Complete Tech Stack

> Poora breakdown: music search kaise hota hai, playback kaise hota hai, UI kis cheez se bana hai,
> data kahan store hota hai, aur kaunsi cheezein stub/fake hain.
> Repo: `dastaanenajdik/Sidify-V2` · ~5,970 lines TS/TSX · 50 source files

---

## 1. One-line summary

Sidify ek **YouTube-powered music streaming PWA** hai. Isme Spotify/Apple/JioSaavn ka **koi official API nahi** hai —
search, metadata, artwork aur audio **sab YouTube se** aata hai, server-side `yt-dlp` binary + `youtubei.js` se extract hota hai.
Frontend Next.js 16 (App Router) + React 19 + Tailwind v4 + Zustand + React Query, audio playback **Web Audio API**
ke custom dual-deck graph se (real DSP: EQ, crossfade, pan), aur fallback ke roop mein **YouTube IFrame Player API**.

---

## 2. Core framework

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Framework | **Next.js** (App Router) | `16.2.6` | `src/app` structure, Route Handlers as API |
| UI lib | **React / ReactDOM** | `19.2.6` | Client Components (`"use client"`) heavy |
| Language | **TypeScript** | `5.9.3` | `strict: true`, path alias `@/* -> ./src/*` |
| Runtime | **Node.js** | — | `export const runtime = "nodejs"` + `maxDuration = 60` har media route pe (yt-dlp spawn karne ke liye) |
| Package name | `nextjs-postgresql-template` | — | Starter template se banaya gaya, rename nahi hua |

Scripts: `dev`, `build`, `start`, `lint`, `typecheck`. **No test framework, no CI, no Dockerfile/vercel.json** repo mein.

---

## 3. Music Search — kaise kaam karta hai

### 3.1 Source: YouTube via `yt-dlp` (server-side only)

`src/lib/ytdlp.ts` — client ko kabhi expose nahi hota.

- Repo mein **binary commit kiya gaya hai**: `bin/yt-dlp` (~5.4 MB).
- Path resolution order: `process.env.YTDLP_PATH` → `/app/bin/yt-dlp` → `yt-dlp` on PATH.
- Execution: `node:child_process.execFile` (shell nahi → command injection safe),
  `timeout`, `maxBuffer: 64 MB`, `killSignal: SIGKILL`, global flags `--no-warnings --skip-download`.

**Search command:**
```bash
yt-dlp --no-warnings --skip-download "ytsearch20:{query}" --flat-playlist --dump-json   # 30s timeout
```
`--flat-playlist` = fast (per-video page fetch nahi karta). Output NDJSON, line-by-line `JSON.parse`.
Query sanitize: control chars stripped, 120 char cap.

**Artist / channel command:**
```bash
yt-dlp "https://www.youtube.com/channel/{UC...}/videos" -J --flat-playlist --playlist-items 1-20   # 40s timeout
```
`@handle` bhi support (`https://www.youtube.com/@handle/videos`). Fail hone pe plain name-search pe fallback.

### 3.2 "Albums" aur "Artists" — actually kya hain

- **Albums = pseudo albums.** Real album catalog nahi hai. Search query ko JSON me pack karke
  `base64url` encode kiya jata hai: `ytq-<base64url({q,t,a})>`. Album page khulne pe wahi query dobara
  search hoti hai (fallback chain: full query → title → `{artist} best songs`).
- **Artists = YouTube channels.** `id` = `channel_id`, `name` = channel name. Artist page = channel ke videos +
  3 synthetic "albums" (`{name} best songs`, `{name} full album`, `{name} live performance`).
- **Artwork = YouTube thumbnails:** `https://i.ytimg.com/vi/{id}/maxresdefault.jpg` (server best thumbnail pick karta hai, `.webp` skip).
  Client pe global `error` listener fallback chain chalata hai: `maxres → sd → hq → mq → default → /icon.png`.

### 3.3 Caching (bahut important — yt-dlp slow hai)

| Cache | TTL |
|---|---|
| Search results (in-memory `Map`) | 10 min |
| Channel/artist | 30 min |
| Resolved audio URL | 90 min (negative/fail = 60 sec) |
| Home page payload | 10 min (per country) |
| HTTP header on `/api/search` | `public, s-maxage=300, stale-while-revalidate=600` |

Plus **in-flight dedupe** — same query ke 10 parallel requests pe yt-dlp ek hi baar chalta hai.

### 3.4 Home page (`/api/home`)

Fully **hardcoded curated queries** se banta hai, koi charts API nahi:
`trending songs 2026 official audio` (22 results), aur 6 "new release" shelves —
New Music 2026 / Bollywood Fresh / Pop Radar / Punjabi Heat / Hip-Hop Now / Lo-Fi Corner.
`topArtists` = trending results ke unique channels. `recommended` = `{lastPlayedArtist} songs` search
(history na ho to `chill hits 2026`). `recentlyPlayed` = Postgres se 12 rows.

### 3.5 Search UI (`src/app/search/page.tsx`)

- **300 ms debounce** + URL sync (`router.replace('/search?q=...')`, `scroll: false`)
- **React Query** (`queryKey: ["search", q, tab, region]`, `staleTime: 60s`)
- Tabs: All / Songs / Albums / Artists; Songs pe 30 limit, baaki 22
- 12 **category tiles** (Top Hits, Bollywood, K-Pop, Hip-Hop, EDM, Indie, Jazz, Punjabi, Rock, 90s, Acoustic, Sad Hours) — Tailwind gradients
- **Search history** `localStorage["sidify-search-history"]` (max 8, dedupe case-insensitive)
- Explicit filter client-side toggle (note: yt-dlp se `explicit` flag aata hi nahi, hamesha `false`)

---

## 4. Playback — dual-engine architecture

`src/lib/audioEngine.ts` (804 lines, sabse bada file) + `src/lib/ytPlayer.ts` + `src/app/api/stream/route.ts`.

Do modes hain, automatically choose hote hain:

### 4.1 Audio URL resolution chain (server)

`resolveAudio(videoId)` — `src/lib/ytdlp.ts`:
```
yt-dlp player_client=web  →  android  →  tv_embedded  →  youtubei.js (Innertube, ANDROID client)
```
- yt-dlp: `--dump-single-json -f "bestaudio[ext=m4a]/bestaudio/best" --extractor-args youtube:player_client={client}` (35s timeout)
- URL direct na mile to `formats[]` me se best audio-only (acodec ≠ none, vcodec = none) highest `abr/tbr` pick
- `youtubei.js` **v18** = fallback library (`Innertube.create({ client_type: "ANDROID", generate_session_locally: true })`)
- `next.config.ts` me `serverExternalPackages: ["youtubei.js"]` (bundler se exclude)

### 4.2 `/api/stream` — proxy (do modes ek hi endpoint pe)

```
GET /api/stream?video_id={id}          → JSON metadata {title, artist, thumbnail, duration, audio_url}
GET /api/stream?video_id={id}&play=1   → actual audio BYTES (proxied)
```
Proxy kyun? YouTube ke `googlevideo.com` URLs **CORS + IP-bound** hote hain. Server unhe fetch karke
same-origin pe re-serve karta hai, **`Range` header passthrough** ke saath (seeking ke liye zaroori),
aur `content-type/length/range/accept-ranges` copy karta hai (default `audio/mp4`, `cache-control: no-store`).
Upstream `403/410` (URL expire) → cache skip karke re-resolve + retry.

### 4.3 Engine A — "native" mode (primary): Web Audio API

Ye asli DSP hai, sirf `<audio>` tag nahi:

```
HTMLAudioElement (Deck 0) ─┐
                           ├─→ MediaElementSource
HTMLAudioElement (Deck 1) ─┘        │
                                    ▼
        5× BiquadFilterNode  (60 Hz lowshelf · 230/910/3600 Hz peaking · 14 kHz highshelf, Q=1)
                                    │
                                    ▼
                            GainNode (per-deck, crossfade ke liye)
                                    │
                                    ▼
                        master GainNode  (volume × normalization 0.82)
                                    │
                                    ▼
                        StereoPannerNode (balance −1..1)
                                    │
                                    ▼
                          AudioContext.destination
```

Features:
- **Dual-deck crossfade** (0–12 s) — `linearRampToValueAtTime` se dono decks ke gains opposite ramp
- **Gapless playback** — remaining < 9 s pe next track idle deck me preload (`el.load()`)
- **5-band EQ** presets: Flat / Bass Boost / Rock / Treble / Vocal / Custom — `setTargetAtTime` se smooth
- **Volume normalization**, **balance/pan**, **playback speed 0.5×–2×** (`el.playbackRate`)
- Progress loop: `requestAnimationFrame` + ~220 ms throttle → Zustand (`positionMs`, `durationMs`)
- Downloaded tracks IndexedDB blob se `URL.createObjectURL()` ke through natively play hote hain

### 4.4 Engine B — "iframe" mode (fallback): YouTube IFrame Player API

`src/lib/ytPlayer.ts` — singleton `ytController`:
- API script `https://www.youtube.com/iframe_api` lazy load, `window.onYouTubeIframeAPIReady` promise-wrap
- **Hidden "harbor" trick:** ek off-screen div (`left:-9999px; opacity:0.01; pointer-events:none`) me iframe rehta hai
  → pura app-wide background audio playback, kisi page pe bhi music nahi rukta
- **Video mode:** wahi *same* iframe DOM me visible slot me `appendChild` karke move hota hai →
  playback position bilkul preserve, dobara load nahi hota. `detachToHarbor()` se wapas.
- `playerVars`: `controls:1, rel:0, playsinline:1, modestbranding:1, iv_load_policy:3, disablekb:1`
- Rate YouTube ke allowed steps pe snap: `[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]`
- Progress polling ~240 ms (`getCurrentTime/getDuration`)
- iframe `allow="autoplay; encrypted-media; picture-in-picture; fullscreen"`

### 4.5 Mode selection logic

```
downloaded (IndexedDB me blob hai)?  → native (offline)
videoMode ON?                        → iframe
probeNative(): GET /api/stream       → 200 = native, warna iframe
```
Probe result **5 min cache**, 24 s abort timeout. `playSeq` counter se stale async race conditions handle hoti hain.

### 4.6 Queue / playback logic

- Shuffle: history-aware random (last 6 played indices avoid)
- Repeat: `off` / `all` / `one`
- **Autoplay fill:** queue khatam hone pe same-artist search karke 8 naye tracks append (blocked artists filter)
- **Error auto-skip:** track unavailable → next; 4 consecutive errors → pause + toast
- **Sleep timer:** N minutes ya "end of track"
- **Session restore:** `localStorage["sidify-session"]` = queue + index + positionMs,
  saved on `beforeunload` aur `visibilitychange`
- **Keyboard shortcuts:** `Space` = play/pause, `Shift+→` = next, `Shift+←` = prev (inputs me disabled)

### 4.7 OS integration — Media Session API

`navigator.mediaSession` → lock screen / notification controls:
- `MediaMetadata` (title, artist, album "Sidify", 3 artwork sizes: 320×180, 480×360, 512×512)
- Action handlers: `play`, `pause`, `nexttrack`, `previoustrack`, `seekbackward` (−10 s), `seekforward` (+10 s), `seekto`

---

## 5. Downloads / Offline

`src/lib/clientApi.ts` + `src/lib/offlineDb.ts`

- Client `fetch('/api/stream?...&play=1')` → `res.body.getReader()` se stream read →
  chunks → `new Blob(chunks, {type:"audio/mp4"})` → **IndexedDB**
- IndexedDB: database `sidify-offline`, object store `audio`, key = trackId
- Live **progress %** (`content-length` ke against), Zustand `downloadProgress` me
- Metadata Postgres `downloads` table me (quality, sizeBytes, timestamp)
- Object URLs ek `Map` me cache (revoke helper ke saath)
- Storage estimate: `navigator.storage.estimate()` (Settings → Storage used)
- Settings: download quality (low/medium/high), Wi-Fi only, auto-download liked songs
- ⚠️ Note: "encrypted-browser storage" UI copy hai — actually plain IndexedDB blob hai

---

## 6. Database

| Item | Detail |
|---|---|
| DB | **PostgreSQL** |
| ORM | **Drizzle ORM** `0.45.2` (`drizzle-orm/node-postgres`) |
| Driver | **pg** `8.20.0` — `Pool`, `globalThis` pe cache (dev HMR safe) |
| Migrations | **drizzle-kit** `0.31.10`, `drizzle.config.json` |
| Env | `DATABASE_URL` **required** — na ho to module load pe throw |

**7 tables** (`src/db/schema.ts`) — sab denormalized, track ka pura payload `jsonb` me, koi foreign key nahi:

| Table | Key | Payload |
|---|---|---|
| `liked_songs` | trackId (PK) | jsonb + likedAt |
| `recently_played` | trackId (PK) | jsonb + playedAt |
| `downloads` | trackId (PK) | jsonb + quality + sizeBytes (bigint) |
| `playlists` | serial id | name + createdAt |
| `playlist_tracks` | serial id | playlistId + trackId + jsonb + position |
| `followed_artists` | artistId (PK) | jsonb + followedAt |
| `blocked_artists` | artistId (PK) | name + blockedAt |

⚠️ **Koi auth nahi** — no `user_id` column. Ek hi global library, single-user design.
`/api/library/restore` = Settings ke JSON backup export ko bulk re-insert karta hai (`onConflictDoNothing`).

---

## 7. State management

### Zustand `5.0.15` — 3 stores

| Store | Persist | Contents |
|---|---|---|
| `store/player.ts` | ✅ `sidify-player` (partialize: volume, speed, shuffle, repeat, videoMode) | queue, index, isPlaying, isLoading, positionMs, durationMs, resumeFromMs, fullPlayerOpen, queueOpen, eqOpen, engineMode, sleepMode, contextLabel, likedIds, downloadedIds |
| `store/settings.ts` | ✅ `sidify-settings` | theme, accent, language, region, wifi/mobile quality, crossfadeSecs, gapless, autoplay, rememberPosition, eqPreset, eqGains, normalization, balance, downloadQuality, wifiOnly, autoDownloadLiked, mediaControls, notifControls, bluetoothAutoplay, explicitFilter, profileName/Email |
| `store/ui.ts` | ❌ | toasts, track context menu (x/y), add-to-playlist modal, sleep menu, downloadProgress |

`zustand/middleware` ka `persist` = localStorage.

### TanStack React Query `5.102.8` — server state

`QueryClient` defaults: `retry: 1`, `refetchOnWindowFocus: false`, `staleTime: 30_000`.
`src/lib/library.tsx` me custom hooks: `useLiked`, `useDownloads`, `useBlocked`, `useFollowed`, `usePlaylists`
(`useQuery` + `useMutation` + `invalidateQueries`), plus ek chhota **event bus** (`emitRefresh`) aur
optimistic updates (like toggle turant UI me, fail pe rollback).

`localStorage` keys: `sidify-player`, `sidify-settings`, `sidify-session`, `sidify-search-history`.

---

## 8. UI / Design system

| Area | Technology |
|---|---|
| Styling | **Tailwind CSS v4.1.17** — CSS-first (`@import "tailwindcss"`), `@tailwindcss/postcss` plugin, **koi `tailwind.config.js` nahi** |
| Build | **PostCSS** `8.5.8` |
| Theming | CSS custom properties + `data-theme="dark|light"` attribute; **runtime accent injection** (`--accent`, `--glow` = accent @ 35% alpha) |
| Fonts | **`next/font/google`** — `Inter` (body) + `Sora` (display), self-hosted, CSS vars `--font-inter` / `--font-sora` |
| Icons | **lucide-react** `1.43` (18 files me use) |
| Animation | **Framer Motion** `13.2` — `motion`, `AnimatePresence`, aur `Reorder.Group/Item` (queue drag-to-reorder) |
| Component lib | **None** — no shadcn/Radix/Headless UI. Sab hand-rolled |
| Class merge | Local `cx()` helper (`src/lib/format.ts`). ⚠️ `clsx` package.json me hai par **unused** |

**Visual language:** dark neon glassmorphism.
- Tokens: `--bg #06060a`, `--bg-elev`, `--panel rgba(255,255,255,.045)`, `--border`, `--muted`, `--glow`
- `.glass` = `backdrop-filter: blur(24px)`; `.glass-strong` = `blur(28px) saturate(1.4)` + `color-mix(in srgb, ...)`
- `.text-glow` = double text-shadow neon; accent `box-shadow` glows play button pe
- 6 accent presets: Neon Green `#00E676`, Electric Violet, Cyan Pulse, Hot Pink, Sunset Orange, Royal Blue
- CSS `@keyframes eqbar` = animated equalizer bars (`LiveEq` component, paused state support)
- Custom range sliders: `.th-slider` (horizontal seek, hover-reveal thumb, `--fill` var) aur
  `.v-slider` (vertical EQ — `writing-mode: vertical-lr; direction: rtl`)
- Custom scrollbars, `::selection` accent, `.hero-blend { mix-blend-mode: plus-lighter }`
- Light theme ke liye pura alag token set

**Layout:**
- Desktop: fixed `248px` sidebar (Home / Search / Library / Downloads / Settings + playlists) + scrollable main (`h-dvh`, `pb-[104px]`)
- Mobile: `MobileNav` bottom bar + full player as animated sheet, `pb-[168px]`
- `MiniPlayer` (bottom, framer-motion animated artwork) + `FullPlayer` (fullscreen, `#player-slot` me video host)
- Accessibility: `aria-label` throughout, `.ring-focus:focus-visible` accent outline
- Responsive breakpoints: `md:`, `xl:`

---

## 9. PWA

| Piece | Detail |
|---|---|
| Manifest | `public/manifest.json` — `display: standalone`, `display_override: ["window-controls-overlay","standalone"]`, `orientation: portrait-primary`, theme/bg `#06060a`, maskable icons |
| Service worker | `public/sw.js` — **hand-written**, koi Workbox/next-pwa nahi |
| Caching strategy | Navigations: **network-first** + offline shell fallback (`/`); static assets (`/_next/static`, `/_next/image`, images/fonts/css/js): **cache-first** + background fill |
| Never cached | `/api/*` (search/stream/library) aur **saare cross-origin** requests (YouTube thumbnails/media) |
| Cache names | `sidify-shell-v1`, `sidify-static-v1` (activate pe purane purge) |
| Install flow | `beforeinstallprompt` capture → `window.__sidifyInstall`, custom "Install Sidify" button (Settings), `appinstalled` → success toast |
| Headers (`next.config.ts`) | `sw.js`: `Cache-Control: max-age=0, must-revalidate` + `Service-Worker-Allowed: /` · manifest: 1 h cache · global: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` |
| iOS | `appleWebApp: { capable, title, statusBarStyle: black-translucent }`, apple-touch-icon |

⚠️ **Bug:** manifest + layout `/icon.png`, `/icon-192.png`, `/icon-512.png`, `/icon-maskable-192.png`,
`/icon-maskable-512.png` reference karte hain, par `public/` me sirf `manifest.json` aur `sw.js` hain —
**saare icon files missing**. SW install pe `cache.addAll` fail hoga (`.catch(() => skipWaiting())` se silently recover karta hai).

---

## 10. API surface (Next.js Route Handlers)

| Endpoint | Method | Kaam |
|---|---|---|
| `/api/search?q&type&limit` | GET | yt-dlp search → `{songs, albums, artists, items}` |
| `/api/stream?video_id[&play=1]` | GET | metadata JSON **ya** proxied audio bytes (Range support) |
| `/api/home?country` | GET | trending / new releases / top artists / recommended / recently played |
| `/api/artist/[id]` | GET | YouTube channel → artist profile + songs + pseudo albums |
| `/api/album/[id]` | GET | `ytq-…` decode → search-based tracklist |
| `/api/library/liked` | GET/POST/DELETE | liked songs |
| `/api/library/recent` | GET/POST/DELETE | recently played |
| `/api/library/followed` | GET/POST/DELETE | followed artists |
| `/api/library/blocked` | GET/POST/DELETE | blocked artists |
| `/api/library/restore` | POST | bulk backup restore |
| `/api/playlists`, `/api/playlists/[id]` | GET/POST/PATCH/DELETE | playlists + tracks (reorder, rename) |
| `/api/downloads` | GET/POST/DELETE | download metadata |
| `/api/health` | GET | `select 1` DB ping |

## 11. Pages

`/` (Home) · `/search` · `/library` · `/downloads` · `/settings` · `/album/[id]` · `/artist/[id]` · `/playlist/[id]`

## 12. Components (sab hand-rolled)

`Providers` (QueryClient + ThemeApplier + EngineBootstrap + PlatformBootstrap + DataSync) · `Sidebar` (+`MobileNav`) ·
`MiniPlayer` · `FullPlayer` (463 lines — queue Reorder, EQ panel, speed, sleep, video mode) · `SeekBar` ·
`TrackRow` · `TrackMenu` · `cards` (AlbumCard/ArtistCard) · `controls` (PlayButton/Toggle) · `Modals`
(AddToPlaylist + SleepTimer) · `Toasts` · `Section` · `SidifyLogo` (+`LiveEq`)

---

## 13. Tooling & dev deps

ESLint `9.39.4` (flat config) + `eslint-config-next/core-web-vitals` · `drizzle-kit` · `@types/*` ·
`dotenv 17.3.1` (⚠️ dependency me hai par src me **kahin use nahi hota**).

---

## 14. Known gaps / stubs / risks

1. **`bin/yt-dlp` mode `644` hai (executable bit nahi).** Deploy pe `chmod +x` ya `YTDLP_PATH` set karna padega.
   5.4 MB binary git me committed hai — repo bloat.
2. **YouTube extraction = ToS gray area.** `googlevideo.com` URLs expire hote hain (isliye 403 retry + 90 min TTL),
   aur IP-bound hote hain (isliye server proxy). Extraction break hone pe app automatically iframe mode pe gir jata hai.
3. **Koi authentication nahi** — liked/playlist/downloads sab global. Multi-user deploy pe data mix ho jayega.
4. **Missing PWA icons** (section 9).
5. **Region & Language settings cosmetic hain** — `/api/search` `country` param padhta hi nahi;
   `/api/home` sirf cache key ke liye use karta hai, results same rehte hain.
6. **"Cast to device" aur "Car mode" buttons stub hain** — sirf toast dikhate hain, koi Chromecast/AirPlay/Android Auto code nahi.
7. **Explicit filter no-op hai** — yt-dlp flat search se explicit flag nahi aata, `toTrack()` hamesha `false` set karta hai.
8. **Download quality setting cosmetic hai** — hamesha `bestaudio` hi download hota hai, koi bitrate selection nahi.
9. Unused deps: `clsx`, `dotenv`. Package name abhi bhi `nextjs-postgresql-template`.
10. README effectively empty hai (UTF-16-ish garbage, sirf "Sidify-V2").

---

## 15. TL;DR stack list

```
Next.js 16 (App Router) · React 19 · TypeScript 5.9 (strict) · Node.js runtime
Tailwind CSS v4 (CSS-first) · next/font (Inter + Sora) · lucide-react · Framer Motion 13
Zustand 5 (persist) · TanStack React Query 5
PostgreSQL · Drizzle ORM 0.45 · pg 8.20 · drizzle-kit
yt-dlp (bundled binary, child_process) · youtubei.js 18 (Innertube ANDROID)
Web Audio API (dual-deck, 5-band biquad EQ, StereoPanner, crossfade)
YouTube IFrame Player API (hidden-harbor singleton)
Media Session API · IndexedDB (offline audio) · Service Worker (hand-written) · Web App Manifest (PWA)
ESLint 9 (flat) · PostCSS 8
```
