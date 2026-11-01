# NetMirror Backend Research — saari requests kahan jati hain

> Date of live check: 2026-10-31. Ye research note hai, Sidify ka provider nahi hai.
> NetMirror ek unofficial/piracy streaming network hai. Is doc ka purpose sirf
> samajhna hai ki backend technically kaise kaam karta hai. Isko Sidify me
> integrate nahi kiya gaya hai aur legal/stable source ke roop me use nahi
> karna chahiye — domains monthly rotate hote hain, playback token IP-bound
> hai, aur content licensed nahi hai.

## 0. Ek line me pura system

```
App/Web khulta hai
  → mobiledetect*.app/.com  (check.php / checknewtv.php)  -- "aaj ka asli domain kaun sa hai?" (Base64 me jawab)
  → net52.cc (abhi ka live mirror, PHP site, Cloudflare ke peeche Apache origin)
  → verify flow (20s ad / verify2.php) → cookie t_hash_t  (session token)
  → search.php / post.php / episodes.php        -- catalog, detail, episodes (JSON)
  → imgcdn.kim                                   -- poster/backdrop/episode images
  → playlist.php  (JW Player format) ya newtv/player.php (TV app)
  → /hls/<id>.m3u8 ya /newtv/hls/<ott>/<id>.m3u8 -- HLS MASTER playlist
        ├─ video variants : s*.freecdn*.top/files/<id>/1080p|720p|480p/*.m3u8
        ├─ audio tracks    : s*.freecdn*.top/files/<id>/a/0, a/1, a/2 ... (har language alag)
        └─ subtitles       : subscdn.top / subs.nfmirrorcdn.top (WebVTT ya SRT)
  → video segments asal me MPEG-TS hain lekin naam .jpg / .js / .woff2 rakha gaya hai
```

Video NetMirror ke apne domain se **nahi** aata. NetMirror sirf catalog +
signed playlist deta hai; asli bytes `freecdn*.top` / purane `nm-cdn*.top`
CDN hosts se aate hain, aur wo bhi tabhi jab request me sahi `Referer`
aur valid signed `in=` token ho.

## 1. `netmirror.world` kholkar kya mila (live status)

- DNS: `netmirror.world → 162.4.84.239` (yehi IP `net50.cc` ki bhi hai).
- Direct HTTPS/HTTP par server khali jawab / TLS reset deta hai (bot/geo
  gating lagta hai). Public scanner ke hisab se ye domain
  `301 → netmirror.global → netmirror.plus` par redirect hota hai, aur
  `netmirror.plus` par jo site khulti hai wo ek alag hi (MovieBox-style,
  `pbcdn.aoneroom.com` posters wali) clone hai — asli NetMirror backend
  wali site nahi hai.
- Matlab: **`netmirror.world` sirf ek front/redirect/parked domain hai.**
  Na wahan API hai, na video. Asli kaam hamesha rotating `netXX.cc`
  mirrors par hota hai — abhi ke live: `net52.cc` (app + mobile web),
  `net77.cc` (desktop, iska CDN purana/dead hai), purane report me
  `net50.cc`, `net27.cc`, `net22.cc` (ab DNS hi nahi hai) bhi mile.

## 2. Domain map — har request kahan jati hai

| Host | Kaam |
|---|---|
| `mobiledetect.app`, `mobiledetects.com`, `mobidetect.art/.cc/.click/...` (~24 decoy domains, Base64 me app ke andar chhupe) | **Bootstrap / remote config.** `check.php` (mobile app) aur `checknewtv.php` (TV app) Base64 me "aaj ka asli backend" batate hain. Ek domain takedown ho to app agla try karta hai. |
| `net52.cc` (aur rotating `netXX.cc`) | **Main PHP site + API.** Home, search, detail, playlist, HLS master, verify. Cloudflare ke peeche Apache origin (404 page me "Apache Server at net52.cc" saaf dikha). |
| `userver.net52.cc` | Ad-verify visit ping (`addhash` ke saath). |
| `tv.imgcdn.kim` | **TV app ka API backend** — `/newtv/*.php` (main, post, search, episodes, player, otp) aur `/newtv/hls/<ott>/<id>.m3u8`. |
| `imgcdn.kim` (+ `img.nfmirrorcdn.top`) | Poster/backdrop/episode-still images. |
| `s21.freecdn4.top`, `s20.freecdn1.top`, `s26.freecdn14.top`, ... (number rotate hota hai; purani generation `nm-cdn4/5/6/9.top` dead hai) | **Asli video + audio HLS segments.** |
| `subscdn.top`, `pv.subscdn.top`, `subs.nfmirrorcdn.top` | **Subtitles** — WebVTT (HLS ke andar) aur SRT files. |
| `streamtape.com/.net/.to`, `stape.fun`, `*.tapecontent.net` | **Download flow** — `net52.cc/streamtape.php` resolver scraped Streamtape HTML se signed download URL (`dlUrl`) nikalta hai. |
| `ssl.p.jwpcdn.com`, `entitlements.jwplayer.com` | Web player = **JW Player**. |
| `code.jquery.com`, `cdn.jsdelivr.net` | Site ki JS libraries. |
| `sstatic1.histats.com`, `whos.amung.us`, `widgets.amung.us`, ad-network ke rotating domains | Visitor counter / tracking / ads. Yahi is site ki kamai hai. |

