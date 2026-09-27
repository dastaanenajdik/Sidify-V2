"use client";

import { usePlayer, currentTrack } from "@/store/player";
import { useSettings, effectiveGains, EQ_BANDS } from "@/store/settings";
import { useUi } from "@/store/ui";
import type { Track } from "./types";
import { offlineObjectUrl } from "./offlineDb";
import { api } from "./clientApi";
import { emitRefresh } from "./refreshBus";
import { ytController } from "./ytPlayer";
import { decideEngineAction, decideHiddenPauseRecovery, needsPlainElement } from "./engineMode";
import { buildReport, diagLog } from "./playbackDiag";

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
let videoBlockedUntil = 0;
let lastModeSwitchAt = -Infinity;
let modeCooldownUntil = 0;
let modeSwitching = false;
let modeRecheck = false;
// This element must NEVER be passed to createMediaElementSource: a suspended graph
// silences even an otherwise-playing media element connected to it.
let plainAudio: HTMLAudioElement | null = null;
let restoringPlain: HTMLAudioElement | null = null;
let hiddenWatch: ReturnType<typeof setInterval> | null = null;
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
 * Phones are where the background rules bite: Android Chrome / iOS Safari stop rendering
 * a media element that is routed through Web Audio once the page is hidden or the screen
 * is locked, and they do it silently (no AudioContext state event), so the engine has to
 * switch element *before* the tab is frozen. Desktop keeps the DSP graph.
 */
