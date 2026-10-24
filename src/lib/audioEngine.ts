"use client";

import { usePlayer, currentTrack, type QueueTier } from "@/store/player";
import { useSettings, effectiveGains, EQ_BANDS } from "@/store/settings";
import { useUi } from "@/store/ui";
import type { Track } from "./types";
import { offlineObjectUrl } from "./offlineDb";
import { api } from "./clientApi";
import { emitRefresh } from "./refreshBus";
import { ytController } from "./ytPlayer";
import { roomBridge } from "./rooms/bridge";
import { addListened, flushPlayLog, logPlay } from "./playLog";

/* ------------------------------------------------------------------ */
/* Sidify transport engine.                                             */
/*  - "native" mode: extracted full-length audio via /api/stream proxy, */
/*    routed through the dual-deck Web Audio graph (EQ / pan / fade).   */
/*  - "iframe" mode: YouTube IFrame Player API — video mode (visible)   */
/*    and audio/background mode (hidden harbor). Used when native       */
/*    extraction is unavailable for the current environment.            */
/* ------------------------------------------------------------------ */

interface Deck {
  el: HTMLAudioElement;
  filters: BiquadFilterNode[];
  postGain: GainNode;
  trackId: string | null;
}

let actx: AudioContext | null = null;
let master: GainNode | null = null;
let panner: StereoPannerNode | null = null;
let decks: Deck[] = [];
let active = 0;
let initialized = false;
let fading = false;
let rafId = 0;
let lastTick = 0;
let preloadedId: string | null = null;
let playSeq = 0;
let crossfadeTimer: ReturnType<typeof setTimeout> | null = null;
let ctxUnlocked = false;
let endedAt = 0;
let nativeCapable: boolean | null = null;
let nativeProbeAt = 0;
let errorSkips = 0;
let ytWired = false;
/** The last play() was refused by the browser's autoplay policy (needs a tap). */
let lastPlayBlocked = false;
/** Track that failed to load while in a room — the room client won't retry it. */
let roomFailedId: string | null = null;
let lastListenAt = 0;
const recentRecorded = new Map<string, number>();
const playHistory: number[] = [];

let sleepTimeout: ReturnType<typeof setTimeout> | null = null;

function P() {
  return usePlayer.getState();
}
function S() {
  return useSettings.getState();
}
function toast(title: string, desc?: string, kind: "ok" | "info" | "warn" = "warn") {
  useUi.getState().pushToast({ title, desc, kind });
}

function isIframeMode(): boolean {
  return P().engineMode === "iframe";
}

/**
 * Browsers only hand out an AudioContext and a YouTube player once the page has been
 * interacted with. Both must be created **synchronously inside the click handler** —
 * the old code reached them only after an `await`, which is how "first song stays
 * silent, second one plays" happened.
 */
export function unlockEngine() {
  if (ctxUnlocked || typeof window === "undefined") return;
  ctxUnlocked = true;
  ensureCtx();
  if (actx?.state === "suspended") void actx.resume().catch(() => {});
  ytController.warm(currentTrack(P())?.videoId);
}

/** Called from the first real user gesture anywhere on the page. */
export function armEngineUnlock() {
  if (typeof window === "undefined") return;
  const go = () => {
    unlockEngine();
    window.removeEventListener("pointerdown", go);
    window.removeEventListener("keydown", go);
  };
  window.addEventListener("pointerdown", go, { passive: true });
  window.addEventListener("keydown", go);
}

function ensureCtx() {
  if (actx || typeof window === "undefined") return;
  actx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  master = actx.createGain();
  panner = actx.createStereoPanner();
  master.connect(panner);
  panner.connect(actx.destination);
  decks = [createDeck(0), createDeck(1)];
  applySettings();
}

function createDeck(i: number): Deck {
  const el = new Audio();
  el.preload = "auto";
  const src = actx!.createMediaElementSource(el);
  const filters = EQ_BANDS.map((freq, idx) => {
    const f = actx!.createBiquadFilter();
    f.type = idx === 0 ? "lowshelf" : idx === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
    f.frequency.value = freq;
    f.Q.value = 1;
    return f;
  });
  const postGain = actx!.createGain();
  postGain.gain.value = 0;
  src.connect(filters[0]);
  for (let k = 1; k < filters.length; k++) filters[k - 1].connect(filters[k]);
  filters[filters.length - 1].connect(postGain);
  postGain.connect(master!);

  el.addEventListener("ended", () => {
    if (i === active && !fading && !isIframeMode()) void handleEnded();
  });
  el.addEventListener("error", () => {
    if (i === active && !isIframeMode()) handleTrackError();
  });

  return { el, filters, postGain, trackId: null };
}

export function applySettings() {
  const s = S();
  const p = P();
  if (actx) {
    const gains = effectiveGains(s);
    for (const d of decks) {
      d.filters.forEach((f, i) => f.gain.setTargetAtTime(gains[i] ?? 0, actx!.currentTime, 0.05));
      d.el.playbackRate = p.speed;
    }
    const normFactor = s.normalization ? 0.82 : 1;
    master!.gain.setTargetAtTime(p.volume * normFactor, actx.currentTime, 0.03);
    panner!.pan.setTargetAtTime(s.balance, actx.currentTime, 0.03);
  }
  ytController.setVolume(p.volume);
  ytController.setRate(p.speed);
}

function ramp(node: AudioParam, to: number, secs: number) {
  if (!actx) return;
  const now = actx.currentTime;
  node.cancelScheduledValues(now);
  node.setValueAtTime(node.value, now);
  node.linearRampToValueAtTime(to, now + Math.max(0.05, secs));
}

/* ------------------------- mode selection ----------------------------- */

