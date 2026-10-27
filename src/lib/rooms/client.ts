"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Track } from "@/lib/types";
import { usePlayer, currentTrack } from "@/store/player";
import { useUi } from "@/store/ui";
import { useSettings } from "@/store/settings";
import { engineLocal, unlockEngine } from "@/lib/audioEngine";
import { setRoomBridge, type RoomBridge } from "./bridge";
import {
  ROOM_LIMITS,
  currentOf,
  expectedPosition,
  newlyLeftMembers,
  normalizeCode,
  type ControlAction,
  type RoomSignal,
  type RoomState,
  type RoomTrack,
} from "./logic";

/* -------------------------------------------------------------------------- */
/*  Listen Together — client.                                                  */
/*                                                                             */
/*  Polls the room every 500ms while visible (also the heartbeat), keeps a    */
/*  server-clock offset from the fastest round trips, and drives the local     */
/*  engine to match: same track, same play/pause, same position. Local intents */
/*  go to the room through the engine's bridge and come back as room state.    */
/* -------------------------------------------------------------------------- */

interface Session {
  code: string;
  token: string;
  memberId: string;
  name?: string;
}

export type RoomStatus = "idle" | "connecting" | "live" | "reconnecting";

interface RoomClientState {
  session: Session | null;
  room: RoomState | null;
  status: RoomStatus;
  rttMs: number | null;
  offsetMs: number;
  /** The browser refused to start audio — a tap will fix it. */
  needsTap: boolean;
  /** ms since each member last checked in, refreshed by cheap polls. */
  presence: Record<string, number>;
  /** A persisted room seat can be explicitly resumed after leaving the app. */
  resumePrompt: boolean;
  set: (p: Partial<RoomClientState>) => void;
}

export const useRoom = create<RoomClientState>()(
  persist(
    (set) => ({
      session: null,
      room: null,
      status: "idle",
      rttMs: null,
      offsetMs: 0,
      needsTap: false,
      presence: {},
      resumePrompt: false,
      set: (p) => set(p),
    }),
    { name: "sidify-room", skipHydration: true, partialize: (s) => ({ session: s.session }) }
  )
);

const R = () => useRoom.getState();

function toast(title: string, desc?: string, kind: "ok" | "info" | "warn" = "info") {
  useUi.getState().pushToast({ title, desc, kind });
}

export function toTrack(t: RoomTrack): Track {
  return {
    id: t.id,
    videoId: t.videoId,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId,
    album: t.album,
    albumId: t.albumId,
    artwork: t.artwork,
    previewUrl: "",
    durationMs: t.durationMs,
    explicit: t.explicit,
  };
}

function toRoomTrack(t: Track): RoomTrack {
  return {
    id: t.id,
    videoId: t.videoId,
    title: t.title,
    artist: t.artist,
    artistId: t.artistId,
    album: t.album,
    albumId: t.albumId,
    artwork: t.artwork,
    durationMs: t.durationMs,
    explicit: t.explicit,
  };
}

/* ---------------------------------- clock ---------------------------------- */

const samples: { rtt: number; offset: number }[] = [];

function sample(t0: number, t1: number, serverMs: unknown) {
  const s = Number(serverMs);
  if (!Number.isFinite(s)) return;
  const rtt = Math.max(0, t1 - t0);
  samples.push({ rtt, offset: s - (t0 + t1) / 2 });
  if (samples.length > 12) samples.shift();
  const best = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
  const sorted = samples.map((x) => x.rtt).sort((a, b) => a - b);
  R().set({ offsetMs: best.offset, rttMs: Math.round(sorted[Math.floor(sorted.length / 2)]) });
}

export function serverNow(): number {
  return Date.now() + R().offsetMs;
}

/* -------------------------------- transport -------------------------------- */

async function call<T = Record<string, unknown>>(path: string, init?: RequestInit): Promise<{ status: number; data: T }> {
  const token = R().session?.token;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers["x-room-token"] = token;
  const res = await fetch(path, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) }, cache: "no-store" });
  let data = {} as T;
  try {
    data = (await res.json()) as T;
  } catch {
    /* empty */
  }
  return { status: res.status, data };
}

type RoomReply = {
  room?: RoomState;
  you?: string;
  code?: string;
  token?: string;
  memberId?: string;
  serverMs?: number;
  error?: string;
  changed?: boolean;
  presence?: [string, number][];
  /** WebRTC signaling envelopes collected for this seat. */
  signals?: RoomSignal[];
  ended?: boolean;
  removed?: boolean;
};