function isMobileLike(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/Android|iPhone|iPad|iPod|Mobile|SamsungBrowser/i.test(ua)) return true;
  // iPadOS 13+ reports itself as a Mac, but has a touch screen.
  return /Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1;
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
  actx.addEventListener("statechange", () => {
    if (document.visibilityState === "hidden") watchHiddenPlayback();
  });
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
    if (i === active && !plainAudio && !fading && !isIframeMode()) void handleEnded();
  });
  el.addEventListener("error", () => {
    if (i === active && !plainAudio && !isIframeMode()) handleTrackError();
  });
  el.addEventListener("pause", () => {
    // Deferred on purpose: `pause()` fires synchronously, so an intentional pause
    // (toggle, handoff) must finish updating the store first.
    if (i === active) queueMicrotask(() => noteHiddenPause(`deck${i}`));
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
  if (plainAudio) {
    plainAudio.volume = p.volume * (s.normalization ? 0.82 : 1);
    plainAudio.playbackRate = p.speed;
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

/* ---------------------- background native audio ----------------------- */

function nativeElement(): HTMLAudioElement | undefined {
  return plainAudio ?? decks[active]?.el;
}

function stopPlainAudio() {
  const el = plainAudio;
  plainAudio = null;
  restoringPlain = null;
  if (!el) return;
  el.pause();
  el.removeAttribute("src");
  el.load();
}

function shouldUsePlainAudio() {
  return needsPlainElement({
    hidden: document.visibilityState === "hidden",
    playing: P().isPlaying,
    engine: P().engineMode,
    ctxRunning: actx?.state === "running",
    mobile: isMobileLike(),
  });
}

/**
 * A pause while the tab is off-screen is the browser's decision, not the user's: log it
 * (Settings → System → “Copy report” hands that log to the user) and try to get the audio
 * back.
 */
function noteHiddenPause(source: string) {
  if (typeof document === "undefined" || document.visibilityState !== "hidden") return;
  if (!P().isPlaying || P().isLoading) return; // We asked for this pause (or a track is loading).
  if (source === "plain" && !plainAudio) return; // Element already replaced by a handoff/restore.
  if (source.startsWith("deck") && plainAudio) return; // Decks idle on purpose while plain audio plays.
  diagLog("PAUSE-WHILE-HIDDEN", `${source} · engine=${P().engineMode ?? "?"} ctx=${actx?.state ?? "none"} plain=${plainAudio ? "yes" : "no"}`);
  recoverFromHiddenPause(source);
}

function recoverFromHiddenPause(source: string) {
  const s = P();
  const decision = decideHiddenPauseRecovery({
    hidden: document.visibilityState === "hidden",
    wantedPlaying: s.isPlaying && !s.isLoading,
    engine: isIframeMode() ? "iframe" : "native",
    plainActive: !!plainAudio,
    plainPaused: !!plainAudio?.paused,
    attempts: hiddenPauseAttempts,
  });
  if (decision === "none") return;
  hiddenPauseAttempts++;
  diagLog("recover", `${source} → ${decision}`);
  if (decision === "iframe-resume") {
    ytController.resume();
    return;
  }
  if (decision === "plain-resume") {
    void plainAudio?.play().catch((err) => diagLog("recover-failed", `plain-resume · ${(err as Error)?.name}`));
    return;
  }
  void handoffToPlainAudio();
}

async function handoffToPlainAudio() {
  const deck = decks[active];
  if (plainAudio || !deck?.trackId || !deck.el.src || !shouldUsePlainAudio()) return;
  const el = new Audio();
  el.preload = "auto";
  el.src = deck.el.src;
  el.currentTime = deck.el.currentTime;
  plainAudio = el;
  diagLog("plain-handoff", `pos=${Math.round(deck.el.currentTime)}s`);
  if (crossfadeTimer) clearTimeout(crossfadeTimer);
  crossfadeTimer = null;
  fading = false;
  for (const d of decks) d.el.pause();
  for (const d of decks) d.postGain.gain.cancelScheduledValues(actx!.currentTime);
  decks[1 - active].postGain.gain.value = 0;
  deck.postGain.gain.value = 1;
  applySettings();
  el.addEventListener("ended", () => {
    if (plainAudio === el && !isIframeMode()) void handleEnded();
  });
  el.addEventListener("error", () => {
    if (plainAudio === el && !isIframeMode()) handleTrackError();
  });
  el.addEventListener("pause", () => queueMicrotask(() => noteHiddenPause("plain")));
  try {
    await el.play();
  } catch (err) {
    // A track change/stop can abort this play promise. Never stop its replacement.
    if (plainAudio !== el) return;
    diagLog("plain-handoff-failed", `${(err as Error)?.name}`);
    P().set({ isPlaying: false, isLoading: false });
  }
}

async function restoreNativeDeck() {
  const el = plainAudio;
  if (!el || !actx || restoringPlain === el) return;
  restoringPlain = el;
  const seq = playSeq;
  try {
    await actx.resume();
    if (plainAudio !== el || seq !== playSeq || isIframeMode() ||
        document.visibilityState !== "visible" || actx.state !== "running") return;
    const deck = decks[active];
    const position = el.currentTime;
    el.pause();
    deck.el.currentTime = position;
    stopPlainAudio();
    diagLog("deck-restore", `pos=${Math.round(position)}s`);
    P().set({ positionMs: position * 1000 });
    if (P().isPlaying) {
      try {
        await deck.el.play();
      } catch {
        if (seq === playSeq && !plainAudio) P().set({ isPlaying: false });
      }
    }
  } catch {
    // Keep the plain element playing if the browser still refuses the graph.
  } finally {
    if (restoringPlain === el) restoringPlain = null;
  }
}

function watchHiddenPlayback() {
  if (document.visibilityState !== "hidden") return;
  void reconcileEngineMode();
  if (!P().isLoading) void handoffToPlainAudio();
  const el = nativeElement();
  if (!isIframeMode() && !P().isLoading && el && decks[active]?.trackId) {
    P().set({ positionMs: el.currentTime * 1000 });
  }
}

function startHiddenWatch() {
  if (!hiddenWatch) hiddenWatch = setInterval(watchHiddenPlayback, 3000);
  watchHiddenPlayback();
}

/* ------------------------- mode selection ----------------------------- */

function videoWanted() {
  const s = P();
  return s.videoMode && s.fullPlayerOpen && document.visibilityState === "visible" &&
    Date.now() >= videoBlockedUntil;
}

async function reconcileEngineMode(force = false) {
  if (modeSwitching) {
    modeRecheck ||= force;
    return;
  }
  let s = P();
  const now = Date.now();
  const action = decideEngineAction({
    playing: s.isPlaying,
    loading: s.isLoading,
    engine: s.engineMode,
    videoMode: s.videoMode,
    playerOpen: s.fullPlayerOpen,
    appVisible: document.visibilityState === "visible",
    hasVideo: !!currentTrack(s)?.videoId,
    iframePaused: ytController.getPlayerState() === 2,
    videoBlocked: now < videoBlockedUntil,
  });
  if (action === "none" || now < modeCooldownUntil || (!force && now - lastModeSwitchAt < 1200)) return;
  lastModeSwitchAt = now;
  if (action === "resume-video") {
    ytController.resume();
    return;
  }
  // rAF is stopped in the background and the hidden watch only ticks every 3s.
  // Capture the live transport clock before switching, not its last UI sample.
  const track = currentTrack(s);
  if (isIframeMode() && ytController.currentVideoId === track?.videoId) {
    s.set({ positionMs: ytController.getTime() * 1000 });
  } else if (s.engineMode === "native" && decks[active]?.trackId === track?.id) {
    s.set({ positionMs: nativeElement()!.currentTime * 1000 });
  }
  s = P();
  modeSwitching = true;
  const expected = action === "play-video" ? "iframe" : "native";
  const seq = playSeq + 1;
  try {
    await playIndex(s.index, { resumeMs: s.positionMs });
    // chooseMode may fall back to iframe when extraction is unavailable. That is
    // also a failed switch: do not reload the same song every watchdog tick.
    if (seq === playSeq && (P().engineMode !== expected || !P().isPlaying)) {
      modeCooldownUntil = Date.now() + 30_000;
    }
  } catch {
    if (seq === playSeq) modeCooldownUntil = Date.now() + 30_000;
  } finally {
    modeSwitching = false;
    if (modeRecheck) {
      modeRecheck = false;
      void reconcileEngineMode(true);
    }
  }
}

/**
 * "Can this environment extract full-length audio?" is answered by probing /api/stream.
 * The probe is *allowed* to take a while (YouTube extraction is slow), but it must not
 * hold up the very first play: after `PROBE_WAIT_MS` we stop waiting and start the
 * YouTube-iframe player instead, while the probe keeps running and caches its verdict for
 * every track after this one.
 */
const PROBE_WAIT_MS = 2500;

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
  if (videoWanted() && track.videoId) return "iframe";
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
  hiddenPauseAttempts = 0;
  stopPlainAudio();
  unlockEngine();

  usePlayer.getState().set({
    index: i,
    isLoading: true,
    isPlaying: true,
    positionMs: opts?.resumeMs ?? 0,
    durationMs: track.durationMs,
  });

  const mode = await chooseMode(track, seq);
  if (seq !== playSeq) return;
  if (mode) diagLog("mode", `${mode} · ${track.videoId ?? "no-video"}`);
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
    videoBlockedUntil = Date.now() + 60_000;
    // The embed engine itself failed (blocked script, offline, extension). If direct
    // extraction is available, use it instead of giving up on the track.
    if (await probeNative(track)) {
      if (seq !== playSeq) return;
      await playNative(track, P().index, seq, resumeMs);
      return;
    }
    if (seq !== playSeq) return;
    usePlayer.getState().set({ isPlaying: false, isLoading: false });
    toast("Couldn't start the YouTube player");
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
  if (seq !== playSeq) return;
  ensureCtx();
  P().set({ engineMode: "native" });
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
  stopPlainAudio();
  to.el.pause();
  to.el.src = url;
  to.el.playbackRate = P().speed;
  to.trackId = track.id;
  to.postGain.gain.value = 1;
  to.el.currentTime = Math.max(0, resumeMs / 1000);
  try {
    if (shouldUsePlainAudio()) {
      await handoffToPlainAudio();
    } else {
      await actx!.resume();
      if (seq !== playSeq) return;
      // The hidden watch may have handed off while resume() was pending.
      if (!plainAudio) {
        if (shouldUsePlainAudio()) await handoffToPlainAudio();
        else await to.el.play();
      }
    }
  } catch (err) {
    if (seq !== playSeq) return;
    // Decoding/container failures are engine-specific, not track-specific: give this
    // track to the embed player and stop trusting native extraction for a while.
    // (A rejected play() from the autoplay policy is NOT retried - the iframe would be
    // blocked by exactly the same rule.)
    const name = (err as { name?: string } | null)?.name;
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
        if (seq !== playSeq) return;
        void playNative(track, s.index, seq, resumeMs);
        return;
      }
      if (seq !== playSeq) return;
      usePlayer.getState().set({ isPlaying: false, isLoading: false });
      toast("Playback couldn't start", "Tap play again, or try another song");
    })();
  }, 8000);
}

