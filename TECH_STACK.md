# Sidify V2 — Complete Tech Stack

> Poora breakdown: music search kaise hota hai, playback kaise hota hai, UI kis cheez se bana hai,
> data kahan store hota hai, aur kaunsi cheezein stub/fake hain.
> Repo: `dastaanenajdik/Sidify-V2` · ~5,970 lines TS/TSX · 50 source files

---

## 1. One-line summary

Sidify ek **YouTube-powered music streaming PWA** hai. Isme Spotify/Apple/JioSaavn ka **koi official API nahi** hai —
search, metadata, artwork aur audio **sab YouTube se** aata hai, server-side **`youtubei.js` (InnerTube)** se.
Pehle ye `yt-dlp` CLI binary (`child_process.execFile`) se hota tha — wo **hata diya gaya hai** (file-permission
`644` aur datacenter-IP blocking ki wajah se cloud deploy pe fail hota tha).
Frontend Next.js 16 (App Router) + React 19 + Tailwind v4 + Zustand + React Query, audio playback **Web Audio API**
ke custom dual-deck graph se (real DSP: EQ, crossfade, pan), aur fallback ke roop mein **YouTube IFrame Player API**.

---

## 2. Core framework

| Layer | Technology | Version | Notes |
|---|---|---|---|
| Framework | **Next.js** (App Router) | `16.2.6` | `src/app` structure, Route Handlers as API |
| UI lib | **React / ReactDOM** | `19.2.6` | Client Components (`"use client"`) heavy |
| Language | **TypeScript** | `5.9.3` | `strict: true`, path alias `@/* -> ./src/*` |
| Runtime | **Node.js** | — | `export const runtime = "nodejs"` + `maxDuration = 60` har media route pe (`node:vm` decipher ke liye — Edge pe chalega hi nahi) |
| Package name | `nextjs-postgresql-template` | — | Starter template se banaya gaya, rename nahi hua |

Scripts: `dev`, `build`, `start`, `lint`, `typecheck`. **No test framework, no CI, no Dockerfile/vercel.json** repo mein.

---

## 3. Music Search — kaise kaam karta hai

### 3.1 Source: YouTube via `youtubei.js` (InnerTube) — server-side only

`src/lib/engine.ts` (session + fetching) aur `src/lib/parser.ts` (pure transforms). Client ko kabhi expose nahi hota.

**`yt-dlp` binary aur `src/lib/ytdlp.ts` dono repo se hata diye gaye hain** — ab koi child process, koi
on-disk binary, koi `chmod +x` requirement nahi. Sab kuch pure JS HTTP (InnerTube) hai.

**Custom JavaScript evaluator (`node:vm`)** — ye sabse zaroori hissa hai:
youtubei.js ka Node platform shim ek aisa `eval` register karta hai jo sirf **throw** karta hai
(*"you must provide your own JavaScript evaluator"*). Uske bina har `signatureCipher` / `n`-parameter
URL decipher nahi hota aur streaming 403 deta hai. Isliye session banane se **pehle**:

```ts
Platform.load({
  ...Platform.shim,
  eval: (data, env) => vm.runInNewContext(data.output, env, { timeout: 10_000 }),
});
```

`data.output` YouTube ke player script se nikla hua IIFE hai jo `{ sig, n }` return karta hai — `vm` ka
completion value wahi hai jo `Player.decipher()` aage padhta hai. `timeout: 10s` runaway script se bachata hai.
(⚠️ `node:vm` ek *stability* boundary hai, security sandbox nahi — isliye ye routes Node runtime pe hi chalte hain.)

**`youtubei.js` LAZY import hota hai (`await import()`), static nahi** — ye zaroori hai:
top-level `import { Innertube } from "youtubei.js"` package ko route module graph me kheench leta,
jisse `next build` ke "Collecting page data" phase me wo evaluate hota hai aur Vercel ki output
tracing ko iska conditional `exports` map build-time pe resolve karna padta hai — **isi se Vercel
deployment fail hui thi**. Lazy import se package build-time evaluation se bahar rehta hai
(wahi pattern jo pehle wala engine use karta tha), aur behaviour pe koi farq nahi padta:
singleton pehli request pe hi banta hai. Verify: scratch build me `youtubei.js` ko evaluate-time
pe throw karwane par lazy version **pass** hua, static version **"Failed to collect page data"** pe fail.

**Singleton session** (`getYT()`): `globalThis` pe cache (dev HMR safe) + in-flight creation promise,
taaki cold start pe duplicate player download na ho. Config: `cache: false`, `retrieve_player: true`,
`generate_session_locally: false`, `fail_fast: false`, `enable_session_cache: false`.

**Degraded-boot resilience:** `retrieve_player: true` fail hone par (base.js fetch nahi ho paya) session
dobara `retrieve_player: false` ke saath banta hai. Search/metadata ko player ki zaroorat hoti hi nahi —
sirf deciphering ko. Isse catalogue chalta rehta hai aur playback gracefully IFrame engine pe gir jata hai,
bajaye iske ki pura app 502 de. (`isEngineDegraded()` flag isi ko track karta hai.) Session bootstrap pe
20 s hard timeout bhi hai.

**Search:** `yt.music.search(query)` / `yt.music.search(query, { type: 'song' | 'album' | 'artist' })`
→ internally `client: 'YTMUSIC'` force hota hai.
**Plain YouTube fallback:** `yt.search(query, { type: 'video' })` — agar Music search khali/fail ho,
taaki search screen kabhi blank na rahe.