## 3. Step-by-step request flow

### Step 0 — Bootstrap: "aaj ka domain kya hai?"
App hardcoded domain use nahi karta. Live check me
`mobiledetect.app/check.php` ne ye diya:

```json
{"token_hash":"aHR0cHM6Ly9uZXQ1Mi5jYy9tb2JpbGUvaG9tZT9hcHA9MQ==",
 "stape":"aHR0cHM6Ly9uZXQ1Mi5jYy9zdHJlYW10YXBlLnBocA==", "u":[...]}
```

Base64 decode = `https://net52.cc/mobile/home?app=1` aur
`https://net52.cc/streamtape.php`. TV app ke liye
`mobiledetects.com/checknewtv.php` → decode = `https://tv.imgcdn.kim`.
Operator jab chahe ye value badal kar saari installed apps ko naye
domain par bhej sakta hai, bina app update ke.

Android app khud kuch khaas nahi hai: React Native (Hermes) shell ke
andar ek hi WebView hai jo upar wala URL kholta hai. Uska User-Agent
`... /OS.Gatu v3.x` se end hota hai; TV app ka `... /OS.GatuNewTV v1.0`.

### Step 1 — Verify gate (yahi inka "DRM" hai)
Pehli baar home khulne par page me ek `data-addhash` value hoti hai.
Flow: `userver.<mirror>` par ad visit ping → ~20-25 second ka server
timer → `mobile/verify2.php` par polling → verified hone par server
`Set-Cookie: t_hash_t=<md5>::<md5>::<unixtime>::ni...` deta hai.
Desktop par yehi kaam `verify.php` karta hai. Cookies jo set hoti hain:
`t_hash_t` / `t_hash_p`, `addhash`, `hd=on`, `ott=<nf|pv|dp>`,
`user_token`. Token ~12-15 ghante me expire hota hai (teesra hissa
issue-time ka unix timestamp hai).

**Token nahi hai to kya hota hai:** catalog phir bhi dikhta hai, lekin
har video variant ek shared ~10 minute ke placeholder/abuse-warning
clip (`files/220884/...`) ki taraf points karta hai. Audio asli film
ka hi chalta rehta hai — matlab bina verify kiye aapko film *sunai*
degi, dikhegi promo clip. TV API me token ki jagah ek shared OTP step
hai (`otp.php`; bina token ke `player.php` `status:"otp"` deta hai —
live check me yahi mila).

### Step 2 — Catalog APIs (sab PHP, sab JSON, koi GraphQL/REST framework nahi)
Teeno client (desktop web, mobile web/app, TV app) ek jaisi PHP files
use karte hain, path alag hai:

| Kaam | Desktop | Mobile / App | TV (`tv.imgcdn.kim`) |
|---|---|---|---|
| Home | `/home` (HTML) | `/mobile/home?app=1` (HTML rows/trays) | `/newtv/main.php` (+ `navbar.php`, `ott.php`) |
| Search | `/search.php?s=<q>&t=<ts>` | `/mobile/search.php`, `/mobile/pv/search.php`, `/mobile/hs/search.php` | `/newtv/search.php?s=<q>` |
| Detail | `mini-modal-info.php?id=` (quick info) | `/mobile/[pv/\|hs/]post.php?id=&t=` | `/newtv/post.php?id=` |
| Episodes | — | `/mobile/[pv/\|hs/]episodes.php?s=<seasonId>&series=<id>&page=` | `/newtv/episodes.php?id=<seasonId>&page=` |
| Play | `/play.php` (POST id) → `/playlist.php` | `/mobile/[pv/\|hs/]playlist.php?id=&t=<title>&tm=<ts>` | `/newtv/player.php?id=` |