/**
 * "Can this environment extract full-length audio?" is answered by probing /api/stream.
 * The probe is *allowed* to take a while (YouTube extraction is slow), but it must not
 * hold up the very first play: after `PROBE_WAIT_MS` we stop waiting and start the
 * YouTube-iframe player instead, while the probe keeps running and caches its verdict for
 * every track after this one.
 */
const PROBE_WAIT_MS = 900;

async function probeNative(track: Track): Promise<boolean> {
  if (nativeCapable !== null && Date.now() - nativeProbeAt < 5 * 60_000) return nativeCapable;
  if (!track.videoId) return false;

  const run = async (): Promise<boolean> => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 24_000);
      const res = await fetch(`/api/stream?video_id=${track.videoId}`, { signal: ctrl.signal });
      clearTimeout(t);
      return res.ok;
    } catch {
      return false;
    }
  };

  const verdict = run().then((ok) => {
    nativeCapable = ok;
    nativeProbeAt = Date.now();
    return ok;
  });

  let timer: ReturnType<typeof setTimeout> | null = null;
  const raced = (await Promise.race([
    verdict,
    new Promise<"pending">((resolve) => {
      timer = setTimeout(() => resolve("pending"), PROBE_WAIT_MS);
    }),
  ])) as boolean | "pending";

  if (timer) clearTimeout(timer);
  if (raced === "pending") {
    // Unknown yet: keep the cached verdict (if any) and let the answer arrive in background.
    verdict.catch(() => {});
    return nativeCapable ?? false;
  }
  return raced;
}

async function chooseMode(track: Track, seq: number): Promise<"native" | "iframe" | null> {
  // downloaded audio always plays natively (offline capable)
  if (P().downloadedIds[track.id]) {
    const local = await offlineObjectUrl(track.id);
    if (local) return "native";
  }
  if (P().videoMode) return "iframe";
  if (!track.videoId) return null;
  const cap = await probeNative(track);
  if (seq !== playSeq) return null;
  return cap ? "native" : "iframe";
}

/* ------------------------------ transport ----------------------------- */

