"use client";

import { usePlayer, currentTrack } from "@/store/player";
import { useSettings, effectiveGains, EQ_BANDS } from "@/store/settings";
import { useUi } from "@/store/ui";
import type { Track } from "./types";
import { offlineObjectUrl } from "./offlineDb";
import { api } from "./clientApi";
import { ytController } from "./ytPlayer";

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
let nativeCapable: boolean | null = null;
let nativeProbeAt = 0;
let errorSkips = 0;
let ytWired = false;
const recentRecorded = new Set<string>();
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

async function probeNative(track: Track): Promise<boolean> {
  if (nativeCapable !== null && Date.now() - nativeProbeAt < 5 * 60_000) return nativeCapable;
  if (!track.videoId) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 24_000);
    const res = await fetch(`/api/stream?video_id=${track.videoId}`, { signal: ctrl.signal });
    clearTimeout(t);
    nativeCapable = res.ok;
    nativeProbeAt = Date.now();
    return nativeCapable;
  } catch {
    nativeCapable = false;
    nativeProbeAt = Date.now();
    return false;
  }
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
    if (seq === playSeq) {
      usePlayer.getState().set({ isPlaying: false, isLoading: false });
      toast("Couldn't start the YouTube player");
    }
    return;
  }
  if (seq !== playSeq) return;
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
  } catch {
    if (seq === playSeq) P().set({ isPlaying: false, isLoading: false });
    return;
  }
  if (seq !== playSeq) return;
  playHistory.push(i);
  if (playHistory.length > 40) playHistory.shift();
  errorSkips = 0;
  P().set({ isLoading: false });
  updateMediaSession(track);
  recordRecent(track);
  preloadNextSoon();
}

function stopDecks() {
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
      if (isIframeMode()) P().set({ isPlaying: playing });
    },
    onError: () => handleTrackError(),
  });
}

function handleTrackError() {
  const s = P();
  errorSkips++;
  if (errorSkips > 4) {
    toast("Several videos are unavailable right now", "Playback paused");
    P().set({ isPlaying: false, isLoading: false });
    return;
  }
  const ni = nextIndex();
  if (ni === null) {
    toast("This video is unavailable", currentTrack(s)?.title);
    P().set({ isPlaying: false, isLoading: false });
    return;
  }
  toast("Video unavailable — skipping", currentTrack(s)?.title, "info");
  void playIndex(ni);
}

export function playContext(tracks: Track[], startIndex: number, label = "") {
  const filtered = filterBlocked(tracks);
  if (!filtered.length) return;
  const target = Math.min(startIndex, filtered.length - 1);
  preloadedId = null;
  usePlayer.getState().set({ queue: filtered, contextLabel: label, resumeFromMs: 0 });
  void playIndex(target);
}

export function playTrackNow(track: Track) {
  const s = P();
  const existing = s.queue.findIndex((t) => t.id === track.id);
  if (existing >= 0) {
    void playIndex(existing);
    return;
  }
  const insertAt = Math.max(0, s.index + 1);
  const queue = [...s.queue];
  queue.splice(insertAt, 0, track);
  usePlayer.getState().set({ queue, contextLabel: "Single track", resumeFromMs: 0 });
  void playIndex(insertAt);
}

export function playNextInQueue(track: Track) {
  const s = P();
  const queue = s.queue.filter((t) => t.id !== track.id);
  queue.splice(Math.max(0, s.index + 1), 0, track);
  usePlayer.getState().set({ queue });
}

export function addToQueueEnd(track: Track) {
  const s = P();
  if (s.queue.some((t) => t.id === track.id)) return;
  usePlayer.getState().set({ queue: [...s.queue, track] });
  if (s.index < 0) void playIndex(0);
}

export function moveInQueue(from: number, to: number) {
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
  const s = P();
  if (i < 0 || i >= s.queue.length || i === s.index) return;
  const queue = s.queue.filter((_, idx) => idx !== i);
  const index = i < s.index ? s.index - 1 : s.index;
  usePlayer.getState().set({ queue, index });
}

export function setQueue(next: Track[], index: number) {
  usePlayer.getState().set({ queue: next, index });
}