Live check (bina login ke): `GET net52.cc/search.php?s=dark` →
`{"searchResult":[{"id":"80100172","t":"Dark"}, ...]}` — sirf id +
title aata hai, poster client khud template se banata hai.
`/mobile/post.php` bina valid cookie ke `{"status":"n","error":"Invalid User"}`
deta hai — matlab detail ke liye Step 1 ka session chahiye.

Detail (`post.php`) me milta hai: `title, desc, year, genre, cast,
director, match (IMDb), runtime, ua, hdsd, season[] {s,id,selected},
episodes[] {id,t,ep,ep_desc,info[]}, nextPageShow/nextPage` (10
episode per page). Movie ho to `type:"m"`, series ho to `type:"t"`.

### Step 3 — OTT switch kaise hota hai (Netflix / Prime / Hotstar / Disney+)
Koi alag server nahi hai. Ye sirf ek client-controlled value hai:
- Web/mobile par: cookie `ott=nf|pv|dp` + path prefix (`/mobile/` =
  Netflix, `/mobile/pv/` = Prime Video, `/mobile/hs/` = Hotstar/Disney+).
- TV API par: har request me header `ott: nf|pv|hs` aur
  `x-requested-with: NetmirrorNewTV v1.0` (yahi puri "auth" hai browsing ke liye).
- ID bhi platform ke hisab se pehchan sakte ho: Netflix/Hotstar = 8-digit
  number (ye asal Netflix title ID hi hai, jaise Dark = `80100172`),
  Prime = 26-character alphanumeric (Amazon ka ID, `0GZ237L7YK0S...`).

### Step 4 — Posters kahan se aate hain
Saari images `imgcdn.kim` se fixed template par banti hain, API me
image URL aata hi nahi (TV API `------------------` placeholder wale
template deta hai):
- Netflix: `/poster/v/<id>.jpg` (tall), `/poster/341/<id>.jpg` (wide),
  `/poster/1920/<id>.jpg` (backdrop), episode still `/epimg/150/<id>.jpg`
- Prime: `/pv/341/<id>.jpg`, `/pv/c/<id>.jpg`, `/pvepimg/341/...`
- Hotstar: `/hs/v/166/<id>.jpg`, `/hsepimg/<id>.jpg`

### Step 5 — Play dabane par (playlist → HLS master)
Web flow me `playlist.php` JW Player format deta hai. Live check —
The Dark Knight (`70079583`):

```json
[{"image2":"https://imgcdn.kim/poster/1920/70079583.jpg",
  "sources":[
    {"file":"/hls/70079583.m3u8?in=unknown::su","label":"Full HD"},
    {"file":"/hls/70079583.m3u8?q=720p&in=unknown::su","label":"Mid HD","default":"true"},
    {"file":"/hls/70079583.m3u8?q=480p&in=unknown::su","label":"Low HD"}],
  "tracks":[
    {"kind":"captions","file":"//subscdn.top/files/70079583/70079583-en.srt","label":"English"},
    {"kind":"thumbnails","file":"https://imgcdn.kim/nfplayer/.../vtt/70079583.vtt"}]}]
```

Dhyan do: bina verified session ke `in=unknown::su` hai — yahi wo
signed token hai jo verify ke baad asal value (`<md5>::<md5>::<epoch>::ni...`)
ban jata hai. Desktop par token `play.php` (POST `id=...`) se banta hai.

Phir player HLS master mangta hai. Live check —
`tv.imgcdn.kim/newtv/hls/nf/70079583.m3u8`:

```m3u8
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",LANGUAGE="en",
  URI="https://subscdn.top/subs/70079583/en.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="eng",NAME="1. English",
  URI="https://s20.freecdn1.top/files/70079583/a/0/0.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",LANGUAGE="hin",NAME="2. Hindi",
  URI="https://s20.freecdn1.top/files/70079583/a/1/1.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1920x1080,...
  https://...freecdn4.top/files/220884/1080p/1080p.m3u8?in=unknown::su::t
#EXT-X-STREAM-INF:BANDWIDTH=600000,RESOLUTION=1280x720,...
  .../files/220884/720p/720p.m3u8?in=unknown::su::t
#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=854x480,...
  .../files/220884/480p/480p.m3u8?in=unknown::su::t
```

Video me `220884` dikh raha hai kyunki hamare paas verified token nahi
tha. Verified session me yahi jagah `files/70079583/1080p/...` ho jati
hai aur har child URL me server khud token ghusa deta hai jis me
**request karne wale ka public IP + expiry time** bandha hota hai —
isliye token dusre network/IP par kaam nahi karta, aur lambi film me
beech me dobara resolve karna padh sakta hai.