function nextIndex(fromIndex = P().index): number | null {
  const s = P();
  const len = s.queue.length;
  if (!len) return null;
  if (s.shuffle && len > 1) {
    const candidates = s.queue
      .map((_, i) => i)
      .filter((i) => i !== s.index && !playHistory.slice(-Math.min(6, len - 1)).includes(i));
    const pool = candidates.length ? candidates : s.queue.map((_, i) => i).filter((i) => i !== s.index);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  const ni = fromIndex + 1;
  if (ni < len) return ni;
  if (s.repeat === "all") return 0;
  return null;
}

export async function playIndex(i: number, opts?: { resumeMs?: number }) {
  const s = P();
  const track = s.queue[i];
  if (!track) return;
  const seq = ++playSeq;

  // A crossfade that gets superseded mid-flight must not leave `fading` stuck at true:
  // it silences next()/prev()/autoplay for the rest of the session.
  if (crossfadeTimer) {
    clearTimeout(crossfadeTimer);
    crossfadeTimer = null;
  }
  fading = false;
  unlockEngine();
  if (roomFailedId && roomFailedId !== track.id) roomFailedId = null;

  usePlayer.getState().set({
    index: i,
    isLoading: true,
    isPlaying: true,
    positionMs: opts?.resumeMs ?? 0,
    durationMs: track.durationMs,
  });

  const mode = await chooseMode(track, seq);
  if (seq !== playSeq) return;
  if (!mode) {
    usePlayer.getState().set({ isPlaying: false, isLoading: false });
    toast("Track unavailable", track.title);
    return;
  }
  usePlayer.getState().set({ engineMode: mode });

  if (mode === "iframe") {
    await playIframe(track, seq, opts?.resumeMs ?? 0);
    return;
  }
  await playNative(track, i, seq, opts?.resumeMs ?? 0);
}

async function playIframe(track: Track, seq: number, resumeMs: number) {
  stopDecks();
  wireYt();
  try {
    await ytController.playVideo(track.videoId!, Math.floor(resumeMs / 1000));
  } catch {
    if (seq !== playSeq) return;
    // The embed engine itself failed (blocked script, offline, extension). If direct
    // extraction is available, use it instead of giving up on the track.
    if (await probeNative(track)) {
      await playNative(track, P().index, seq, resumeMs);
      return;
    }
    usePlayer.getState().set({ isPlaying: false, isLoading: false });
    toast("Couldn't start the Sidify player");
    return;
  }
  // `playVideo` waits for the player to boot, so a newer click may have taken over in
  // the meantime - that request is already queued inside the controller.
  if (seq !== playSeq) return;
  armIframeStartCheck(track, seq, resumeMs);
  ytController.setVolume(P().volume);
  ytController.setRate(P().speed);
  playHistory.push(P().index);
  errorSkips = 0;
  P().set({ isLoading: false });
  updateMediaSession(track);
  recordRecent(track);
}

async function playNative(track: Track, i: number, seq: number, resumeMs: number) {
  ensureCtx();
  ytController.pause();
  const to = decks[active];
  const from = decks[1 - active];
  from.el.pause();
  from.postGain.gain.value = 0;
  from.trackId = null;
  fading = false;

  let url: string;
  const local = await offlineObjectUrl(track.id);
  if (local) url = local;
  else if (track.videoId) url = `/api/stream?video_id=${track.videoId}&play=1`;
  else {
    if (seq === playSeq) {
      usePlayer.getState().set({ isPlaying: false, isLoading: false });
      toast("Track unavailable");
    }
    return;
  }

  if (seq !== playSeq) return;
  to.el.src = url;
  to.el.playbackRate = P().speed;
  to.trackId = track.id;
  to.postGain.gain.value = 1;
  if (resumeMs > 1000) to.el.currentTime = resumeMs / 1000;
  try {
    await actx!.resume();
    await to.el.play();
  } catch (err) {
    if (seq !== playSeq) return;
    // Decoding/container failures are engine-specific, not track-specific: give this
    // track to the embed player and stop trusting native extraction for a while.
    // (A rejected play() from the autoplay policy is NOT retried - the iframe would be
    // blocked by exactly the same rule.)
    const name = (err as { name?: string } | null)?.name;
    if (name === "NotAllowedError") lastPlayBlocked = true;
    if (!local && track.videoId && name !== "NotAllowedError" && name !== "AbortError") {
      nativeCapable = false;
      nativeProbeAt = Date.now();
      P().set({ engineMode: "iframe" });
      await playIframe(track, seq, resumeMs);
      return;
    }
    P().set({ isPlaying: false, isLoading: false });
    return;
  }
  if (seq !== playSeq) return;
  lastPlayBlocked = false;
  playHistory.push(i);
  if (playHistory.length > 40) playHistory.shift();
  errorSkips = 0;
  P().set({ isLoading: false });
  updateMediaSession(track);
  recordRecent(track);
  preloadNextSoon();
}

/**
 * Last-resort guard for "the click did nothing": if the embed never left the unstarted
 * state, we either hand the track to the native deck or stop honestly, instead of
 * pretending to play forever.
 */
function armIframeStartCheck(track: Track, seq: number, resumeMs: number) {
  setTimeout(() => {
    void (async () => {
      const s = P();
      if (seq !== playSeq || !s.isPlaying || !isIframeMode()) return;
      if (ytController.getPlayerState() !== -1) return; // started or buffering - both fine
      if (await probeNative(track)) {
        void playNative(track, s.index, seq, resumeMs);
        return;
      }
      usePlayer.getState().set({ isPlaying: false, isLoading: false });
      toast("Playback couldn't start", "Tap play again, or try another song");
    })();
  }, 8000);
}

function stopDecks() {
  if (crossfadeTimer) {
    clearTimeout(crossfadeTimer);
    crossfadeTimer = null;
  }
  if (!actx) return;
  for (const d of decks) {
    d.el.pause();
    d.postGain.gain.value = 0;
    d.trackId = null;
  }
  fading = false;
}

function wireYt() {
  if (ytWired) return;
  ytWired = true;
  ytController.setCallbacks({
    onEnded: () => void handleEnded(),
    onState: (playing) => {
      // PLAYING means the wait is over — drop the spinner at the same moment
      // instead of whenever the next caller happened to clear it.
      if (isIframeMode()) P().set(playing ? { isPlaying: true, isLoading: false } : { isPlaying: playing });
    },
    onError: () => handleTrackError(),
  });
}

function handleTrackError() {
  const s = P();
  if (roomBridge()) {
    // Everyone else may well be able to play it — don't skip the room over it.
    roomFailedId = currentTrack(s)?.id ?? null;
    P().set({ isPlaying: false, isLoading: false });
    toast("This song can't play on this device", "You'll rejoin with the next one", "info");
    return;
  }
  errorSkips++;
  if (errorSkips > 8) {
    toast("Several songs are unavailable right now", "Playback paused");
    P().set({ isPlaying: false, isLoading: false });
    return;
  }
  let ni = nextIndex();
  if (ni === null) {
    // Nothing left in the queue to skip to - pull in similar songs so a failed video
    // doesn't end the session.
    void appendSimilar().then((appended) => {
      if (appended) void playIndex(P().index + 1);
      else P().set({ isPlaying: false, isLoading: false });
    });
    toast("Track unavailable — finding something similar", currentTrack(s)?.title, "info");
    return;
  }
  toast("Video unavailable — skipping", currentTrack(s)?.title, "info");
  void playIndex(ni);
}

export function playContext(tracks: Track[], startIndex: number, label = "") {
  unlockEngine();
  const filtered = filterBlocked(tracks);
  if (!filtered.length) return;
  const target = Math.max(0, Math.min(startIndex, filtered.length - 1));
  const rb = roomBridge();
  if (rb) {
    rb.playContext(filtered, target, label);
    return;
  }
  preloadedId = null;
  usePlayer.getState().set({ queue: filtered, tiers: {}, contextLabel: label, resumeFromMs: 0 });
  void playIndex(target);
}

export function playTrackNow(track: Track) {
  unlockEngine();
  const rb = roomBridge();
  if (rb) {
    rb.playContext([track], 0, "Single track");
    return;
  }
  const s = P();
  const existing = s.queue.findIndex((t) => t.id === track.id);
  if (existing >= 0) {
    void playIndex(existing);
    return;
  }
  const insertAt = Math.max(0, s.index + 1);
  const queue = [...s.queue];
  queue.splice(insertAt, 0, track);
  usePlayer.getState().set({ queue, contextLabel: s.contextLabel || "Single track", resumeFromMs: 0 });
  void playIndex(insertAt);
}

/** Start a song radio: the track now, then what YouTube Music would play after it. */
export async function startRadio(track: Track) {
  unlockEngine();
  const label = `${track.title} Radio`;
  if (roomBridge() || !track.videoId) {
    playContext([track], 0, label);
    return;
  }
  playContext([track], 0, label);
  try {
    const res = await api.radio(track.videoId, 25);
    if (currentTrack(P())?.id !== track.id) return;
    const existing = new Set(P().queue.map((t) => t.id));
    const fresh = filterBlocked(res?.tracks ?? []).filter((t) => !existing.has(t.id));
    if (fresh.length) usePlayer.getState().set({ queue: [...P().queue, ...fresh] });
  } catch {
    toast("Couldn't start the radio", "Similar songs will still follow via AutoPlay", "info");
  }
}

function withTier(id: string, tier: QueueTier | null) {
  const tiers = { ...P().tiers };
  if (tier) tiers[id] = tier;
  else delete tiers[id];
  return tiers;
}

export function playNextInQueue(track: Track) {
  const rb = roomBridge();
  if (rb) {
    rb.queueAdd(track, "next");
    return;
  }
  const s = P();
  const cur = currentTrack(s);
  if (cur?.id === track.id) return;
  const queue = s.queue.filter((t) => t.id !== track.id);
  const curIdx = cur ? queue.findIndex((t) => t.id === cur.id) : -1;
  queue.splice(Math.max(0, curIdx + 1), 0, track);
  usePlayer.getState().set({ queue, index: curIdx < 0 ? s.index : curIdx, tiers: withTier(track.id, "user") });
  if (s.index < 0) void playIndex(0);
}

/** "Add to queue": after everything else the listener queued, before the rest of the album. */
export function addToQueueEnd(track: Track) {
  const rb = roomBridge();
  if (rb) {
    rb.queueAdd(track, "end");
    return;
  }
  const s = P();
  const cur = currentTrack(s);
  if (cur?.id === track.id) return;
  const queue = s.queue.filter((t) => t.id !== track.id);
  const curIdx = cur ? queue.findIndex((t) => t.id === cur.id) : -1;
  let at = curIdx + 1;
  while (at < queue.length && s.tiers[queue[at].id] === "user") at++;
  queue.splice(Math.max(0, at), 0, track);
  usePlayer.getState().set({ queue, index: curIdx < 0 ? s.index : curIdx, tiers: withTier(track.id, "user") });
  if (s.index < 0) void playIndex(0);
}

export function moveInQueue(from: number, to: number) {
  const rb = roomBridge();
  if (rb) {
    rb.queueMove(from, to);
    return;
  }
  const s = P();
  if (from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) return;
  const queue = [...s.queue];
  const [item] = queue.splice(from, 1);
  queue.splice(to, 0, item);
  let index = s.index;
  if (from === index) index = to;
  else if (from < index && to >= index) index--;
  else if (from > index && to <= index) index++;
  usePlayer.getState().set({ queue, index });
}

export function removeFromQueue(i: number) {
  const rb = roomBridge();
  if (rb) {
    rb.queueRemove(i);
    return;
  }
  const s = P();
  if (i < 0 || i >= s.queue.length || i === s.index) return;
  const queue = s.queue.filter((_, idx) => idx !== i);
  const index = i < s.index ? s.index - 1 : s.index;
  usePlayer.getState().set({ queue, index, tiers: withTier(s.queue[i].id, null) });
}

/** Drops everything after the current track that the listener queued themselves. */
export function clearUserQueue() {
  const rb = roomBridge();
  if (rb) {
    rb.queueClear();
    return;
  }
  const s = P();
  const keep = s.queue.filter((t, i) => i <= s.index || s.tiers[t.id] !== "user");
  const tiers = Object.fromEntries(Object.entries(s.tiers).filter(([, v]) => v !== "user"));
  usePlayer.getState().set({ queue: keep, tiers });
}

export function setQueue(next: Track[], index: number) {
  usePlayer.getState().set({ queue: next, index });
}

/** Jump to a row of the queue. */
export function jumpTo(i: number) {
  const rb = roomBridge();
  if (rb) {
    rb.jump(i);
    return;
  }
  if (i === P().index) return;
  void playIndex(i);
}

/** AutoPlay on/off — the ∞ in the queue. Off drops the similar songs it lined up. */
export function setAutoplay(on: boolean) {
  const rb = roomBridge();
  if (rb) {
    rb.setAutoplay(on);
    return;
  }
  useSettings.getState().set({ autoplay: on });
  if (on) {
    void ensureAutoplayBuffer();
    return;
  }
  const s = P();
  const queue = s.queue.filter((t, i) => i <= s.index || s.tiers[t.id] !== "autoplay");
  const tiers = Object.fromEntries(Object.entries(s.tiers).filter(([, v]) => v !== "autoplay"));
  usePlayer.getState().set({ queue, tiers });
}

/** What the transport is really doing (the store can lag a frame). */
function actuallyPlaying(): boolean {
  if (isIframeMode()) return ytController.isPlaying();
  if (!actx) return false;
  const deck = decks[active];
  return !!deck?.trackId && !deck.el.paused;
}

/**
 * Play or pause without asking the room. Resolves false when the browser
 * refused to start audio (autoplay policy) so the caller can ask for a tap.
 */
async function setPlayingLocal(play: boolean): Promise<boolean> {
  const s = P();
  const track = currentTrack(s);
  if (!track) return false;

  if (isIframeMode()) {
    if (!play) {
      ytController.pause();
      P().set({ isPlaying: false });
      saveSession();
      return true;
    }
    if (ytController.currentVideoId !== track.videoId) {
      await playIndex(s.index, { resumeMs: s.resumeFromMs || s.positionMs });
      usePlayer.getState().set({ resumeFromMs: 0 });
      return P().isPlaying;
    }
    ytController.resume();
    P().set({ isPlaying: true });
    return true;
  }

  ensureCtx();
  const deck = decks[active];
  if (deck.trackId !== track.id) {
    if (!play) {
      P().set({ isPlaying: false });
      return true;
    }
    lastPlayBlocked = false;
    await playIndex(s.index, { resumeMs: s.resumeFromMs || s.positionMs });
    usePlayer.getState().set({ resumeFromMs: 0 });
    return !lastPlayBlocked;
  }
  if (play) {
    try {
      await actx!.resume();
      await deck.el.play();
      lastPlayBlocked = false;
      P().set({ isPlaying: true });
      return true;
    } catch (err) {
      if ((err as { name?: string } | null)?.name === "NotAllowedError") lastPlayBlocked = true;
      P().set({ isPlaying: false });
      return false;
    }
  }
  deck.el.pause();
  P().set({ isPlaying: false });
  saveSession();
  return true;
}

export async function togglePlay() {
  unlockEngine();
  const s = P();
  if (!currentTrack(s)) return;
  const rb = roomBridge();
  if (rb) {
    rb.setPlaying(!(s.isPlaying || actuallyPlaying()));
    return;
  }
  await setPlayingLocal(!actuallyPlaying());
}

export async function next(manual = true) {
  const rb = roomBridge();
  if (rb && manual) {
    rb.next();
    return;
  }
  await nextLocal();
}

async function nextLocal() {
  const s = P();
  if (!s.queue.length || fading) return;
  let ni = nextIndex(s.index);
  if (ni === null) {
    // End of the queue (search results, playlist, liked, artist...). Autoplay keeps
    // the music going with similar tracks instead of dying on the last song.
    if (S().autoplay) {
      const appended = await appendSimilar();
      if (appended) ni = P().index + 1;
    }
    if (ni === null || ni >= P().queue.length) {
      // Nothing left and no similar songs could be fetched: stop cleanly at the end
      // so the transport doesn't sit in a fake "playing" state forever.
      stopAtEnd();
      return;
    }
  }
  await playIndex(ni);
}

export async function prev() {
  const s = P();
  if (!s.queue.length) return;
  const rb = roomBridge();
  if (rb) {
    rb.prev();
    return;
  }
  if (isIframeMode()) {
    if (ytController.getTime() > 4) {
      ytController.seekTo(0);
      P().set({ positionMs: 0 });
      return;
    }
  } else if (actx && decks[active].el.currentTime > 4) {
    decks[active].el.currentTime = 0;
    P().set({ positionMs: 0 });
    return;
  }
  const pi = s.index > 0 ? s.index - 1 : s.repeat === "all" ? s.queue.length - 1 : 0;
  await playIndex(pi);
}

export function seekTo(ms: number) {
  const rb = roomBridge();
  if (rb) {
    rb.seek(ms);
    return;
  }
  seekLocal(ms);
}

function seekLocal(ms: number) {
  if (isIframeMode()) {
    ytController.seekTo(ms / 1000);
    P().set({ positionMs: ms });
    return;
  }
  if (!actx) {
    P().set({ positionMs: ms, resumeFromMs: ms });
    return;
  }
  const deck = decks[active];
  if (!deck.trackId || (deck.el.seekable.length === 0 && deck.el.readyState < 2)) {
    P().set({ positionMs: ms, resumeFromMs: ms });
    return;
  }
  deck.el.currentTime = Math.max(0, ms / 1000);
  P().set({ positionMs: ms });
}

/** Precise playback position, read from the player itself. */
export function currentPositionMs(): number {
  if (isIframeMode()) return ytController.getTime() * 1000;
  if (actx && decks[active]?.trackId) return decks[active].el.currentTime * 1000;
  return P().positionMs;
}

/** Point the transport at a queue row without starting it (room joins, paused rooms). */
function loadPausedLocal(i: number, positionMs: number) {
  const track = P().queue[i];
  if (!track) return;
  ++playSeq;
  stopDecks();
  ytController.pause();
  usePlayer.getState().set({
    index: i,
    positionMs,
    resumeFromMs: positionMs,
    durationMs: track.durationMs,
    isPlaying: false,
    isLoading: false,
  });
}

/**
 * The engine's own hands, for the Listen Together client to apply the room's
 * state with. Nothing here goes back through the room.
 */
export const engineLocal = {
  playIndex: (i: number, resumeMs = 0) => playIndex(i, { resumeMs }),
  setPlaying: setPlayingLocal,
  seek: seekLocal,
  loadPaused: loadPausedLocal,
  isPlaying: actuallyPlaying,
  position: currentPositionMs,
  playBlocked: () => lastPlayBlocked,
  failedTrackId: () => roomFailedId,
  stop: () => {
    ++playSeq;
    stopDecks();
    ytController.pause();
    usePlayer.getState().set({ isPlaying: false, isLoading: false });
  },
};

export function setVolume(v: number) {
  P().set({ volume: Math.min(1, Math.max(0, v)) });
  applySettings();
}

export function setSpeed(v: number) {
  P().set({ speed: Math.min(2, Math.max(0.5, v)) });
  applySettings();
}

/** Toggle between video mode (visible YouTube player) and audio mode. */
export async function setVideoMode(v: boolean) {
  const s = P();
  if (s.videoMode === v) return;
  usePlayer.getState().set({ videoMode: v });
  const track = currentTrack(s);
  if (!track?.videoId || !s.isPlaying) return;

  const pos = P().positionMs;
  if (v) {
    await playIndex(s.index, { resumeMs: pos });
  } else if (nativeCapable === true) {
    ytController.pause();
    await playIndex(s.index, { resumeMs: pos });
  }
  // v=false with native unavailable: iframe keeps playing, FullPlayer hides it.
}

let endingBusy = false;

async function handleEnded() {
  // One end-of-track at a time: the watchdog and the `ended` event can both fire while a
  // queue extension is still in flight, which used to skip two songs at once.
  if (endingBusy) return;
  endingBusy = true;
  try {
    await runEndOfTrack();
  } finally {
    endingBusy = false;
  }
}

async function runEndOfTrack() {
  const s = P();
  endedAt = Date.now();
  const rb = roomBridge();
  if (rb && s.sleepMode === "eot") {
    clearSleepTimer();
    rb.sleep();
    return;
  }
  if (rb) {
    const cur = currentTrack(s);
    if (cur) rb.ended(cur);
    return;
  }
  if (s.sleepMode === "eot") {
    clearSleepTimer();
    if (isIframeMode()) {
      ytController.pause();
      ytController.seekTo(0);
    } else if (actx) {
      decks[active].el.pause();
      decks[active].el.currentTime = 0;
    }
    P().set({ isPlaying: false, positionMs: 0 });
    return;
  }
  if (s.repeat === "one") {
    P().set({ positionMs: 0 });
    if (isIframeMode()) {
      ytController.seekTo(0);
      ytController.resume();
    } else if (actx) {
      decks[active].el.currentTime = 0;
      await decks[active].el.play().catch(() => {});
    }
    return;
  }
  await nextLocal();
}

function stopAtEnd() {
  P().set({ isPlaying: false });
  saveSession();
}

/* --------------------------- progress loop ---------------------------- */

/**
 * Safety net for the "song ends and nothing follows it" case.
 * `requestAnimationFrame` stops while the tab is hidden and a single missed `ENDED`
 * callback (mobile browsers do this to backgrounded tabs) used to be enough to stop the
 * queue forever, so a slow interval also watches the real player state.
 */
let watchdog: ReturnType<typeof setInterval> | null = null;
function startWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    tickListen();
    const s = P();
    if (!s.isPlaying || s.isLoading || fading || !s.queue.length || endingBusy) return;
    if (Date.now() - endedAt < 2000) return;
    if (s.sleepMode === "eot") return;
    if (isIframeMode()) {
      if (ytController.getPlayerState() === 0) void handleEnded(); // ENDED while we still think it plays
    } else if (actx) {
      const deck = decks[active];
      if (deck?.trackId && deck.el.ended) void handleEnded();
    }
  }, 2500);
}