### 3.2 Nested response parsing — `flattenShelves()`

YouTube Music ka response shelves me nested hota hai (`Search.contents` → `MusicShelf | MusicCardShelf |
ItemSection` → `MusicResponsiveListItem`). Library ke apne `Search.songs` / `.albums` / `.artists` getters
shelf ko uske **English title string** se dhundhte hain — kisi bhi doosre locale pe chupchap `undefined`
return kar dete hain.

Isliye `flattenShelves()` pura tree walk karta hai (depth-capped, cycle-safe via `WeakSet`) aur har leaf ko
uske **id shape** se classify karta hai — locale-independent:

| Id shape | Bucket |
|---|---|
| 11-char `[A-Za-z0-9_-]{11}` | **Track** (playable videoId) |
| `MPR…` / `MPREb…` / `OLAK5uy…` | **Album** (real YouTube Music album) |
| `UC…` | **Artist** (channel) |

`classifyItems()` **two-pass** hai: pehle real Albums/Artists shelves (jinke paas proper square artwork aur
canonical naam hota hai), phir tracks — aur songs se artists tabhi backfill hote hain jab real artist shelf
na aaya ho. Iske alada `seenTrack` dedupe us common case ko handle karta hai jab ek hi recording "Songs"
(ATV) aur "Videos" (UGC/OMV) dono shelves me aati hai.

**Metadata merge:** YouTube ek hi track ko kai shelves me repeat karta hai aur har copy me *alag* amount me
metadata hota hai (top-result `MusicCardShelf` aksar album chhod deta hai). Isliye "first wins" ki jagah
baad wali sighting se missing fields (album, artistId, duration, thumbnail, year) **merge** kiye jate hain.

### 3.2b "Albums" aur "Artists" — actually kya hain

- **Albums ab REAL ho sakte hain.** YouTube Music album ids (`MPR…`, `OLAK5uy…`, `MPREb…`) `music.getAlbum()`
  se apni asli tracklist dete hain (header se title/artist/artwork + `contents` se tracks).
- **Pseudo albums abhi bhi support hain** (backward compatible): search query ko JSON me pack karke
  `base64url` → `ytq-<…>`. Home shelves, artist shelves aur purane links isi pe chalte hain. Album route
  dono handle karta hai — real id ho to `music.getAlbum()`, `ytq-` ho to grouped search
  (fallback chain: full query → title → `{artist} best songs`).
- **Artists = YouTube channels** (`UC…`). Artist page pehle `music.getArtist()` try karta hai (sabse rich
  music-first data), phir `getChannel()` (videos tab), phir naam se search. `@handle` support bhi hai.
- **Artwork:** songs ke liye jaan-boojh kar `https://i.ytimg.com/vi/{id}/maxresdefault.jpg` hi use hota hai —
  kyunki client pe pehle se `maxres → sd → hq → mq → default → /icon.png` fallback chain aur Media Session
  artwork list inhi URLs pe wired hai. Albums/artists ke liye YouTube Music ka square art use hota hai,
  jiska `lh3.googleusercontent.com` size suffix `=w600-h600-l90-rj` pe normalize kiya jata hai (sharper cards).

### 3.3 Caching (bahut important — har InnerTube call ek network round-trip hai)

| Cache | TTL |
|---|---|
| Search results (in-memory `Map`) | 10 min |
| Channel/artist | 30 min |
| Resolved audio URL | 90 min (negative/fail = 60 sec) |
| Album tracklist | 30 min |
| Home page payload | 10 min (per country) |
| HTTP header on `/api/search` | `public, s-maxage=300, stale-while-revalidate=600` |

Plus **in-flight dedupe** — same query ke 10 parallel requests pe InnerTube call ek hi baar hota hai.

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
- Explicit filter client-side toggle (note: InnerTube search se `explicit` flag reliably nahi milta, `toTrack()` `false` set karta hai)

---

## 4. Playback — dual-engine architecture

`src/lib/audioEngine.ts` (804 lines, sabse bada file) + `src/lib/ytPlayer.ts` + `src/app/api/stream/route.ts`.

Do modes hain, automatically choose hote hain:

### 4.1 Audio URL resolution chain (server)

`resolveAudio(videoId)` — `src/lib/engine.ts`:

```
getBasicInfo(client=ANDROID) → TV_SIMPLY → YTMUSIC_ANDROID → MWEB → WEB
```
ANDROID/TV_SIMPLY pehle, kyunki ye usually pre-signed URLs dete hain jinhe `po_token` / BotGuard chahiye
hi nahi hota; WEB progressively strict hai.

Har client pe:
1. `playability_status.status` check (`OK` ke alawa → skip; `LOGIN_REQUIRED`/age-restricted → null)
2. `info.chooseFormat({ type: 'audio', quality: 'best' })` — spec path. Default `format: 'mp4'` ki wajah se
   ye **AAC/m4a** chunta hai, jo `<audio>` + Web Audio ke liye sabse compatible container hai.
3. Agar `chooseFormat` throw kare (koi matching format nahi) → manual fallback:
   `streaming_data.formats + adaptive_formats` me se audio-only (`has_audio && !has_video`),
   **non-OTF pehle** (on-the-fly formats ko scrub karne ke liye explicit range juggling chahiye),
   phir highest bitrate.