### Step 6 — Quality (1080p / 720p / 480p) kaise milti hai
Do jagah:
1. `playlist.php` teen alag `sources` deta hai — `Full HD` (1080p,
   bina `q` ke), `Mid HD` (`?q=720p`, default), `Low HD` (`?q=480p`).
   Kuch titles par 360p bhi hota hai.
2. HLS master ke andar teen `#EXT-X-STREAM-INF` variants — 1920x1080
   @ ~1 Mbps, 1280x720 @ ~600 kbps, 854x480 @ ~400 kbps. Player
   (JW Player web par, ExoPlayer/Media3 style player app/TV par)
   bandwidth dekh kar automatic switch karta hai. Bitrate asal
   Netflix se kafi kam hai — "1080p" naam ka hai, 1 Mbps par.

### Step 7 — Audio languages (Hindi/English/Tamil...) kaise aati hain
Har language ek **alag audio-only HLS playlist** hai master ke andar:
`files/<id>/a/0/0.m3u8` (1. English), `a/1/1.m3u8` (2. Hindi), aise hi
aage. Ek captured Prime title me 6 audio tracks the — Bengali, Hindi,
Kannada, Malayalam, Tamil, Telugu. Player me language badalna sirf
dusri audio playlist ke segments mangna hai; dobara token/auth nahi
lagta kyunki saare URLs master ke andar pehle se tokenized hote hain.

### Step 8 — Subtitles kaise aate hain (do system parallel chalte hain)
1. **SRT (web/JW Player):** `playlist.php` ke `tracks[]` me
   `kind:"captions"` ke saath `//subscdn.top/files/<id>/<id>-en.srt`
   jaise URLs (purana host `subs.nfmirrorcdn.top` bhi milta hai).
2. **WebVTT-over-HLS (TV/app):** master playlist me
   `#EXT-X-MEDIA:TYPE=SUBTITLES` → `subscdn.top/subs/<id>/en.m3u8`
   → uske andar ek hi bada segment `en.vtt` (live check me confirm).
   Ek Prime title par 16 subtitle languages mili thi (English,
   Hindi[CC], Tamil, Telugu, Kannada, Malayalam, Bengali, Indonesian,
   Malay, Turkish, Arabic, Thai, Chinese simp/trad, Japanese, Korean).
   Prime ki subtitles `pv.subscdn.top` se aati hain.
   Subtitles aur posters lagbhag public hain — paywall sirf video par hai.
   Seek-bar preview thumbnails bhi ek `.vtt` track ke roop me aate hain.

### Step 9 — Video bytes: .jpg/.js me chhupa MPEG-TS
Variant playlist ke segment kuch aise dikhte hain:

```m3u8
#EXTINF:16.666667,
2560_000.jpg      <- video segment
#EXTINF:10.005333,
6004_000.js       <- audio segment
```

Extension jhootha hai (kabhi `.woff2` bhi, matching fake Content-Type
`image/jpeg`/`font/woff2` ke saath). Andar pehla byte `0x47` = plain
**MPEG-TS** hai, usme H.264 video + AAC audio, FFmpeg se encode kiya
hua. Ye trick extension-based takedown filters/WAF ko dhoka dene ke
liye hai; video player Content-Type ignore karke content sniff karke
chala leta hai. Duri security sirf ek header hai:
**`Referer: https://net52.cc/` na ho to CDN 404 deta hai** (live
check me `/hls/...` bina Referer ke Apache 404 aaya). Cookie CDN par
nahi chahiye; Referer + signed `in=` token hi sab kuch hai.

### Step 10 — Download button
Download HLS se nahi hota. App Streamtape embed page ko load karke
uska pura HTML `POST net52.cc/streamtape.php` (`stdata=<HTML>&streamDomain=...`)
bhejta hai; backend usme se signed URL nikal kar `{"dlUrl":"...","status":"ok"}`
lautata hai, aur app use bahar browser/player me khol deta hai. Matlab
operator ko har user ka dekha gaya har title pata chalta hai.

## 4. Backend stack — pakka (confirmed) vs andaza

**Confirmed (live/code se):**
- Frontend/API: haath ki likhi **PHP** files (`search.php`, `post.php`,
  `playlist.php`, `verify2.php`...), **Apache** origin, saamne **Cloudflare**.
- Koi GraphQL, Redis-catalog, Kubernetes jaisa setup nahi dikha —
  Reddit par chalne wala wo wala description speculations hai. Asal
  design bahut simple hai: PHP JSON APIs + static HLS files CDN par.
- Session: sirf cookies + signed URL tokens; koi user account/login
  nahi (desktop par kabhi-kabhi ek fake "Sign In" page dikhta hai).