/** Accumulates heard time onto the play log (wall clock, capped per tick). */
function tickListen() {
  const now = Date.now();
  const s = P();
  const cur = currentTrack(s);
  if (lastListenAt && cur && s.isPlaying && !s.isLoading) {
    addListened(cur.id, Math.min(65_000, now - lastListenAt) * (s.speed || 1));
  }
  lastListenAt = now;
}

export function startLoop() {
  startWatchdog();
  if (rafId) return;
  if (!P().isPlaying && !fading) return;

  const loop = () => {
    const curState = P();
    if (!curState.isPlaying && !fading) {
      rafId = 0;
      return;
    }
    rafId = requestAnimationFrame(loop);
    const now = performance.now();

    if (isIframeMode()) {
      if (now - lastTick > 240) {
        lastTick = now;
        tickListen();
        const nextPos = ytController.getTime() * 1000;
        const dur = ytController.getDuration();
        const nextDur = dur ? dur * 1000 : curState.durationMs;
        if (Math.abs(nextPos - curState.positionMs) >= 40 || Math.abs(nextDur - curState.durationMs) >= 100) {
          P().set({
            positionMs: nextPos,
            ...(dur ? { durationMs: nextDur } : {}),
          });
        }
      }
      return;
    }

    if (!actx) return;
    const deck = decks[active];
    if (!deck.trackId) return;
    const t = deck.el.currentTime;
    const dur = deck.el.duration || 0;
    if (now - lastTick > 220) {
      lastTick = now;
      tickListen();
      const nextPos = t * 1000;
      const nextDur = dur ? dur * 1000 : curState.durationMs;
      if (Math.abs(nextPos - curState.positionMs) >= 40 || Math.abs(nextDur - curState.durationMs) >= 100) {
        P().set({ positionMs: nextPos, durationMs: nextDur });
      }
    }
    // In a room the room decides what comes next — no local crossfade or preloading.
    if (roomBridge()) return;
    const { crossfadeSecs, gapless } = S();
    const remaining = dur - t;
    if (
      crossfadeSecs > 0 &&
      !fading &&
      remaining > 0.5 &&
      remaining <= crossfadeSecs &&
      curState.repeat !== "one" &&
      deck.el.playbackRate > 0
    ) {
      void startCrossfade(Math.min(crossfadeSecs, Math.max(1.2, remaining)));
    } else if (gapless && remaining < 9 && !preloadedId) {
      preloadNextSoon();
    }
  };
  rafId = requestAnimationFrame(loop);
}

