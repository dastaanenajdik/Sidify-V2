import { createServer } from "node:http";

/* ------------------------------------------------------------------ */
/*  Local stand-in for the public lyrics providers.                    */
/*                                                                     */
/*  This sandbox cannot reach lrclib.net / api.lyrics.ovh, so the dev   */
/*  server points `LRCLIB_BASE` here (see .env.local) and the real      */
/*  /api/lyrics pipeline — variants, ranking, LRC parsing — runs        */
/*  unchanged against fixture payloads.                                 */
/*  Lyrics below are placeholder demo text written for this fixture,    */
/*  not real song lyrics.                                               */
/* ------------------------------------------------------------------ */

const PORT = Number(process.env.PORT || 8099);

const syncedLrc = `[00:00.00]♪
[00:12.40]Shaam dhale jab diye jale
[00:16.10]Teri yaad aake dil ko chhoo jaaye
[00:20.30]Hawaon me ghuli hai nami
[00:24.05]Jaise koi chupke se ro jaaye
[00:28.60]Raaste wahi, manzilein nayi
[00:32.40]Har mod pe tera naam likha hai
[00:36.60]Main chalta raha, tu saath chali
[00:40.35]Ye doori bhi ab kitni pyaari hai
[00:45.10]Sun le zara, o humnawa
[00:49.00]Dhadkan yehi kehti hai sada
[00:53.20]Tere bina ye shaam adhuri
[00:57.00]Tere bina har subah bhi
[01:01.30]Tum hi ho, meri raahon ka
[01:05.10]Ek chirag jo bujhta nahi
[01:09.40]Tum hi ho, is dil ka
[01:13.20]Woh sukoon jo milta nahi
[01:17.50]♪
[01:29.80]Baarish ki boondon me tera chehra
[01:33.60]Kagaz pe likhi purani nazmein
[01:37.90]Waqt ne sab kuch badal diya
[01:41.70]Par na badli woh teri batein
[01:46.20]Kahin door sheher ke us paar
[01:50.00]Tu bhi kabhi yun hi sochegi
[01:54.30]Meri yaadon ke us bazaar
[01:58.10]Tu bhi kabhi laut aayegi
[02:02.40]Sun le zara, o humnawa
[02:06.30]Dhadkan yehi kehti hai sada
[02:10.60]Tere bina ye raat adhuri
[02:14.40]Tere bina har subah bhi
[02:18.70]Tum hi ho, meri raahon ka
[02:22.50]Ek chirag jo bujhta nahi
[02:26.80]Tum hi ho, is dil ka
[02:30.60]Woh sukoon jo milta nahi
[02:35.00]♪
[02:47.30]Jo keh na sake, woh sab keh doon
[02:51.10]Ek baar tu laut aaye toh
[02:55.40]Apni hi galiyon me jaake main
[02:59.20]Purane woh geet gaaoon
[03:03.50]Tum hi ho… haan tum hi ho
[03:07.40]Meri har dua me shaamil ho
[03:11.60]Tum hi ho… bas tum hi ho
[03:15.40]Is dil ke sabse kareeb ho
[03:19.60]♪
[03:31.00]Shaam dhale jab diye jale
[03:35.20]Teri yaad aake dil ko chhoo jaaye`;

const plainOnly = `Neon lights on an empty street
Headphones on, I skip the beat
Every song that I used to know
Sounds like somewhere I can't let go

Chorus:
Turn it up until the walls shake
Every memory I can't erase
Turn it up, let the whole block hear
I'm still dancing like you're right here`;

const TRACKS = [
  {
    id: 1,
    trackName: "Tum Hi Ho (Demo)",
    artistName: "Sidify Demo Singer",
    albumName: "Synced Lyrics Demo",
    duration: 240,
    instrumental: false,
    plainLyrics: syncedLrc.replace(/\[\d{2}:\d{2}\.\d{2}\]\s*/g, "").replace(/♪/g, "").trim(),
    syncedLyrics: syncedLrc,
  },
  {
    id: 2,
    trackName: "Neon Street",
    artistName: "The Demo Band",
    albumName: "Plain Lyrics Only",
    duration: 198,
    instrumental: false,
    plainLyrics: plainOnly,
    syncedLyrics: null,
  },
  {
    id: 3,
    trackName: "Midnight Raga",
    artistName: "Sidify Demo Ensemble",
    albumName: "Instrumental",
    duration: 312,
    instrumental: true,
    plainLyrics: null,
    syncedLyrics: null,
  },
];

const json = (res, body, status = 200) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    "access-control-allow-origin": "*",
  });
  res.end(payload);
};

createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/health") return json(res, { ok: true, tracks: TRACKS.length });

  if (url.pathname === "/api/get") {
    const track = (url.searchParams.get("track_name") || "").trim().toLowerCase();
    const artist = (url.searchParams.get("artist_name") || "").trim().toLowerCase();
    const hit = TRACKS.find(
      (t) => t.trackName.toLowerCase() === track && (!artist || t.artistName.toLowerCase().includes(artist))
    );
    return hit ? json(res, hit) : json(res, { message: "Track not found" }, 404);
  }

  if (url.pathname === "/api/search") {
    const q = (url.searchParams.get("track_name") || url.searchParams.get("q") || "").trim().toLowerCase();
    const hits = TRACKS.filter((t) => !q || t.trackName.toLowerCase().includes(q));
    return json(res, hits);
  }

  // lyrics.ovh-compatible fallback shape
  if (url.pathname.startsWith("/v1/")) {
    const [, , artist, title] = url.pathname.split("/");
    const hit = TRACKS.find(
      (t) =>
        t.plainLyrics &&
        decodeURIComponent(title || "").toLowerCase() === t.trackName.toLowerCase() &&
        decodeURIComponent(artist || "").toLowerCase() === t.artistName.toLowerCase()
    );
    return hit ? json(res, { artist: hit.artistName, title: hit.trackName, lyrics: hit.plainLyrics }) : json(res, { error: "No lyrics found" }, 404);
  }

  return json(res, { message: "Not found" }, 404);
}).listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-lrclib] listening on http://127.0.0.1:${PORT} (${TRACKS.length} fixture tracks)`);
});