/* --------------------------- voice signal routing -------------------------- */

type IncomingSignalHandler = (signals: RoomSignal[]) => void;
let signalHandler: IncomingSignalHandler | null = null;

/** The voice-call engine registers here so poll-delivered signals reach it. */
export function setIncomingSignalHandler(fn: IncomingSignalHandler | null) {
  signalHandler = fn;
}

/* ------------------------------- sync state -------------------------------- */

let lastSeq = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
let startTimer: ReturnType<typeof setTimeout> | null = null;
let holdUntil = 0;
let strikes = 0;
let cooldownUntil = 0;
let lastStartAttempt = 0;
let notPlayingSince = 0;
let failures = 0;
let syncing = false;
let announcementHoldUntil = 0;
let departureQueue: string[] = [];
let announcingDeparture = false;

function clearStart() {
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
}

/** Run `fn` when the room's start anchor arrives (or now if it has passed). */
function atAnchor(room: RoomState, fn: () => void) {
  clearStart();
  const wait = room.anchorMs - serverNow();
  if (wait > 25) startTimer = setTimeout(fn, Math.min(wait, 3000));
  else fn();
}

function isMine(room: RoomState) {
  return room.members.some((m) => m.id === R().session?.memberId);
}

async function startCurrent(room: RoomState) {
  lastStartAttempt = Date.now();
  const pos = expectedPosition(room, serverNow());
  await engineLocal.playIndex(room.queueIndex, pos);
  if (engineLocal.playBlocked()) R().set({ needsTap: true });
}

/** Make the local player match `room`. */
function apply(room: RoomState, fromControl: boolean) {
  notPlayingSince = 0;
  if (Date.now() < announcementHoldUntil) return;
  const tracks = room.queue.map(toTrack);
  const tiers: Record<string, "user" | "autoplay"> = {};
  for (const t of room.queue) if (t.tier) tiers[t.id] = t.tier;
  const roomCur = currentOf(room);
  const localCur = currentTrack(usePlayer.getState());
  const label = room.name;

  if (!roomCur) {
    clearStart();
    if (engineLocal.isPlaying()) engineLocal.stop();
    usePlayer.getState().set({ queue: [], index: -1, tiers: {}, contextLabel: label, isLoading: false });
    return;
  }

  const sameTrack = localCur?.id === roomCur.id;
  usePlayer.getState().set({ queue: tracks, index: room.queueIndex, tiers, contextLabel: label });
  if (engineLocal.failedTrackId() === roomCur.id) return;

  if (!sameTrack) {
    strikes = 0;
    cooldownUntil = Date.now() + 2500;
    if (room.isPlaying) {
      usePlayer.getState().set({ isLoading: true });
      atAnchor(room, () => void startCurrent(room));
    } else {
      clearStart();
      engineLocal.loadPaused(room.queueIndex, room.positionMs);
    }
    return;
  }
  align(room, fromControl);
}

function align(room: RoomState, fromControl: boolean) {
  const playingLocally = engineLocal.isPlaying();
  if (room.isPlaying) {
    if (!playingLocally) {
      const cur = currentOf(room);
      // At the very end the room is about to move on — don't replay the tail.
      if (cur && cur.durationMs > 0 && expectedPosition(room, serverNow()) > cur.durationMs - 1500) return;
      atAnchor(room, async () => {
        lastStartAttempt = Date.now();
        engineLocal.seek(expectedPosition(room, serverNow()));
        const ok = await engineLocal.setPlaying(true);
        if (!ok && engineLocal.playBlocked()) R().set({ needsTap: true });
      });
      return;
    }
    drift(room, fromControl ? 120 : null);
    return;
  }
  clearStart();
  if (playingLocally) void engineLocal.setPlaying(false);
  if (Math.abs(engineLocal.position() - room.positionMs) > 400) engineLocal.seek(room.positionMs);
  usePlayer.getState().set({ isLoading: false });
}

/**
 * Drift correction. A fresh control aligns anything past 120ms; routine checks
 * wait for two strikes past 1.2s and then cool down, so a seek's own buffering
 * can't set off another seek.
 */