async function preloadNextSoon() {
  if (isIframeMode() || roomBridge()) return;
  const s = P();
  const ni = nextIndex();
  if (ni === null) return;
  const track = s.queue[ni];
  if (!track || track.id === decks[active].trackId || preloadedId === track.id || !track.videoId) return;
  if (!nativeCapable) return;
  preloadedId = track.id;
  try {
    const idle = decks[1 - active];
    if (idle && !idle.trackId) {
      idle.el.src = `/api/stream?video_id=${track.videoId}&play=1`;
      idle.el.load();
    }
  } catch {
    /* best-effort */
  }
}

async function startCrossfade(secs: number) {
  const s = P();
  const ni = nextIndex();
  if (ni === null) return;
  const track = s.queue[ni];
  if (!track || !track.videoId) return;
  fading = true;
  const seq = ++playSeq;
  const from = decks[active];
  active = 1 - active;
  const to = decks[active];

  usePlayer.getState().set({ index: ni, positionMs: 0, durationMs: track.durationMs, isPlaying: true });

  try {
    if (to.trackId !== track.id || !to.el.src) {
      to.el.src = `/api/stream?video_id=${track.videoId}&play=1`;
    }
    to.el.playbackRate = P().speed;
    to.trackId = track.id;
    await actx!.resume();
    await to.el.play();
  } catch {
    fading = false;
    active = 1 - active;
    return;
  }
  if (seq !== playSeq) {
    fading = false;
    return;
  }

  ramp(to.postGain.gain, 1, secs);
  ramp(from.postGain.gain, 0, secs);
  preloadedId = null;
  playHistory.push(ni);
  updateMediaSession(track);
  recordRecent(track);

  crossfadeTimer = setTimeout(() => {
    crossfadeTimer = null;
    from.el.pause();
    from.el.removeAttribute("src");
    from.el.load();
    from.trackId = null;
    from.postGain.gain.value = 0;
    fading = false;
    preloadNextSoon();
  }, secs * 1000 + 120);
}