export async function togglePlay() {
  const s = P();
  const track = currentTrack(s);
  if (!track) return;

  if (isIframeMode()) {
    if (ytController.isPlaying()) {
      ytController.pause();
      P().set({ isPlaying: false });
      saveSession();
    } else {
      if (ytController.currentVideoId !== track.videoId) {
        await playIndex(s.index, { resumeMs: s.resumeFromMs || s.positionMs });
        usePlayer.getState().set({ resumeFromMs: 0 });
        return;
      }
      ytController.resume();
      P().set({ isPlaying: true });
    }
    return;
  }

  ensureCtx();
  const deck = decks[active];
  if (deck.trackId !== track.id) {
    await playIndex(s.index, { resumeMs: s.resumeFromMs || s.positionMs });
    usePlayer.getState().set({ resumeFromMs: 0 });
    return;
  }
  if (deck.el.paused) {
    await actx!.resume();
    await deck.el.play().catch(() => {});
    P().set({ isPlaying: true });
  } else {
    deck.el.pause();
    P().set({ isPlaying: false });
    saveSession();
  }
}

export async function next(manual = true) {
  const s = P();
  if (!s.queue.length || fading) return;
  let ni = nextIndex();
  if (ni === null) {
    if (!manual && S().autoplay) {
      const appended = await appendSimilar();
      if (appended) ni = P().index + 1;
    }
    if (ni === null || ni >= P().queue.length) {
      if (manual && s.repeat === "off" && s.index === s.queue.length - 1) return;
      stopAtEnd();
      return;
    }
  }
  await playIndex(ni);
}

export async function prev() {
  const s = P();
  if (!s.queue.length) return;
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
  if (isIframeMode()) {
    ytController.seekTo(ms / 1000);
    P().set({ positionMs: ms });
    return;
  }
  if (!actx) return;
  const deck = decks[active];
  if (deck.el.seekable.length === 0 && deck.el.readyState < 2) return;
  deck.el.currentTime = Math.max(0, ms / 1000);
  P().set({ positionMs: ms });
}

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

async function handleEnded() {
  const s = P();
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
  await next(false);
}

function stopAtEnd() {
  P().set({ isPlaying: false });
  saveSession();
}

/* --------------------------- progress loop ---------------------------- */

export function startLoop() {
  if (rafId) return;
  const loop = () => {
    rafId = requestAnimationFrame(loop);
    const now = performance.now();

    if (isIframeMode()) {
      if (now - lastTick > 240) {
        lastTick = now;
        const t = ytController.getTime();
        const dur = ytController.getDuration();
        P().set({
          positionMs: t * 1000,
          ...(dur ? { durationMs: dur * 1000 } : {}),
        });
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
      P().set({ positionMs: t * 1000, durationMs: dur ? dur * 1000 : P().durationMs });
    }
    const { crossfadeSecs, gapless } = S();
    const s = P();
    const remaining = dur - t;
    if (
      crossfadeSecs > 0 &&
      !fading &&
      remaining > 0.5 &&
      remaining <= crossfadeSecs &&
      s.repeat !== "one" &&
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
  if (isIframeMode()) return;
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
  if (seq !== playSeq) return;

  ramp(to.postGain.gain, 1, secs);
  ramp(from.postGain.gain, 0, secs);
  preloadedId = null;
  playHistory.push(ni);
  updateMediaSession(track);
  recordRecent(track);

  setTimeout(() => {
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

async function appendSimilar(): Promise<boolean> {
  const s = P();
  const cur = currentTrack(s);
  if (!cur) return false;
  try {
    const res = await api.search(cur.artist, "songs", S().region, 10);
    const existing = new Set(s.queue.map((t) => t.id));
    const fresh = filterBlocked(res.songs).filter((t) => !existing.has(t.id)).slice(0, 8);
    if (!fresh.length) return false;
    usePlayer.getState().set({ queue: [...usePlayer.getState().queue, ...fresh] });
    return true;
  } catch {
    return false;
  }
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
      album: "Sidify",
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

function recordRecent(track: Track) {
  if (recentRecorded.has(track.id)) return;
  recentRecorded.add(track.id);
  void api.pushRecent(track);
}

/* ------------------------------ init ---------------------------------- */

export function initEngine() {
  if (initialized) return;
  initialized = true;
  startLoop();
  useSettings.subscribe(applySettings);
  usePlayer.subscribe((state, prevState) => {
    if (state.volume !== prevState.volume || state.speed !== prevState.speed) applySettings();
  });
  window.addEventListener("beforeunload", saveSession);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveSession();
  });
}

export function isEngineReady() {
  return !!actx;
}