4. `format.url` pehle se deciphered hota hai zyada-tar clients pe; na ho to
   `await format.decipher(yt.session.player)` — **yahin custom `node:vm` evaluator kaam aata hai**.

Sab clients fail ho jayein aur engine degraded mode me na ho → `resetYT()` se session rebuild karke
fast clients dobara try (stale visitor-data / rotated player script recovery). Degraded mode me ye skip
hota hai (player hi nahi hai, rebuild se kuch nahi hoga) — client seedha IFrame pe gir jata hai.

### 4.2 `/api/stream` — proxy (do modes ek hi endpoint pe)

```
GET /api/stream?video_id={id}          → JSON metadata {title, artist, thumbnail, duration, audio_url}
GET /api/stream?video_id={id}&play=1   → actual audio BYTES (proxied)
```
Proxy kyun? YouTube ke `googlevideo.com` URLs **CORS + IP-bound** hote hain. Server unhe fetch karke
same-origin pe re-serve karta hai, **`Range` header passthrough** ke saath (seeking/scrubbing ke liye zaroori),
aur `content-type/length/range/accept-ranges` copy karta hai (default format ke `mime_type`, warna `audio/mp4`,
plus `cache-control: no-store`). Upstream `403/410` (URL expire) → `resolveAudio(id, skipCache=true)` se
re-resolve + retry.

Range absent ho to jaan-boojh kar `bytes=0-` **nahi** bheja jata: full `200` response asli `Content-Length`
lata hai, aur browser usi se seek-bar ke liye `duration` nikalta hai.

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

## 5. Downloads / Offline — ⏸ temporarily disabled ("Coming Soon")

Downloads abhi **gate** kar diye gaye hain. `src/lib/library.tsx` me ek single flag hai:

```ts
export const DOWNLOADS_ENABLED = false;   // flip to true to restore
```

`downloadTrackFlow()` chaaron download affordances ka **single funnel** hai — `TrackRow` (track list),
`TrackMenu` (context menu), `FullPlayer` (player controls), aur auto-download-on-like. Gate isi function me
lagaya gaya hai, isliye **koi UI file, icon ya layout touch nahi hua** — click pe sirf toast aata hai:

> **"Download feature is coming soon! 🚀"**

- Auto-download-on-like `{ silent: true }` ke saath call hota hai, taaki har like pe toast spam na ho.
- Heavy IndexedDB blob-streaming path ab execute hi nahi hota (dead-but-intact — flag flip karte hi wapas).
- Jo tracks pehle se downloaded hain unka **offline playback abhi bhi chalta hai**: `offlineDb.ts` ke reads
  aur `audioEngine.chooseMode()` ka `downloadedIds` → `offlineObjectUrl()` → native deck path untouched hai.
- Downloads page pe purane rows ki delete/clear bhi kaam karta hai (`removeDownloadEverywhere`, `clearAllDownloads`).
- `/api/downloads` GET/DELETE intact hai; POST ab client se call hi nahi hota.

## 6. Lyrics — static + synced (LRC)

**Flow:** UI → `GET /api/lyrics?title&artist&duration` → `src/lib/lyrics.ts` → **LRCLIB** (primary) → **lyrics.ovh** (fallback).
Koi HTML scraping nahi, sirf bounded JSON APIs. DB touch hi nahi hota.

### 6.1 Query taiyaari

- `cleanTitle()` YouTube title se noise hatata hai: `(Official Video)`, `[Remaster]`, `Lyrics`, `Visualizer`, `4K/HD/HQ`,
  trailing `-`/`|`. `queryVariants()` max **4 variants** banata hai — `{title, artist}`, dash-split ka ulta
  (`"Arijit Singh - Tum Hi Ho"` → `{title:"Tum Hi Ho", artist:"Arijit Singh"}`), sirf pehla hissa, aur
  `(from "…")` film-tag hata ke. `- Topic` / `VEVO` suffixes bhi strip.
- Sabhi variants ke requests **parallel** jate hain, har ek pe `AbortSignal.timeout(4000)` — total lookup bounded rehta hai.

### 6.2 Teen-tier matching

1. **Exact** — `lrclib.net/api/get?track_name&artist_name[&duration]`.
2. **Search + ranking** — `lrclib.net/api/search?track_name` (sirf title), kyunki YouTube aksar *label* ko artist batata hai
   (`T-Series`, `Zee Music`). Har hit score hota hai: **artist match +4**, **duration ±5 s +2**. Safety lock — top score 0 ho
   aur ek se zyada alag artist hon to `null` (galat gaane ke lyrics dikhane se behtar kuch na dikhana).
3. **Fallback** — `api.lyrics.ovh/v1/{artist}/{title}` (sirf plain text, isliye `lines: []`).

**Miss vs outage alag hain:** genuine miss → `404` + "not found"; provider 5xx/network → `LyricsUnavailableError` → `503` +
"temporarily unavailable, retry" (`Cache-Control: no-store`). `instrumental: true` apna message deta hai, "not found" nahi.

### 6.3 LRC parsing — `parseLrc()`

LRCLIB `plainLyrics` **aur** `syncedLyrics` dono deta hai; synced LRC format me hota hai (`[mm:ss.xx]line`). Pehle ye
timestamps regex se phenk diye jate the — ab parse hote hain:

- `LyricLine { startMs, text }[]`, `startMs` pe sorted.
- Ek line pe **multiple stamps** (`[00:16.10][01:02.80]Chorus`) → repeated chorus ke liye alag-alag entries.
- Fraction precision handle: `[00:16.1]` = tenths, `.16` = hundredths, `.161` = millis; `[00:16]` = whole second.
- `[offset:±ms]` metadata apply hota hai (clamp at 0), baaki meta tags (`[ar:]`, `[ti:]`, `[al:]`, `[by:]`, …) skip.
- **Enhanced LRC (A2)** ke inline word markers `<00:12.43>` strip ho jate hain — ye build **line-level** sync karta hai,
  word-level nahi.
- `usableSync()` ko ≥2 stamps chahiye (ek > 0 pe) — warna stray `[00:00.00]` intro marker se "synced" on ho jata
  aur poora gaana ek hi line pe atka dikhta.
- `lyrics` (copy-friendly text) = `plainLyrics` prefer, warna timed lines se rebuild — synced-only payload pe bhi Copy kaam karta hai.

### 6.4 API response

`{ success, lyrics, lines: [{startMs, text}], synced, source, instrumental? }` — `lines` max 1200 entries,
text 500 chars pe capped. Hit pe `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`; failure pe `no-store`.

### 6.5 Client — media clock (`src/lib/lyricsClock.ts` + `lyricsClient.ts`)

Engine `positionMs` sirf har **~220 ms (native) / ~240 ms (iframe)** likhta hai — line highlight ke liye bahut coarse.

- `useSmoothPosition()` store updates ke beech `performance.now()` + `speed` se **60 fps** extrapolate karta hai, aur
  snap-back karta hai jab clock engine se `RESYNC_THRESHOLD_MS = 900` ms se zyada door ho (seek / crossfade / buffering /
  track change) ya playback paused ho.
- `advanceMediaClock()` ek frame ka delta **500 ms pe clamp** karta hai — background tab me rAF ~1 Hz pe throttle hota hai,
  warna tab kholte hi lyrics aage nikal jate.
- Dono pure functions hain aur framework-free module me rehte hain → `tests/lyricsClock.test.cjs` bina DOM ke unit test karta hai.
- Speed 0.5x–2x automatic sahi chalti hai: LRC time **media time** hai, wall time nahi.

### 6.6 Rendering — `src/components/LyricsView.tsx`

- `activeLineIndex()` **binary search** se current line nikalta hai; position ~**12 Hz** pe quantise hota hai
  (`Math.round(ms / 80)`) taaki React har frame re-render na kare — visual smoothness CSS transitions se aati hai.
- `.synced-line[data-state="past"|"active"|"next"]` (`globals.css`): past 20 % opacity, current accent + glow + `scale(1.035)`,
  next 34 %. `prefers-reduced-motion` pe transitions/transform hat jate hain.
- **Auto-follow** current line ko center karta hai (`scroll-behavior: smooth`; >600 px jump pe instant snap). User wheel/touch
  se scroll kare to follow pause ho jata hai aur **"Current line"** pill aata hai; agli line change pe follow apne aap resume.
- Kisi bhi line pe **click → `seekTo(line.startMs)`** — dono engines (native `<audio>` aur YouTube IFrame) me kaam karta hai.
- **Static ⇄ Synced** toggle panel ke *top* pe segmented control hai (`LyricsModeToggle`). Default **static**; timestamps na
  hone pe Synced disabled (title me reason). Neeche footer me chhota **Copy** button + source credit.
- Library → **Lyrics Finder** tab wahi components use karta hai: bina kuch play kiye lookup, copy, aur
  "Use the playing song" se live follow (neeche prev/next-line transport strip ke saath).

### 6.7 Tests + local mock

`tests/lyrics.test.cjs` (provider tiers, matching, LRC) · `tests/lyricsClock.test.cjs` (clock maths) ·
`tests/clipboard.test.cjs`. Run: `node --test tests/*.test.cjs`.

Local dev me public providers tak pahunch na ho to `node tools/mock-lrclib.mjs` (port 8099) +
`LRCLIB_BASE=http://127.0.0.1:8099` (`.env.local`) — production me koi env zaroori nahi, defaults public endpoints hain.
`/dev/lyrics-sync` ek **dev-only playground** hai jo player store ki clock ko timer se drive karke synced view dikhata hai
(stream ke bina); app shell me iska koi link nahi.

### 6.8 Known limits

- Sync **line-level** hai. Word-by-word karaoke (Spotify ka exact behaviour) ke liye provider se `<mm:ss.xx>` word markers
  chahiye — LRCLIB pe coverage bahut patli hai. Agla step interpolation ho sakta hai (line ke start/end ke beech syllable
  weight se word timings estimate); drift har line pe reset hota hai kyunki anchor LRC stamp hi rehta hai.
- Jo tracks sirf `plainLyrics` dete hain (kai Hindi/regional) unpe Synced toggle disabled rehta hai — graceful static fallback.
- iframe mode me YouTube ka `getTime()` laggy hai; 900 ms resync window isi ko absorb karti hai.

---

## 7. Database

| Item | Detail |
|---|---|
| DB | **PostgreSQL** |
| ORM | **Drizzle ORM** `0.45.2` (`drizzle-orm/node-postgres`) |
| Driver | **pg** `8.20.0` — `Pool` **lazily** banta hai (pehli query pe), dev me `globalThis` cache (HMR safe) |
| Migrations | **drizzle-kit** `0.31.10`, `drizzle.config.json` |
| Env | `DATABASE_URL` runtime pe required — **par build pe nahi** (lazy init, neeche dekhen) |