/* --------------------------- autoplay fill ---------------------------- */

/** Appends tracks the queue doesn't already contain. Returns true when something landed. */
function appendFresh(candidates: Track[], cur: Track, max = 10): boolean {
  const state = usePlayer.getState();
  const existing = new Set(state.queue.map((t) => t.id));
  const fresh = filterBlocked(candidates)
    .filter((t) => t.id !== cur.id && !existing.has(t.id))
    .slice(0, max);
  if (!fresh.length) return false;
  const tiers = { ...usePlayer.getState().tiers };
  for (const t of fresh) tiers[t.id] = "autoplay";
  usePlayer.getState().set({ queue: [...usePlayer.getState().queue, ...fresh], tiers });
  return true;
}

let autoplayBusy = false;
let autoplayTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Keeps a couple of AutoPlay songs lined up behind the queue, so "what plays
 * after this one" is always visible — and starts instantly — instead of being
 * fetched only once the last song has already ended.
 */
async function ensureAutoplayBuffer() {
  if (roomBridge() || autoplayBusy) return;
  const s = P();
  if (!S().autoplay || s.repeat === "all" || s.index < 0) return;
  if (s.queue.length - s.index - 1 >= 2) return;
  autoplayBusy = true;
  P().set({ autoplayLoading: true });
  try {
    await appendSimilar();
  } catch {
    /* next() will try again at the end of the track */
  } finally {
    autoplayBusy = false;
    P().set({ autoplayLoading: false });
  }
}

