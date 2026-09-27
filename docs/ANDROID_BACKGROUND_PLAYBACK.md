# Background playback on Android — "app bana loon TWA ya Flutter me?"

**Report:** *"Back karne ke baad / screen off karne ke baad gaana pause ho jata hai — sirf Brave browser me chalta
hai. Kya site WebView se chal rahi hai? Main ek TWA ya Flutter app bana loon jo browser jaisa ho, yahi site khole,
aur Back dabane pe gaana chalta rahe?"*

Short answer: **WebView se nahi chal rahi thi, aur TWA/WebView app banane se ye problem fix nahi hogi — WebView me
to ye aur bura ho jayegi.** Background playback browser/engine ka rule hai, app wrapper ka nahi. Do raste kaam
karte hain: (1) playback ko **plain `<audio>` engine** pe le jao (ye release), aur (2) jab browser phir bhi rok de to
**native app** (IfallMusic) use karo — ExoPlayer + foreground service hi screen-off/tab-kill ko guarantee karta hai.

---

## 1. Asli wajah — "sirf Brave me kyun chalta hai?"

Mobile Chromium ke do alag rules hain:

| Media | Screen off / app background me | Kyun |
|---|---|---|
| `<audio>` element (plain) | **chalti rehti hai** | Browser isse "audible tab" maanta hai aur OS media session banata hai |
| `<video>` element | **pause ho jata hai** | Data/battery policy — Chrome Android background video allow nahi karta |
| YouTube **iframe embed** (andar `<video>` banata hai) | **pause ho jata hai** | Wahi video rule, cross-origin iframe pe |
| Web Audio graph (`createMediaElementSource`) | **silent ho jati hai** (element "audible" nahi rehta) | Element ka output graph me jata hai, tab audio bookkeeping se bahar |

**Brave** ke paas apni setting hai — *Settings → Media → Background play / Background video playback* — jo video
wala rule **override** karta hai. Isliye Brave me embed bhi screen-off pe chalta rehta hai, aur Chrome/Samsung
Internet/WebView me nahi. Ye site ki galti nahi thi.

Sidify ka engine already do modes me chalta hai (`src/lib/engineMode.ts`):

- **native** — `/api/stream` se audio-only stream, plain element / Web Audio graph
- **iframe** — YouTube IFrame fallback jab server extraction available na ho

Report "kabhi chalta hai, kabhi nahi" isi wajah se hoti thi: jis device/server pe native extraction fail hota hai,
playback iframe pe chala jata hai — aur iframe Chrome me screen-off pe rukega hi.

---

## 2. Ab is release me kya badla (Update 1.5)

1. **Mobile = proactive plain-audio handoff.** Jaise hi page hidden hota hai (screen off / app switch), native
   playback plain `<audio>` element pe chala jata hai — **chahe AudioContext abhi bhi `running` ho**. Pehle ye
   handoff sirf tab hota tha jab context suspend ho chuka ho; phones pe browser silently suspend karta hai bina
   koi state event diye, aur frozen background tab me recovery chal hi nahi paati. Isliye switch **pehle** hota
   hai, jab CPU available ho. (`needsPlainElement({ …, mobile })`)
2. **Hidden-pause recovery.** Agar background me phir bhi pause aa jaye (browser/OS decision), engine use detect
   karta hai (`pause` event + `noteHiddenPause`) aur wapas chalata hai — plain element ke liye `play()`, iframe ke
   liye `resume()`. Per hidden window **max 2 attempts**, aur user ke apne pause se kabhi nahi ladta
   (`decideHiddenPauseRecovery`).
3. **Media-session sync.** `playbackState` aur 1 Hz `setPositionState` — notification/lock-screen controls ab
   actual state dikhate hain, isliye OS session ko "stale playing" nahi lagta.
4. **Engine report.** Settings → System → “Playback engine” row live batati hai: *Background-safe (plain audio)*,
   *Native audio · Web Audio graph*, ya *YouTube embed — Chrome pauses embeds on screen-off*. “Copy report” se
   pura event log (`src/lib/playbackDiag.ts`) milta hai — ye wahi evidence hai jo is bug ko guesswork se
   diagnosis banata hai.