function drift(room: RoomState, threshold: number | null) {
  const expected = expectedPosition(room, serverNow());
  const off = engineLocal.position() - expected;
  if (threshold !== null) {
    if (Math.abs(off) > threshold) {
      engineLocal.seek(expected);
      cooldownUntil = Date.now() + 3000;
    }
    strikes = 0;
    return;
  }
  if (Date.now() < cooldownUntil) return;
  if (Math.abs(off) > 1200) {
    strikes++;
    if (strikes >= 2) {
      engineLocal.seek(expected);
      strikes = 0;
      cooldownUntil = Date.now() + 6000;
    }
  } else strikes = 0;
}

function queueDepartureAnnouncement(name: string) {
  departureQueue.push(name);
  if (announcingDeparture) return;
  announcingDeparture = true;

  void (async () => {
    try {
      while (departureQueue.length) {
        const who = departureQueue.shift()!;
        const { room, session } = R();
        if (!room || !session || typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") continue;

        const trackId = currentTrack(usePlayer.getState())?.id;
        const wasPlaying = engineLocal.isPlaying();
        const startedAt = Date.now();
        announcementHoldUntil = startedAt + 4000;
        if (wasPlaying) await engineLocal.setPlaying(false);

        try {
          const utterance = new SpeechSynthesisUtterance(`${who} left the room`);
          utterance.rate = 1.25;
          await new Promise<void>((resolve) => {
            let finished = false;
            const finish = () => {
              if (finished) return;
              finished = true;
              clearTimeout(fallback);
              resolve();
            };
            const fallback = setTimeout(finish, 1800);
            utterance.onend = finish;
            utterance.onerror = finish;
            window.speechSynthesis.speak(utterance);
          });
        } catch {
          // Speech is best-effort; still end the short pause and resync audio.
        }
        const remainingPause = 1000 - (Date.now() - startedAt);
        if (remainingPause > 0) await new Promise((resolve) => setTimeout(resolve, remainingPause));

        announcementHoldUntil = 0;
        const latest = R().room;
        if (latest && R().session) {
          // Apply the newest state after the brief announcement pause, so a
          // play/pause change received during the voice is not lost.
          apply(latest, true);
        } else if (wasPlaying && trackId && currentTrack(usePlayer.getState())?.id === trackId) {
          // Leaving/end-of-room keeps this listener's local music playing.
          await engineLocal.setPlaying(true);
        }
      }
    } finally {
      announcementHoldUntil = 0;
      announcingDeparture = false;
    }
  })();
}

function receive(room: RoomState, source: "poll" | "control" | "join" | "chat") {
  if (room.seq <= lastSeq && source === "poll") return;
  if (room.seq < lastSeq) return;
  const previous = R().room;
  const departures = source === "join" ? [] : newlyLeftMembers(previous, room);
  lastSeq = room.seq;
  const presence: Record<string, number> = {};
  for (const m of room.members) presence[m.id] = Math.max(0, serverNow() - m.lastSeen);
  R().set({ room, presence, status: "live" });
  // Chat updates share the room's sequence and polling transport, but should
  // never cause a playback reconciliation.
  if (source !== "chat" && isMine(room)) {
    holdUntil = 0;
    apply(room, source !== "poll");
  }
  for (const name of departures) queueDepartureAnnouncement(name);
}

function reconcile() {
  const { room, session } = R();
  if (!room || !session) return;
  const p = usePlayer.getState();
  if (Date.now() < holdUntil || Date.now() < announcementHoldUntil || p.isLoading || startTimer) return;
  const cur = currentOf(room);
  if (!cur || currentTrack(p)?.id !== cur.id || engineLocal.failedTrackId() === cur.id) return;
  const playingLocally = engineLocal.isPlaying();
  if (room.isPlaying) {
    if (!playingLocally) {
      if (!notPlayingSince) notPlayingSince = Date.now();
      if (Date.now() - notPlayingSince > 4000 && !R().needsTap) R().set({ needsTap: true });
      if (Date.now() - lastStartAttempt > 5000 && !R().needsTap) align(room, false);
      return;
    }
    notPlayingSince = 0;
    if (R().needsTap) R().set({ needsTap: false });
    drift(room, null);
  } else {
    notPlayingSince = 0;
    if (playingLocally) void engineLocal.setPlaying(false);
  }
}

/* ---------------------------------- polling -------------------------------- */

async function pollOnce() {
  const { session } = R();
  if (!session) return;
  const t0 = Date.now();
  let res: { status: number; data: RoomReply };
  try {
    res = await call<RoomReply>(`/api/rooms/${session.code}?since=${lastSeq}`);
  } catch {
    failures++;
    if (failures > 1) R().set({ status: "reconnecting" });
    return;
  }
  const t1 = Date.now();
  if (R().session?.code !== session.code) return;
  if (res.status === 404) return cleanup("This room has ended");
  if (res.status === 403) return cleanup("You were removed from the room");
  if (res.status >= 400) {
    failures++;
    if (failures > 1) R().set({ status: "reconnecting" });
    return;
  }
  failures = 0;
  sample(t0, t1, res.data.serverMs);
  if (res.data.signals?.length) signalHandler?.(res.data.signals);
  if (res.data.changed === false) {
    const presence: Record<string, number> = {};
    for (const [id, ago] of res.data.presence ?? []) presence[id] = ago;
    R().set({ presence, status: "live" });
    return;
  }
  if (res.data.room) receive(res.data.room, "poll");
}

function schedulePoll(delay: number) {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    pollTimer = null;
    if (!R().session) return;
    await pollOnce();
    if (!R().session) return;
    const visible = typeof document === "undefined" || document.visibilityState === "visible";
    const base = visible ? 500 : 2500;
    schedulePoll(failures ? Math.min(6000, base * (1 + failures)) : base);
  }, delay);
}