function scheduleAutoplayBuffer() {
  if (autoplayTimer) clearTimeout(autoplayTimer);
  autoplayTimer = setTimeout(() => {
    autoplayTimer = null;
    void ensureAutoplayBuffer();
  }, 1800);
}

/**
 * Queue finished -> keep the radio going.
 *
 * First choice is YouTube Music's own "Up next" queue for the current track (the exact
 * songs YTM would play after it, song-radio included) so autoplay feels like the real
 * app instead of a keyword guess. Only when that yields nothing do we fall back to
 * searching for tracks that sound like what just played — several queries are tried in
 * order because "the artist" alone sometimes returns nothing usable (covers, remixes,
 * or a lookup that just failed).
 */
async function appendSimilar(): Promise<boolean> {
  const cur = currentTrack(P());
  if (!cur) return false;

  if (S().ytRadio && cur.videoId) {
    try {
      const res = await api.radio(cur.videoId, 12);
      if (appendFresh(res?.tracks ?? [], cur)) return true;
    } catch {
      /* fall through to the search ladder */
    }
  }

  const seed = (cur.title || "").replace(/\s*\[.*?\]|\s*\(.*?\)|\s*(official|video|audio|lyrics|full song|hd|hq)\s*/gi, " ").replace(/\s+/g, " ").trim();
  const queries = [cur.artist, `${cur.artist} ${seed}`.trim(), seed, cur.album, P().contextLabel.replace(/^Results for\s+|[""]/g, "")]
    .map((q) => (q || "").trim())
    .filter((q) => q.length > 1);
  const seenQ = new Set<string>();
  const order = queries.filter((q) => (seenQ.has(q.toLowerCase()) ? false : (seenQ.add(q.toLowerCase()), true)));

  for (const q of order) {
    try {
      const res = await api.search(q, "songs", S().region, 12);
      if (appendFresh(res.songs, cur, 8)) return true;
    } catch {
      /* try the next seed */
    }
  }
  return false;
}

function filterBlocked(tracks: Track[]): Track[] {
  const blocked: Set<string> = (window as unknown as { __sidifyBlocked?: Set<string> }).__sidifyBlocked || new Set();
  return tracks.filter((t) => !t.artistId || !blocked.has(t.artistId));
}

export function refreshBlockedFilter() {
  const s = P();
  const filtered = filterBlocked(s.queue);
  if (filtered.length !== s.queue.length) {
    const cur = currentTrack(s);
    const newIdx = cur ? filtered.findIndex((t) => t.id === cur.id) : -1;
    usePlayer.getState().set({ queue: filtered, index: newIdx });
  }
}

/* ------------------------------ sessions ------------------------------ */

const SESSION_KEY = "sidify-session";

export function saveSession() {
  try {
    const s = P();
    if (!S().rememberPosition || !s.queue.length) return;
    localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({ queue: s.queue, index: s.index, positionMs: s.positionMs, contextLabel: s.contextLabel })
    );
  } catch {
    /* noop */
  }
}

export function restoreSession() {
  try {
    if (!S().rememberPosition) return;
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return;
    const data = JSON.parse(raw) as { queue: Track[]; index: number; positionMs: number; contextLabel: string };
    if (!data.queue?.length) return;
    usePlayer.getState().set({
      queue: data.queue,
      index: data.index,
      resumeFromMs: data.positionMs || 0,
      positionMs: data.positionMs || 0,
      durationMs: data.queue[data.index]?.durationMs || 0,
      contextLabel: data.contextLabel || "",
      isPlaying: false,
      isLoading: false,
    });
  } catch {
    /* noop */
  }
}

/* ------------------------------ sleep timer --------------------------- */