function stopDecks() {
  stopPlainAudio();
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
    onEnded: () => {
      if (isIframeMode() && !P().isLoading) void handleEnded();
    },
    onState: (playing) => {
      if (!isIframeMode() || P().isLoading) return;
      // Offscreen iframe pauses are browser policy, not a user pause. Preserve
      // playback intent so the visibility/player-close handoff can still run.
      if (!playing && P().isPlaying && !videoWanted()) {
        noteHiddenPause("iframe");
        void reconcileEngineMode(true);
        return;
      }
      P().set({ isPlaying: playing });
    },
    onError: () => {
      if (isIframeMode() && !modeSwitching) handleTrackError();
    },
  });
}

function handleTrackError() {
  const s = P();
  errorSkips++;
  if (errorSkips > 8) {
    toast("Several videos are unavailable right now", "Playback paused");
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
  const target = Math.min(startIndex, filtered.length - 1);
  preloadedId = null;
  usePlayer.getState().set({ queue: filtered, contextLabel: label, resumeFromMs: 0 });
  void playIndex(target);
}

export function playTrackNow(track: Track) {
  unlockEngine();
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
  unlockEngine();
  const s = P();
  const track = currentTrack(s);
  if (!track) return;

  if (isIframeMode()) {
    if (s.isPlaying) {
      P().set({ isPlaying: false });
      ytController.pause();
      saveSession();
    } else {
      if (ytController.currentVideoId !== track.videoId) {
        await playIndex(s.index, { resumeMs: s.resumeFromMs || s.positionMs });
        usePlayer.getState().set({ resumeFromMs: 0 });
        return;
      }
      ytController.resume();
      P().set({ isPlaying: true });
      void reconcileEngineMode(true);
    }
    return;
  }

  if (plainAudio) {
    const el = plainAudio;
    if (s.isPlaying) {
      el.pause();
      P().set({ isPlaying: false });
      saveSession();
    } else {
      try {
        await el.play();
        if (plainAudio === el) P().set({ isPlaying: true });
      } catch { /* autoplay denied: keep transport paused */ }
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
    P().set({ isPlaying: true });
    if (shouldUsePlainAudio()) await handoffToPlainAudio();
    else {
      await actx!.resume();
      await deck.el.play().catch(() => { P().set({ isPlaying: false }); });
    }
    void reconcileEngineMode(true);
  } else {
    deck.el.pause();
    P().set({ isPlaying: false });
    saveSession();
  }
}

export async function next(manual = true) {
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
  if (isIframeMode()) {
    if (ytController.getTime() > 4) {
      ytController.seekTo(0);
      P().set({ positionMs: 0 });
      return;
    }
  } else if (actx && nativeElement()!.currentTime > 4) {
    nativeElement()!.currentTime = 0;
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
  const el = nativeElement()!;
  if (el.seekable.length === 0 && el.readyState < 2) return;
  el.currentTime = Math.max(0, ms / 1000);
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
  P().set({ videoMode: v });
  await reconcileEngineMode(true);
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
  if (s.sleepMode === "eot") {
    P().set({ isPlaying: false });
    clearSleepTimer();
    if (isIframeMode()) {
      ytController.pause();
      ytController.seekTo(0);
    } else if (actx) {
      nativeElement()!.pause();
      nativeElement()!.currentTime = 0;
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
      nativeElement()!.currentTime = 0;
      await nativeElement()!.play().catch(() => {});
    }
    return;
  }
  await next(false);
}

function stopAtEnd() {
  P().set({ isPlaying: false });
  ytController.pause();
  stopDecks();
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
let lastSessionTick = 0;
let hiddenPauseAttempts = 0;
function startWatchdog() {
  if (watchdog) return;
  watchdog = setInterval(() => {
    void reconcileEngineMode();
    const s = P();
    if (!s.isPlaying || s.isLoading || fading || !s.queue.length || endingBusy) return;
    if (Date.now() - endedAt < 2000) return;
    if (s.sleepMode === "eot") return;
    if (isIframeMode()) {
      if (ytController.getPlayerState() === 0) void handleEnded(); // ENDED while we still think it plays
    } else if (actx) {
      const deck = decks[active];
      if (deck?.trackId && nativeElement()?.ended) void handleEnded();
    }
  }, 2500);
}

export function startLoop() {
  if (rafId) return;
  startWatchdog();
  const loop = () => {
    rafId = requestAnimationFrame(loop);
    const now = performance.now();

    if (P().isLoading) return;
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
      if (now - lastSessionTick > 1000) {
        lastSessionTick = now;
        updateMediaSessionState();
      }
      return;
    }

    if (!actx) return;
    const deck = decks[active];
    if (!deck.trackId) return;
    const el = nativeElement()!;
    const t = el.currentTime;
    const dur = el.duration || 0;
    if (now - lastTick > 220) {
      lastTick = now;
      P().set({ positionMs: t * 1000, durationMs: dur ? dur * 1000 : P().durationMs });
    }
    if (now - lastSessionTick > 1000) {
      lastSessionTick = now;
      updateMediaSessionState();
    }
    if (plainAudio) return; // DSP/crossfade is unavailable on the plain element.
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
  if (isIframeMode() || plainAudio) return;
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

/**
 * Queue finished -> keep the radio going. Searches for tracks that sound like what just
 * played and appends them. Several queries are tried in order because "the artist" alone
 * sometimes returns nothing usable (covers, remixes, or a lookup that just failed).
 */
async function appendSimilar(): Promise<boolean> {
  const cur = currentTrack(P());
  if (!cur) return false;
  const seed = (cur.title || "").replace(/\s*\[.*?\]|\s*\(.*?\)|\s*(official|video|audio|lyrics|full song|hd|hq)\s*/gi, " ").replace(/\s+/g, " ").trim();
  const queries = [cur.artist, `${cur.artist} ${seed}`.trim(), seed, cur.album, P().contextLabel.replace(/^Results for\s+|[""]/g, "")]
    .map((q) => (q || "").trim())
    .filter((q) => q.length > 1);
  const seenQ = new Set<string>();
  const order = queries.filter((q) => (seenQ.has(q.toLowerCase()) ? false : (seenQ.add(q.toLowerCase()), true)));

  for (const q of order) {
    try {
      const res = await api.search(q, "songs", S().region, 12);
      const state = usePlayer.getState();
      const existing = new Set(state.queue.map((t) => t.id));
      const fresh = filterBlocked(res.songs)
        .filter((t) => t.id !== cur.id && !existing.has(t.id))
        .slice(0, 8);
      if (!fresh.length) continue;
      usePlayer.getState().set({ queue: [...usePlayer.getState().queue, ...fresh] });
      return true;
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
    P().set({ isPlaying: false });
    ytController.pause();
    nativeElement()?.pause();
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

function mediaSession(): (MediaSession & { setPositionState?: (state?: MediaPositionState) => void }) | null {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return null;
  return navigator.mediaSession as MediaSession & { setPositionState?: (state?: MediaPositionState) => void };
}

/**
 * Keep the OS session honest. Android uses `playbackState` + the position state to decide
 * whether the notification is a *live* media session — a session that still claims
 * "playing" while the transport is paused keeps the underlying tab awake (and the reverse
 * makes the lock-screen controls fight the app). Called on every state change and once a
 * second from the progress loop.
 */
export function updateMediaSessionState() {
  const ms = mediaSession();
  if (!ms) return;
  const s = P();
  try {
    ms.playbackState = s.isPlaying ? "playing" : "paused";
  } catch {
    /* older engines expose a read-only playbackState */
  }
  if (typeof ms.setPositionState !== "function" || !(s.durationMs > 0) || !Number.isFinite(s.durationMs)) return;
  const duration = s.durationMs / 1000;
  try {
    ms.setPositionState({
      duration,
      position: Math.max(0, Math.min(s.positionMs / 1000, duration)),
      playbackRate: s.speed,
    });
  } catch {
    /* a bad duration/position throws instead of clamping */
  }
}

function updateMediaSession(track: Track) {
  if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
  if (!S().mediaControls) return;
  const ms = mediaSession()!;
  try {
    ms.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: "Sidify",
      artwork: artworkList(track),
    });
    const key = (name: string) => () => diagLog("mediakey", name);
    ms.setActionHandler("play", () => {
      key("play")();
      void togglePlay();
    });
    ms.setActionHandler("pause", () => {
      key("pause")();
      void togglePlay();
    });
    ms.setActionHandler("nexttrack", () => {
      key("next")();
      void next(true);
    });
    ms.setActionHandler("previoustrack", () => {
      key("prev")();
      void prev();
    });
    ms.setActionHandler("seekbackward", () => seekTo(Math.max(0, P().positionMs - 10_000)));
    ms.setActionHandler("seekforward", () => seekTo(P().positionMs + 10_000));
    ms.setActionHandler("seekto", (d) => {
      if (d.seekTime != null) seekTo(d.seekTime * 1000);
    });
    updateMediaSessionState();
  } catch {
    /* noop */
  }
}

/* ----------------------- diagnostics for the report ------------------- */

export type EngineStatus = "idle" | "native-plain" | "native-graph" | "embed";

export interface EngineDiag {
  status: EngineStatus;
  /** Human label for Settings. */
  label: string;
  /** True when screen-off playback is expected to survive in this browser. */
  backgroundSafe: boolean;
  engine: "native" | "iframe" | null;
  hidden: boolean;
  mobile: boolean;
  ctxState: string;
  plainActive: boolean;
  ytState: number;
  mediaSessionPlaying: string | null;
}

/** Live engine snapshot — used by the Settings status row and the copied report. */
export function getEngineDiag(): EngineDiag {
  const s = P();
  const mobile = isMobileLike();
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  const plainActive = !!plainAudio;
  const status: EngineStatus =
    !s.engineMode ? "idle" : s.engineMode === "iframe" ? "embed" : plainActive ? "native-plain" : "native-graph";
  const label =
    status === "native-plain"
      ? "Native audio · plain element (background-safe)"
      : status === "native-graph"
        ? mobile
          ? "Native audio · Web Audio graph (hands off to plain audio when the screen goes off)"
          : "Native audio · Web Audio graph (EQ active)"
        : status === "embed"
          ? "YouTube embed — Chrome pauses embeds on screen-off; Brave keeps them playing"
          : "Idle";
  let sessionPlaying: string | null = null;
  try {
    sessionPlaying = mediaSession()?.playbackState ?? null;
  } catch {
    sessionPlaying = null;
  }
  return {
    status,
    label,
    backgroundSafe: status === "native-plain" || (status === "native-graph" && !mobile),
    engine: s.engineMode,
    hidden,
    mobile,
    ctxState: actx?.state ?? "none",
    plainActive,
    ytState: ytController.getPlayerState?.() ?? -1,
    mediaSessionPlaying: sessionPlaying,
  };
}

/** Clipboard-ready evidence for "it still pauses on my phone". */
export function playbackReport(): string {
  const s = P();
  const d = getEngineDiag();
  const track = currentTrack(s);
  const nav = typeof navigator === "undefined" ? null : navigator;
  const standalone =
    typeof window !== "undefined" && window.matchMedia?.("(display-mode: standalone)").matches ? "yes" : "no";
  return buildReport({
    fields: [
      ["engine", `${d.engine ?? "none"} (${d.status})`],
      ["playing / loading", `${s.isPlaying} / ${s.isLoading}`],
      ["screen", d.hidden ? "hidden (screen off / other app)" : "visible"],
      ["audio-context", d.ctxState],
      ["plain-element", d.plainActive ? "active" : "no"],
      ["iframe-state", String(d.ytState)],
      ["media-session", d.mediaSessionPlaying ?? "unsupported"],
      ["position", `${Math.round(s.positionMs / 1000)}s of ${Math.round(s.durationMs / 1000)}s`],
      ["video-preference", String(s.videoMode)],
      ["track", track ? `${track.title} — ${track.artist}` : "none"],
      ["installed (PWA)", standalone],
      ["mobile-like UA", String(d.mobile)],
      ["user-agent", nav?.userAgent ?? "unknown"],
    ],
  });
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
  if (last && now - last < 30_000) return;
  recentRecorded.set(track.id, now);
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
  document.addEventListener("visibilitychange", () => {
    diagLog("visibility", document.visibilityState);
    updateMediaSessionState();
    void reconcileEngineMode(true);
    if (document.visibilityState === "hidden") {
      hiddenPauseAttempts = 0;
      startHiddenWatch();
      saveSession();
    } else {
      hiddenPauseAttempts = 0;
      if (hiddenWatch) clearInterval(hiddenWatch);
      hiddenWatch = null;
      if (plainAudio) void restoreNativeDeck();
      else void actx?.resume().catch(() => {});
    }
  });
  if (document.visibilityState === "hidden") startHiddenWatch();
  useSettings.subscribe(applySettings);
  usePlayer.subscribe((state, prevState) => {
    if (state.volume !== prevState.volume || state.speed !== prevState.speed) applySettings();
    if (state.isPlaying !== prevState.isPlaying) updateMediaSessionState();
    if (state.fullPlayerOpen !== prevState.fullPlayerOpen || state.videoMode !== prevState.videoMode) {
      void reconcileEngineMode(true);
    }
    // A visibility/preference change during loading must not be lost.
    if (prevState.isLoading && !state.isLoading) {
      queueMicrotask(() => { void reconcileEngineMode(true); });
    }
  });
  window.addEventListener("beforeunload", saveSession);
}

export function isEngineReady() {
  return !!actx;
}