function onVisible() {
  if (document.visibilityState === "visible" && R().session) {
    schedulePoll(0);
    reconcile();
  }
}

function onPageHide() {
  if (!R().session) return;
  // A document exit is only a temporary suspension: don't report an explicit
  // leave or drop their seat. Keep the saved token so one-tap rejoin is safe.
  stopSync();
  R().set({ room: null, status: "idle", presence: {}, resumePrompt: false });
}

let resumeLifecycleBound = false;

function onPageShow(event: PageTransitionEvent) {
  if (event.persisted) resumeRoom();
}

function bindResumeLifecycle() {
  if (resumeLifecycleBound || typeof window === "undefined") return;
  resumeLifecycleBound = true;
  window.addEventListener("pageshow", onPageShow);
}

function startSync() {
  if (syncing) return;
  syncing = true;
  setRoomBridge(bridge);
  schedulePoll(0);
  reconcileTimer = setInterval(reconcile, 700);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("pagehide", onPageHide);
}

function stopSync() {
  syncing = false;
  setRoomBridge(null);
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
  if (reconcileTimer) clearInterval(reconcileTimer);
  reconcileTimer = null;
  clearStart();
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("pagehide", onPageHide);
}

function cleanup(message?: string) {
  stopSync();
  lastSeq = 0;
  samples.length = 0;
  R().set({ session: null, room: null, status: "idle", needsTap: false, presence: {}, rttMs: null, resumePrompt: false });
  usePlayer.getState().set({ isLoading: false, tiers: {} });
  if (message) toast(message, "Your music keeps playing here", "info");
}

/* ------------------------------ public actions ----------------------------- */

function displayName(given?: string): string {
  return (given || useSettings.getState().profileName || "Listener").trim().slice(0, 24) || "Listener";
}

/** Start a room, carrying whatever is playing right now into it. */
export async function createRoom(opts: { name?: string; hostOnly?: boolean } = {}): Promise<string | null> {
  if (R().session) await leaveRoom({ quiet: true });
  const p = usePlayer.getState();
  const cur = currentTrack(p);
  const seed = cur
    ? {
        queue: p.queue.slice(p.index, p.index + 1 + ROOM_LIMITS.maxUpcoming).map(toRoomTrack),
        index: 0,
        positionMs: engineLocal.position(),
        isPlaying: engineLocal.isPlaying() || p.isPlaying,
      }
    : null;
  const name = displayName(opts.name);
  R().set({ status: "connecting", resumePrompt: false });
  try {
    const t0 = Date.now();
    const { status, data } = await call<RoomReply>("/api/rooms", {
      method: "POST",
      body: JSON.stringify({ name, hostOnly: !!opts.hostOnly, autoplay: useSettings.getState().autoplay, seed }),
    });
    if (status >= 400 || !data.code || !data.token || !data.memberId || !data.room) {
      R().set({ status: "idle" });
      toast("Couldn't start a room", data.error || "Try again in a moment", "warn");
      return null;
    }
    sample(t0, Date.now(), data.serverMs);
    lastSeq = 0;
    R().set({ session: { code: data.code, token: data.token, memberId: data.memberId, name } });
    receive(data.room, "join");
    startSync();
    return data.code;
  } catch {
    R().set({ status: "idle" });
    toast("Couldn't start a room", "Check your connection", "warn");
    return null;
  }
}