export function setSleepTimer(minutes: number | "eot") {
  clearSleepTimer();
  if (minutes === "eot") {
    P().set({ sleepMode: "eot", sleepEndsAt: null });
    return;
  }
  const endsAt = Date.now() + minutes * 60_000;
  P().set({ sleepMode: "timer", sleepEndsAt: endsAt });
  sleepTimeout = setTimeout(() => {
    const rb = roomBridge();
    if (rb) {
      clearSleepTimer();
      rb.sleep();
      return;
    }
    if (isIframeMode()) {
      ytController.pause();
      P().set({ isPlaying: false });
    } else {
      void togglePlay();
    }
    clearSleepTimer();
  }, minutes * 60_000);
}

export function clearSleepTimer() {
  if (sleepTimeout) clearTimeout(sleepTimeout);
  sleepTimeout = null;
  P().set({ sleepMode: null, sleepEndsAt: null });
}

/* ------------------------------ media session ------------------------- */

function artworkList(track: Track): MediaImage[] {
  const out: MediaImage[] = [];
  if (track.videoId) {
    out.push(
      { src: `https://i.ytimg.com/vi/${track.videoId}/mqdefault.jpg`, sizes: "320x180", type: "image/jpeg" },
      { src: `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`, sizes: "480x360", type: "image/jpeg" },
      { src: `https://i.ytimg.com/vi/${track.videoId}/maxresdefault.jpg`, sizes: "512x512", type: "image/jpeg" }
    );
  }
  if (track.artwork) out.push({ src: track.artwork, sizes: "512x512", type: "image/jpeg" });
  return out;
}

function updateMediaSession(track: Track) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  if (!S().mediaControls) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || "Sidify",
      artwork: artworkList(track),
    });
    navigator.mediaSession.setActionHandler("play", () => void togglePlay());
    navigator.mediaSession.setActionHandler("pause", () => void togglePlay());
    navigator.mediaSession.setActionHandler("nexttrack", () => void next(true));
    navigator.mediaSession.setActionHandler("previoustrack", () => void prev());
    navigator.mediaSession.setActionHandler("seekbackward", () => seekTo(Math.max(0, P().positionMs - 10_000)));
    navigator.mediaSession.setActionHandler("seekforward", () => seekTo(P().positionMs + 10_000));
    navigator.mediaSession.setActionHandler("seekto", (d) => {
      if (d.seekTime != null) seekTo(d.seekTime * 1000);
    });
  } catch {
    /* noop */
  }
}

let recentTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Push the track into listening history and nudge every open "recent" view to refetch.
 * Re-playing the same song inside 30 s is deduped; after that it counts again, so the
 * History list keeps its chronological order instead of freezing on first play.
 */
function recordRecent(track: Track) {
  const now = Date.now();
  const last = recentRecorded.get(track.id);
  scheduleAutoplayBuffer();
  if (last && now - last < 30_000) return;
  recentRecorded.set(track.id, now);
  logPlay(track);
  void api.pushRecent(track);
  if (recentTimer) clearTimeout(recentTimer);
  recentTimer = setTimeout(() => {
    recentTimer = null;
    emitRefresh("recent");
  }, 800);
}

/* ------------------------------ init ---------------------------------- */

export function initEngine() {
  if (initialized) return;
  initialized = true;
  startLoop();
  armEngineUnlock();
  // Warm the Sidify player at idle, long before the first tap: the player
  // script + iframe boot used to be paid inside the first click, which is
  // what made the first song feel slow. Creating the (paused) player needs
  // no user gesture — only starting playback does.
  const warmIdle = () => ytController.warm(currentTrack(P())?.videoId);
  if (typeof window !== "undefined") {
    const ric = (window as unknown as { requestIdleCallback?: (fn: () => void, opts?: { timeout: number }) => void }).requestIdleCallback;
    if (ric) ric(warmIdle, { timeout: 2500 });
    else setTimeout(warmIdle, 1200);
  }
  // Coming back to the tab: if the OS/iframe paused us mid-track, keep the transport honest.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    const s = P();
    if (s.isPlaying && isIframeMode() && !ytController.isPlaying()) ytController.resume();
  });
  useSettings.subscribe(applySettings);
  usePlayer.subscribe((state, prevState) => {
    if (state.volume !== prevState.volume || state.speed !== prevState.speed) applySettings();
    if (state.isPlaying && !prevState.isPlaying) startLoop();
  });
  window.addEventListener("beforeunload", () => {
    saveSession();
    flushPlayLog();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      saveSession();
      flushPlayLog();
    }
  });
  // Repeat-all / autoplay changes can open a gap behind the current song.
  useSettings.subscribe((st, prevSt) => {
    if (st.autoplay && !prevSt.autoplay) void ensureAutoplayBuffer();
  });
}

export function isEngineReady() {
  return !!actx;
}

/** Numbers for the "Stats for nerds" sheet. */
export function engineStats() {
  const deck = decks[active];
  let bufferedAhead = 0;
  if (deck?.trackId) {
    const t = deck.el.currentTime;
    for (let i = 0; i < deck.el.buffered.length; i++) {
      if (deck.el.buffered.start(i) <= t + 0.25 && deck.el.buffered.end(i) >= t) bufferedAhead = deck.el.buffered.end(i) - t;
    }
  }
  return {
    mode: P().engineMode,
    sampleRate: actx?.sampleRate ?? null,
    contextState: actx?.state ?? "not started",
    baseLatency: actx?.baseLatency ?? null,
    bufferedAhead,
    readyState: deck?.el.readyState ?? 0,
    networkState: deck?.el.networkState ?? 0,
    deck: active,
    crossfading: fading,
    nativeCapable,
    iframeState: ytController.getPlayerState(),
    gain: master?.gain.value ?? null,
  };
}