**Jo code isse fix nahi hota:** agar kisi track ka native extraction hi available nahi (server IP YouTube pe
blocked), playback iframe pe rahega → Chrome usse screen-off pe rokega. Us case me report row amber dikhata hai
aur Brave / native app recommend karta hai.

---

## 3. App options — honest comparison

| Option | App icon / Play Store | Screen-off playback | Back button | Effort |
|---|---|---|---|---|
| **Browser tab** (aaj) | ❌ | native pe ✅ · iframe pe ❌ (Chrome), ✅ Brave | browser ka Back | 0 |
| **PWA install** (Chrome menu → Install app) | ✅ homescreen, app task me khulta hai | **same Chromium rules** — kuch nahi badalta | Back app ke andar | 0 (already enabled) |
| **TWA** (Bubblewrap / GitHub Actions → Play Store) | ✅ Play Store listing | **same Chromium rules** — WebAPK jaisa hi | ✅ Android back handler | Signing key + `assetlinks.json` + CI |
| **WebView wrapper** (Flutter `webview_flutter` / Android `WebView`) | ✅ | **aur kharab** — Chromium WebView app ke invisible hote hi media pause karta hai; foreground service ke bina kuch bhi nahi bachta | ✅ | Medium — aur phir bhi audio ke liye native bridge likhna padega |
| **Native player app** (IfallMusic / `just_audio` + `audio_service`) | ✅ | ✅ **guaranteed** (ExoPlayer + foreground service) | ✅ | Already built (v2.2.0) |

**Recommendation:**

1. **Background playback zaroori hai** → native app (IfallMusic) use karo. Wo site pe depend bhi nahi karta, apna
   extraction khud karta hai. Play Store/`Download/IfallMusic` flow already live hai.
2. **Site ko app ki tarah chahiye** → Chrome menu → *Install app* (PWA). Isse app icon, apna task aur behtar tab
   survival milta hai — lekin media rules wahi rehte hain, isliye playback ke liye Brave use karo.
3. **Play Store listing chahiye** → TWA banva sakte hain (neeche recipe) — samajh lo ye "PWA + Play Store" hai,
   background fix nahi.
4. **WebView wrapper audio ke liye kabhi nahi.** Agar phir bhi chahiye (jaise site-UI + native audio ka hybrid),
   to audio native side pe (ExoPlayer) chalao aur WebView ko sirf UI rakho — warna wahi pause milega.

### TWA recipe (agar Play Store listing chahiye)

```bash
npx @bubblewrap/cli init --manifest https://<your-domain>/manifest.json
npx @bubblewrap/cli build            # → app-release-signed.apk / .aab
```

- `assetlinks.json` site pe host karo (`/.well-known/assetlinks.json`) taaki URL bar na dikhe.
- `manifest.json` me `display: standalone`, icons aur `start_url` already sahi hain (`public/manifest.json`).
- GitHub Actions me Bubblewrap build chalaya ja sakta hai, taaki local Android SDK ki zaroorat na ho.

### WebView me kya-kya todta hai (agar test karna ho)

- Page hidden hote hi WebView media pause karta hai; `mediaPlaybackRequiresUserGesture` off karne se sirf
  autoplay policy badalti hai, background rule nahi.
- Media Session notification WebView se OS tak reliably nahi jaati (foreground service chahiye).
- Isliye native shell ka matlab hai: **UI web se, audio native se** — jo asal me naya player likhna hai.

---

## 4. Verification (phone pe 2 minute)

1. Settings → System → **Playback engine** kholo.
2. Koi gaana play karo. Row batayegi engine kaun sa hai:
   - *Native audio …* → screen on/off karke dekho: row "plain element" pe switch hona chahiye aur gaana chalta
     rahega.
   - *YouTube embed* → ye track background me ruk sakta hai (Chrome rule). Brave me try karo ya "Copy report"
     dabao aur log bhejo — us case me server-side extraction fix karna padega, app banana kaam nahi aayega.
3. “Copy report” ka text (`playbackDiag`) exact event timeline deta hai: `visibility hidden` → `plain-handoff` /
   `mode` → agar pause aaya to `PAUSE-WHILE-HIDDEN` + `recover` / `recover-failed`.