**DB handle LAZY initialize hota hai** (`src/db/index.ts`) — ye build ke liye zaroori hai:
`Pool`/Drizzle instance **pehli actual query** pe banta hai, import pe nahi. Pehle module top-level
pe `DATABASE_URL` na milne par throw hota tha, aur kyunki `next build` apne *"Collecting page data"*
phase me **har route module import** karta hai (`/api/downloads` → `@/db`), koi bhi build us
environment me fail ho jata tha jahan ye secret set na ho (Vercel **Preview** deployments, CI, fresh
clone):

```
Error: DATABASE_URL is required
Build error occurred
Error: Failed to collect page data for /api/downloads
```

Ab build environment-independent hai. Runtime behaviour same — wahi `DATABASE_URL is required`
error, bas boot pe nahi balki pehli use pe. Saare call sites **untouched**: `db` aur `pool` ab
**Proxy** hain jo property access pe real object resolve karte hain, isliye `db.select()/.insert()/
.delete()/.execute()` aur `pool.query()` pehle jaise hi kaam karte hain (methods bind ho jate hain).

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

## 8. State management

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

## 9. UI / Design system

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

## 10. PWA

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

✅ **Icons fixed (v1.2):** manifest + layout jin 5 PNGs ko reference karte the, wo `public/` me nahi thi
(SW ka `cache.addAll` fail hota tha aur **Chrome ka Install prompt disabled rehta tha** — "This app cannot be
installed"). Ab sab present hain aur `tools/gen-icons.mjs` se regenerate ho jate hain:

| File | Size | Purpose |
|---|---|---|
| `public/icon.png` | 512 | favicon / artwork fallback (layout + `Providers` thumbnail fallback) |
| `public/icon-192.png` · `icon-512.png` | 192 · 512 | `purpose: "any"` |
| `public/icon-maskable-192.png` · `icon-maskable-512.png` | 192 · 512 | `purpose: "maskable"` — mark 40 % safe-circle ke andar, background full-bleed |
| `public/favicon.ico` | 32 + 16 | classic tab icon (ImageMagick se derive, script comment me command) |

Generator khud brand mark banata hai (neon `S` + teen equalizer bars, accent `#00E676`, bg `#14141f → #050509`)
— `@resvg/resvg-js` sirf generator ke liye chahiye (`npm i --no-save @resvg/resvg-js`), project dependency nahi,
isliye normal `npm ci && next build` me rasterizer ki zaroorat nahi padti. PNGs committed hain.

**Manifest (v1.2):** explicit `id`/`start_url`/`scope` = `/`, `launch_handler.client_mode: ["focus-existing","auto"]`
(icon se dobara launch karne pe naya window nahi, wahi app focus hota hai — warna do instance do gaane), aur do
`shortcuts` (Search, Library) jo long-press pe milte hain. SW cache names `v3` pe bump, taaki purane clients
naya shell + asli icons refetch karein.

---

## 11. API surface (Next.js Route Handlers)

| Endpoint | Method | Kaam |
|---|---|---|
| `/api/search?q&type&limit` | GET | `yt.music.search` → `{songs, albums, artists, items, results}` |
| `/api/stream?video_id[&play=1]` | GET | metadata JSON **ya** proxied audio bytes (Range support) |
| `/api/home?country` | GET | trending / new releases / top artists / recommended / recently played (DB down ho to bhi 200) |
| `/api/artist/[id]` | GET | `music.getArtist` → `getChannel` → search: artist profile + songs + 3 shelves |
| `/api/album/[id]` | GET | real `MPR…`/`OLAK5uy…` → `music.getAlbum`; `ytq-…` → search-based tracklist |
| `/api/library/liked` | GET/POST/DELETE | liked songs |
| `/api/library/recent` | GET/POST/DELETE | recently played |
| `/api/library/followed` | GET/POST/DELETE | followed artists |
| `/api/library/blocked` | GET/POST/DELETE | blocked artists |
| `/api/library/restore` | POST | bulk backup restore |
| `/api/playlists`, `/api/playlists/[id]` | GET/POST/PATCH/DELETE | playlists + tracks (reorder, rename) |
| `/api/downloads` | GET/POST/DELETE | download metadata |
| `/api/lyrics?title&artist[&duration]` | GET | LRCLIB → lyrics.ovh: `{lyrics, lines[], synced, source, instrumental?}` (1 h CDN cache) |
| `/api/health` | GET | `select 1` DB ping |

## 12. Pages

`/` (Home) · `/search` · `/library` (Liked / Playlists / Artists / History / **Lyrics Finder**, `?tab=lyrics`) · `/downloads` · `/settings` · `/album/[id]` · `/artist/[id]` · `/playlist/[id]`

Dev-only (app shell me link nahi): `/dev/lyrics-sync` — synced-lyrics playground, simulated transport clock.

## 13. Components (sab hand-rolled)

`Providers` (QueryClient + ThemeApplier + EngineBootstrap + PlatformBootstrap + DataSync) · `Sidebar` (+`MobileNav`) ·
`MiniPlayer` · `FullPlayer` (queue Reorder, EQ panel, speed, sleep, video mode, lyrics panel) · `SeekBar` ·
`LyricsView` (+`LyricsModeToggle`) · `CopyLyricsButton` · `TrackRow` · `TrackMenu` · `cards` (AlbumCard/ArtistCard) ·
`controls` (PlayButton/Toggle) · `Modals` (AddToPlaylist + SleepTimer) · `Toasts` · `Section` · `SidifyLogo` (+`LiveEq`)

---

## 14. Tooling & dev deps

ESLint `9.39.4` (flat config) + `eslint-config-next/core-web-vitals` · `drizzle-kit` · `@types/*` ·
`dotenv 17.3.1` (⚠️ dependency me hai par src me **kahin use nahi hota**).

---

## 15. Known gaps / stubs / risks

1. ~~`bin/yt-dlp` executable nahi tha~~ — **resolved**: yt-dlp dependency hi hata di gayi. Ab sirf
   `youtubei.js` chahiye; koi binary, koi `chmod`, koi `YTDLP_PATH`. Repo ~5.4 MB halka ho gaya.
2. **YouTube extraction = ToS gray area.** `googlevideo.com` URLs expire hote hain (isliye 403/410 retry +
   90 min TTL) aur IP-bound hote hain (isliye server proxy). InnerTube client contracts YouTube kabhi bhi
   badal sakta hai — isliye multi-client chain + degraded boot + IFrame fallback teeno layers rakhe gaye hain.
3. **Datacenter IP blocking abhi bhi possible hai.** yt-dlp-specific block hat gaya, par InnerTube bhi
   `po_token`/BotGuard maang sakta hai (khaas kar WEB client pe). ANDROID/TV_SIMPLY pehle try hote hain;
   sab fail ho to app automatically IFrame mode me chala jata hai (music chalta rehta hai).
4. **Koi authentication nahi** — liked/playlist/downloads sab global. Multi-user deploy pe data mix ho jayega.
5. **Missing PWA icons** — manifest 5 icons reference karta hai, `public/` me sirf `manifest.json` + `sw.js` hain.
6. **Region & Language settings cosmetic hain** — `/api/search` `country` param padhta hi nahi;
   `/api/home` sirf cache key ke liye use karta hai. (Ab chaaho to `Innertube.create({ location })` se wire ho sakta hai.)
7. **"Cast to device" aur "Car mode" buttons stub hain** — sirf toast, koi Chromecast/AirPlay/Android Auto code nahi.
8. **Explicit filter no-op hai** — InnerTube search se reliable explicit flag nahi milta.
9. **Download quality setting cosmetic hai** — downloads abhi gated hain; re-enable karne pe bhi `chooseFormat`
   hamesha best audio leta hai, bitrate selection nahi.
10. **`node:vm` security sandbox nahi hai.** Evaluate hone wala script YouTube ka player code hai (TLS se aata hai)
    aur `timeout` guard hai — par ise isolation mat samajhna. Isliye ye routes Edge pe nahi, sirf Node runtime pe chalte hain.
11. Unused deps: `clsx`, `dotenv`. Package name abhi bhi `nextjs-postgresql-template`.
12. README effectively empty hai.

---

## 15.5 Update 1.0 (14 Sept 2026) — playback + library fixes

Koi naya UI element ya backend route add nahi kiya gaya — sab fixes client layer me hain.

**Playback (`src/lib/audioEngine.ts`, `src/lib/ytPlayer.ts`)**
1. **First click never played** — do wajah:
   - `ytController` `new YT.Player()` ke turant baad `loadVideoById()` bhej deta tha, lekin
     YouTube IFrame API **`onReady` se pehle aaye hue har command ko discard** kar deta hai.
     Ab ek bounded `whenReady()` gate hai (`ready` flag + pending-request queue + `reqId` cancellation).
   - `probeNative()` (24 s timeout wala `/api/stream` lookup) await hone tak playback atka rehta tha.
     Ab probe **2.5 s** ke baad race se haar maan kar iframe pe start ho jata hai, aur verdict
     background me cache ho jata hai — agle track se native chalega.
   - Bonus: pehle user gesture pe `unlockEngine()` AudioContext resume + YT player warm-up
     **synchronously** karta hai (gesture ke andar hi), isliye browser ka autoplay-lock todta hai.
2. **Song khatam → next auto-play nahi hota tha**
   - `fading` kabhi `true` pe atak jata tha (`startCrossfade` ka stale-`seq` early-return) →
     uske baad `next()`/`prev()`/autoplay hamesha `return` ho jate the. Ab har `playIndex()`
     `fading` reset karta hai aur crossfade timer clear karta hai.
   - Queue ke end pe `appendSimilar()` ab **manual + auto dono** next pe chalti hai (autoplay ON ho),
     aur artist / title / album / context-label — kai seeds try karti hai.
   - Ek 2.5 s **watchdog** player ki asli state check karta hai (hidden tab me `ended` event
     miss ho jata hai, rAF suspend ho jata hai) → queue aage badhti rehti hai.
   - `handleEnded()` ek `endingBusy` guard se reentrancy-safe hai (double-skip nahi hoga).
3. Track error pe session khatam nahi hota: skip + similar songs append, limit 4 → 8.

**Library (`src/lib/localLibrary.ts` + `src/lib/clientApi.ts`) — likes / playlists / history**
`/api/library/*` aur `/api/playlists` Postgres pe jate hain. `DATABASE_URL` na ho, tables na hon,
ya 5xx aaye to **har write chup-chaap kho jata tha** (heart, playlist create, add-to-playlist, history).
Ab ek local-first store hai:
- har write pehle `localStorage["sidify-local-library"]` me jaata hai, phir best-effort server pe mirror;
- reads **server ∪ local** merge karte hain (track id pe dedupe, unlike/removal tombstones ke saath);
- local playlists **negative ids** use karte hain, isliye server ke serial ids se kabhi collide nahi karte;
- server ke playlist me offline kiye gaye adds `extras[playlistId]` me park hote hain aur read pe fold ho jate hain;
- API fail hone ke baad 20 s ka cooldown hai (har interaction me dead round-trip na lage), phir apne-aap retry.
Backend healthy ho to behaviour pehle jaisa hi hai — koi duplicate nahi, koi UI change nahi.

**History live-refresh:** `recordRecent()` ab 30 s window ke baad same track dobara record karta hai
(earlier: session me ek hi baar) aur `emitRefresh("recent")` bus pe broadcast karta hai →
Library → History tab aur `["liked"]`/`["playlists"]`/`["playlist"]` queries live update hote hain.

**Add-to-playlist modal (`src/components/Modals.tsx`):** playlist list se add, inline "New playlist"
create + usi me add (raw fetch hack hata diya, ab React Query invalidation), already-added check
(✓ icon), busy/disabled state aur error toasts.

**Notices (`src/components/UpdatePopups.tsx`):** site khulte hi (per browser session) pehle
**Update notice — Minor update 1.0 · 14 Sept 2026** (top-right cross se dismiss), phir
**"Instructions to play in background or off screen"** — 5 s tak close button nahi aata,
uske baad cross aata hai. Wahi guide Settings → System & Device Controls →
**"Instructions to play background"** se dobara khulta hai (`useUi.bgHelpOpen`).

**PWA:** `public/sw.js` cache names v1 → v2 (purana shell/chunks is release ke baad serve na hon).

---

## 15.6 Update 1.1 (26 Sept 2026) — synced lyrics + Lyrics Finder

**Backend (`src/lib/lyrics.ts`, `src/app/api/lyrics/route.ts`)**
- LRCLIB ke `syncedLyrics` ab **discard nahi hote**: `parseLrc()` unhe `LyricLine[]` banata hai (multi-stamp lines,
  `[offset:]`, meta tags, enhanced-LRC word markers, 1/10/100/1000-ms fractions). `usableSync()` ≥2 stamps maangta hai.
- Response me `lines` + `synced` add hua (1200 lines / 500 chars capped). `lyrics` (plain text) pehle jaisa hi hai, isliye
  Copy behaviour unchanged. Provider roots `providerBase()` se aate hain — `LRCLIB_BASE` / `LYRICS_OVH_BASE` se override
  (local testing), production me zero config.

**Player (`FullPlayer.tsx` → `LyricsView.tsx`)**
- Lyrics panel me upar **Static | Synced** segmented toggle; default static. Synced me current line accent + glow ke saath
  light up hoti hai, past lines dim, auto-scroll center pe follow karta hai (user scroll kare to pause + "Current line" pill).
- Line pe click → `seekTo()`. Copy button **top se hata ke bottom** me chhote pill me chala gaya.
- `useSmoothPosition()` engine ke 220–240 ms ticks ko 60 fps media clock me badalta hai (speed-aware, seek/pause pe resync,
  500 ms frame clamp) — maths `src/lib/lyricsClock.ts` me pure hai.

**Library (`src/app/library/page.tsx`)**
- Naya **Lyrics Finder** tab (`/library?tab=lyrics`): song (+ optional singer) likho → lyrics, Copy button, Static/Synced
  toggle. "Use the playing song" se current track ke lyrics live follow hote hain (prev/next-line strip ke saath).

**Dev / tests**
- `tools/mock-lrclib.mjs` — offline fixture provider (3 tracks: synced, plain-only, instrumental).
- `/dev/lyrics-sync` — simulated-clock playground; `tests/lyricsClock.test.cjs` (6 tests) + `tests/lyrics.test.cjs` me
  12 naye LRC/synced tests. Total 30 pass.

## 15.7 Update 1.2 (26 Sept 2026) — installable PWA + Back button

**Report:** "Chrome me Install disabled hai (This app cannot be installed), sirf Create shortcut milta hai —
aur usme gana back dabate hi band ho jata hai (video mode ON hone par bhi)."

**Diagnosis — do alag problems thi:**

1. **Install disabled → icons.** Manifest ke 5 PNGs `public/` me hi nahi the (upar section 10 dekho). Chrome
   install tab hi offer karta hai jab 192 px + 512 px icon **actually fetch** ho jayein. Icon 404 = install path
   dead, sirf "Create shortcut" (plain bookmark) bachta hai.
2. **Back = music band → page unload, Web Audio nahi.** Video mode me bhi band hota tha, isliye shak
   Web Audio suspension (`createMediaElementSource` wala mobile bug) se hat gaya: full player ek **overlay**
   hai, apna route/history entry nahi. Android Back → browser ka back → page chhoot jata hai → tab close/unload
   → audio bhi gaya. "Create shortcut" isko aur bura karta hai: wo Chrome ka tab hai, app task nahi.

**Fix — `src/components/BackGuard.tsx` (Providers me mount):**

- Player khulta hai → ek history entry park hoti hai (`history.pushState({...history.state, sidifyPlayer:true})`;
  Next.js ka apna state copy karke, warna router us entry ko foreign maanta hai).
- **Back #1 = player band**, gaana chalta rehta hai, app me hi rehte ho. **Back #2 = normal navigation.**
- Player UI se band kiya (swipe/close) → parked entry `history.back()` se wapas browser ko de di jati hai,
  taaki user ka agla Back ek khaali press na bane.

**Ab bhi faasla (honest limits):** mini-player pe ho, root page pe ho aur Back dabao → page phir bhi chhoot
sakta hai. Install kiye hue **WebAPK/TWA** me tab background me zinda rehta hai isliye playback chalta rehta hai;
Chrome ke plain tab/shortcut me tab close hone pe audio rukega. Recents se app swipe karke hatana = tab close =
audio band — ye sirf native player (ExoPlayer + foreground service, IfallMusic) hi handle kar sakta hai.
`/api/stream` wala native deck bhi isi wajah se background me Web Audio suspend hone ka risk rakhta hai, isliye
"background handoff" (DSP graph → plain `<audio>`) agli release ka candidate hai — abhi ke evidence me video
(iframe) mode bhi fail tha, to pehle page-unload fix kiya gaya.

## 15.8 Update 1.3 (26 Sept 2026) — BackGuard v2: double-Back-to-exit while playing

**Report:** "Mini-player pe (ya root page pe) Back dabate hi app band ho jata hai aur gaana ruk jata hai."
§15.7 ka guard sirf full-player overlay ko bachata tha — neeche mini-player pe Back phir bhi page
unload kar deta tha.

**Fix — `src/components/BackGuard.tsx` + naya `src/lib/backGuard.ts` (pure logic):**

- Gaana loaded + playing/buffering ho to ek history **sentinel entry** park rehti hai
  (`history.pushState({...history.state, sidifyGuard: true})` — Next ka state copy karke, v1 jaisa).
- **Back #1 = absorb:** sentinel wapas park + toast *"Press Back again to exit / Music is playing"*.
  **Back #2 (2.5 s ke andar) = exit allow:** guard hat jata hai, asli Back chalta hai.
  Window nikal jaye to agla Back phir Back #1 banta hai (naya cycle).
- **Normal in-app navigation untouched:** sentinel sirf *same-URL* pop pe absorb karta hai.
  URL badalne wala har Back (asli navigation) hamesha allow — pre-pop URL `pushState`/
  `replaceState` observe karke track hota hai. Buried sentinel (navigate karne ke baad neeche
  dabi entry) pe land karna bhi navigation hai → allow.
- **Paused / khaali-queue state untouched:** guard `hasTrack && (isPlaying || isLoading)` pe hi
  arm hota hai. Pause karte hi top sentinel wapas le liya jata hai (`history.back()`), Back
  bilkul normal rehta hai. Buffering (`isLoading`) me guard ON rehta hai taaki track-change
  ke beech Back se app na chhoote.
- **Player overlay ko priority:** player khula ho to har Back player-close hai (v1 behaviour,
  unchanged). Sentinel park player ke band hone tak defer hota hai; band hote hi heal ho jata hai.
- `router.replace` (search `?q=` typing) top entry ko clobber na kare, isliye `replaceState`
  hamare flags preserve karta hai — Next ke behaviour me koi change nahi.
- Apne programmatic `history.back()` calls pass-flags (`consumePass`/`exitPass`) se mark hote
  hain taaki handler unhe dobara absorb na kare; player flag re-push pe scrub hota hai.

**Files:** `src/lib/backGuard.ts` (pure: `isPlaybackGuardActive`, `decideBackAction`,
`shouldParkSentinel`, `shouldConsumeSentinel`, `BACK_EXIT_WINDOW_MS = 2500`),
`src/components/BackGuard.tsx` (wiring), `tests/backGuard.test.cjs` (18 tests).

**Ab bhi faasla (honest limits):** ye guard page-unload rokta hai, tab-kill nahi — Recents se app
swipe = tab close = audio band (sirf native player + foreground service fix kar sakta hai).
Gehre navigation stack me (play → kai pages navigate) dusra Back guard hata deta hai par buried
entries ki wajah se poora exit ek aur Back maang sakta hai; agla same-URL Back naya cycle shuru
karta hai. Chrome plain tab me exit ke baad audio rukega hi (WebAPK/TWA me background chalta hai).

## 16. TL;DR stack list

```
Next.js 16 (App Router) · React 19 · TypeScript 5.9 (strict) · Node.js runtime
Tailwind CSS v4 (CSS-first) · next/font (Inter + Sora) · lucide-react · Framer Motion 13
Zustand 5 (persist) · TanStack React Query 5
PostgreSQL · Drizzle ORM 0.45 · pg 8.20 · drizzle-kit
youtubei.js 18 (InnerTube) · custom node:vm decipher evaluator · Platform.load shim override
InnerTube clients: YTMUSIC (search) · ANDROID/TV_SIMPLY/YTMUSIC_ANDROID/MWEB/WEB (streaming)
Web Audio API (dual-deck, 5-band biquad EQ, StereoPanner, crossfade)
IndexedDB (offline audio — reads live, writes gated) · Downloads currently disabled ("coming soon")
YouTube IFrame Player API (hidden-harbor singleton)
Lyrics: LRCLIB (+lyrics.ovh fallback) · hand-rolled LRC parser · rAF media clock for line-synced highlighting
Media Session API · IndexedDB (offline audio) · Service Worker (hand-written) · Web App Manifest (PWA)
ESLint 9 (flat) · PostCSS 8
```