export async function joinRoom(rawCode: string, name?: string): Promise<{ ok: boolean; error?: string }> {
  const code = normalizeCode(rawCode);
  const prev = R().session;
  if (prev && prev.code !== code) await leaveRoom({ quiet: true });
  unlockEngine();
  const memberName = displayName(name || (prev?.code === code ? prev.name : undefined));
  R().set({ status: "connecting", resumePrompt: false });
  try {
    const t0 = Date.now();
    const { status, data } = await call<RoomReply>(`/api/rooms/${code}/join`, {
      method: "POST",
      body: JSON.stringify({ name: memberName, token: prev?.code === code ? prev.token : undefined }),
    });
    if (status >= 400 || !data.token || !data.memberId || !data.room) {
      R().set({ status: "idle" });
      return { ok: false, error: data.error || "Couldn't join that room" };
    }
    sample(t0, Date.now(), data.serverMs);
    lastSeq = 0;
    R().set({ session: { code, token: data.token, memberId: data.memberId, name: memberName } });
    receive(data.room, "join");
    startSync();
    return { ok: true };
  } catch {
    R().set({ status: "idle" });
    return { ok: false, error: "Check your connection and try again" };
  }
}

export async function leaveRoom(opts: { quiet?: boolean } = {}) {
  const { session } = R();
  if (!session) return;
  const token = session.token;
  cleanup();
  try {
    await fetch(`/api/rooms/${session.code}/leave`, { method: "POST", headers: { "x-room-token": token }, keepalive: true });
  } catch {
    /* best effort */
  }
  if (!opts.quiet) toast("You left the room", "The others carry on listening");
}

/** Ask before restoring a room session saved across a browser reload/exit. */
export function resumeRoom() {
  bindResumeLifecycle();
  if (!R().session) return;
  if (syncing) stopSync();
  R().set({ room: null, status: "idle", presence: {}, resumePrompt: true });
}

/** Rejoin the saved room when the listener confirms the prompt. */
export async function rejoinPreviousRoom(): Promise<boolean> {
  const session = R().session;
  if (!session) {
    R().set({ resumePrompt: false });
    return false;
  }
  const result = await joinRoom(session.code, session.name);
  if (!result.ok) {
    R().set({ resumePrompt: true });
    toast("Couldn't rejoin the room", result.error || "Try again in a moment", "warn");
    return false;
  }
  R().set({ resumePrompt: false });
  toast("Rejoined the room", `Back in room ${session.code}`, "ok");
  return true;
}

/** Not now means leave the saved room and discard the local rejoin prompt. */
export function dismissPreviousRoom() {
  void leaveRoom({ quiet: true });
}

export async function sendRoomChat(text: string, id?: string): Promise<boolean> {
  const { session } = R();
  const message = text.trim().slice(0, 300);
  if (!session || !message) return false;
  try {
    const { status, data } = await call<RoomReply>(`/api/rooms/${session.code}/chat`, {
      method: "POST",
      body: JSON.stringify({ text: message, id }),
    });
    if (status === 404 || data.ended) {
      cleanup("This room has ended");
      return false;
    }
    if (status === 403 && data.removed) {
      cleanup("You were removed from the room");
      return false;
    }
    if (status >= 400) {
      toast(data.error || "Couldn't send your message", undefined, "warn");
      return false;
    }
    if (data.room) receive(data.room, "chat");
    return true;
  } catch {
    toast("Couldn't send your message", "Check your connection and try again", "warn");
    return false;
  }
}