- Player: web par JW Player; Android app React Native WebView shell
  (`app.netmirror.nmv2` / `app.netmirror.newtv`), codename `OS.Gatu`.
- Video pehle se encode karke `freecdn*.top` par rakhi hai (har quality
  aur har audio language alag folder). Koi live transcoding nahi hoti.

**Andaza (evidence ke hisab se):**
- Catalog DB me Netflix/Prime/Hotstar ke asli IDs + metadata store hai
  jinhe un platforms se scrape karke bhara gaya hai; video files bhi
  unhi sources se leke FFmpeg se teen quality + alag audio tracks me
  kaat kar CDN par daali gayi hain. NetMirror khud video "stream"
  nahi karta — file hosting CDN karta hai, NetMirror sirf playlist
  aur token deta hai.

## 5. Aaj ke live tests (2026-10-31) — kya manga, kya mila

| Request | Jawab |
|---|---|
| `netmirror.world/` DNS + HTTPS | IP `162.4.84.239`; HTTPS khali/TLS reset (gating). Scanner: `301 → netmirror.global → netmirror.plus` (alag clone site) |
| `mobiledetect.app/check.php` | Base64 config → `net52.cc/mobile/home?app=1`, `net52.cc/streamtape.php` |
| `mobiledetects.com/checknewtv.php` | Base64 → `https://tv.imgcdn.kim` |
| `net52.cc/search.php?s=dark` | 200 JSON, ~48 results `{id,t}` (Dark = `80100172`) |
| `net52.cc/mobile/pv/search.php?s=avengers` | 200 JSON, Prime IDs (`0GZ237L7...`) + year/runtime |
| `net52.cc/mobile/post.php?id=80100172` (bina cookie) | `{"status":"n","error":"Invalid User"}` |
| `net52.cc/playlist.php?id=70079583` | JW Player JSON: 3 quality sources (`in=unknown::su`) + English SRT track + thumbnail VTT |
| `tv.imgcdn.kim/newtv/player.php?id=80100172` (bina token) | `{"status":"otp","video_link":".../newtv/hls/nf/80100172.m3u8","referer":"https://net52.cc"}` |
| `tv.imgcdn.kim/newtv/hls/nf/70079583.m3u8` | Master playlist: 1 subtitle, 2 audio (en/hin), 3 video variants — video `220884` placeholder (token nahi tha) |
| `subscdn.top/subs/70079583/en.m3u8` | VOD playlist → ek hi `en.vtt` |
| `net52.cc/hls/80100172.m3u8` (bina Referer) | Apache 404 (anti-hotlink confirm) |
| `net52.cc/mini-modal-info.php?...` | Cloudflare 522 + "Site Under Maintenance, back in 1-2 days" page — origin aksar load me rehta hai |

## 6. Khud dekhna ho to

Browser me site kholkar DevTools → Network tab me ye filters lagakar
upar ka saara flow live dikh jayega: `search.php`, `post.php`,
`playlist.php`, `m3u8`, `freecdn`, `subscdn`, `verify2.php`. Kisi bhi
`.m3u8` request ka Response kholne par audio tracks, subtitle tracks
aur teenon qualities ek saath dikh jati hain.

## 7. Sidify ke hisab se note

Sidify ka movies/series hissa abhi `4khdhub` provider
(`src/lib/media/hubProvider.ts`, strict host-allowlist wale
`safeFetch.ts` ke through) use karta hai. NetMirror usse bilkul alag
system hai (PHP APIs + IP-bound signed HLS + rotating domains).
Ise provider ke roop me jodna na legal hai na stable (domain har
mahine badalta hai, token IP se bandha hai, server kabhi bhi
maintenance par chala jata hai) — isliye ye sirf research note hai.

## Sources

- Live requests upar Table 5 me (author ke dwara 2026-10-31 ko kiye gaye).
- networkshard — "How a Pirate Free Netflix App Smuggles Video Inside
  .jpg Files" (curl se pura pipeline reproduce kiya gaya).
- Muhammad Sameer — "NetMirror Analysis: What the APK Actually Does"
  (+ GitHub `sameerwire/Netmirror-Analysis`: Hermes bundle, PCAP host lists).
- `ksaurav24/projector-remote` — mitmproxy se capture ki gayi NewTV API
  (`docs/netmirror-api.md`).
- Open-source provider code jisme ye saari APIs implement hain:
  `Zenda-Cross/vega-providers` (`providers/netMirrorCommon.ts`),
  `Mocha1530/consumet.ts` (`src/providers/movies/netmirror.ts`),
  `Sushan64/NetMirror-Extension` (CloudStream, Kotlin), `Spyou/Zangetsu`.