export async function sendControl(action: ControlAction): Promise<boolean> {
  const { session } = R();
  if (!session) return false;
  holdUntil = Date.now() + 4500;
  try {
    const { status, data } = await call<RoomReply>(`/api/rooms/${session.code}/control`, {
      method: "POST",
      body: JSON.stringify({ action }),
    });
    if (status === 404 || data.ended) {
      cleanup(action.type === "end" ? undefined : "This room has ended");
      if (action.type === "end") toast("Room ended", "Everyone has been let go", "ok");
      return status < 400;
    }
    if (status === 403 && data.removed) {
      cleanup("You were removed from the room");
      return false;
    }
    if (data.room) receive(data.room, "control");
    if (status >= 400) {
      holdUntil = 0;
      usePlayer.getState().set({ isLoading: false });
      toast(data.error || "That didn't work", undefined, "warn");
      return false;
    }
    return true;
  } catch {
    holdUntil = 0;
    usePlayer.getState().set({ isLoading: false });
    toast("Couldn't reach the room", "Check your connection", "warn");
    return false;
  }
}

/** The tap that satisfies the browser's autoplay rule. */
export function tapToSync() {
  unlockEngine();
  R().set({ needsTap: false });
  notPlayingSince = 0;
  const room = R().room;
  if (!room) return;
  const cur = currentOf(room);
  if (!cur) return;
  if (currentTrack(usePlayer.getState())?.id !== cur.id) void startCurrent(room);
  else align(room, true);
}

export function isHost(): boolean {
  const { room, session } = R();
  return !!room && !!session && room.hostId === session.memberId;
}

function canControl(): boolean {
  const { room, session } = R();
  if (!room || !session) return false;
  if (room.hostOnly && room.hostId !== session.memberId) {
    toast("Only the host can control the music", "Ask them to share the controls", "info");
    return false;
  }
  return true;
}

/* --------------------------------- bridge ---------------------------------- */

const bridge: RoomBridge = {
  active: () => !!R().session && !!R().room,
  playContext(tracks, start, label) {
    if (!canControl()) return;
    void label;
    if (tracks.length === 1) {
      void sendControl({ type: "playNow", track: toRoomTrack(tracks[0]) });
    } else {
      const slice = tracks.slice(start, start + 1 + ROOM_LIMITS.maxUpcoming).map(toRoomTrack);
      void sendControl({ type: "load", queue: slice, index: 0 });
    }
    usePlayer.getState().set({ isLoading: true });
  },
  setPlaying(play) {
    if (!canControl()) return;
    const pos = engineLocal.position();
    if (!play) void engineLocal.setPlaying(false);
    void sendControl({ type: play ? "play" : "pause", positionMs: pos });
  },
  next() {
    if (!canControl()) return;
    usePlayer.getState().set({ isLoading: true });
    void sendControl({ type: "next" });
  },
  prev() {
    if (!canControl()) return;
    void sendControl({ type: "prev" });
  },
  seek(ms) {
    if (!canControl()) return;
    engineLocal.seek(ms);
    void sendControl({ type: "seek", positionMs: ms });
  },
  jump(index) {
    if (!canControl()) return;
    usePlayer.getState().set({ isLoading: true });
    void sendControl({ type: "jump", index });
  },
  queueAdd(track, mode) {
    if (!canControl()) return;
    void sendControl({ type: "queueAdd", track: toRoomTrack(track), mode }).then(
      (ok) => ok && toast(mode === "next" ? "Playing next in the room" : "Added to the room queue", track.title, "ok")
    );
  },
  queueRemove(index) {
    if (!canControl()) return;
    void sendControl({ type: "queueRemove", index });
  },
  queueMove(from, to) {
    if (!canControl()) return;
    void sendControl({ type: "queueMove", from, to });
  },
  queueClear() {
    if (!canControl()) return;
    void sendControl({ type: "queueClear" });
  },
  setAutoplay(on) {
    if (!canControl()) return;
    void sendControl({ type: "setAutoplay", on });
  },
  ended(track) {
    void sendControl({ type: "ended", trackId: track.id });
  },
  sleep() {
    void engineLocal.setPlaying(false);
    void leaveRoom({ quiet: true });
    toast("Sleep timer", "You left the room and playback stopped here", "info");
  },
};

/* ---------------------------------- hooks ---------------------------------- */

export function useRoomSummary() {
  const room = useRoom((s) => s.room);
  const session = useRoom((s) => s.session);
  const status = useRoom((s) => s.status);
  return {
    inRoom: !!session,
    room,
    status,
    code: session?.code ?? null,
    you: session?.memberId ?? null,
    isHost: !!room && !!session && room.hostId === session.memberId,
    count: room?.members.length ?? 0,
  };
}

export function inviteUrl(code: string): string {
  if (typeof window === "undefined") return `/rooms/${code}`;
  return `${window.location.origin}/rooms/${code}`;
}
