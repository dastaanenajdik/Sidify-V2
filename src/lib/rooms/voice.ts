"use client";

/**
 * Listen Together — 1:1 voice call engine.
 *
 * The media itself never touches our servers: two browsers connect directly
 * with WebRTC (Opus, HD constraints, echo cancellation + noise suppression).
 * Only tiny SDP/ICE envelopes are relayed, through the room's existing
 * polling transport (POST /api/rooms/{code}/signal → collected on the next
 * GET). Free STUN servers handle NAT traversal; while a call is live the
 * shared music is ducked via setMusicDuck() so speech stays intelligible.
 */

import { create } from "zustand";
import { setIncomingSignalHandler, useRoom } from "./client";
import type { RoomSignal } from "./logic";
import { setMusicDuck } from "@/lib/audioEngine";
import { useUi } from "@/store/ui";

export type VoiceStatus = "idle" | "ringing" | "requesting" | "connecting" | "live";

interface VoiceState {
  status: VoiceStatus;
  micOn: boolean;
  peerId: string | null;
  peerName: string | null;
  /** Local mic is picking up speech. */
  speaking: boolean;
  /** The remote side's mic is picking up speech. */
  peerSpeaking: boolean;
  /** ICE dropped momentarily and is trying to recover. */
  reconnecting: boolean;
  error: string | null;
  set: (p: Partial<VoiceState>) => void;
}

export const useVoice = create<VoiceState>()((set) => ({
  status: "idle",
  micOn: false,
  peerId: null,
  peerName: null,
  speaking: false,
  peerSpeaking: false,
  reconnecting: false,
  error: null,
  set: (p) => set(p),
}));

const V = () => useVoice.getState();

function toast(title: string, desc?: string, kind: "ok" | "info" | "warn" = "info") {
  useUi.getState().pushToast({ title, desc, kind });
}

/* ------------------------------- configuration ----------------------------- */

/** Free public STUN — no account, no per-minute billing, no TURN dependency for most networks. */
const ICE_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
  iceCandidatePoolSize: 4,
  bundlePolicy: "max-bundle",
};

/** HD voice: 48 kHz fullband capture with the platform's speech clean-up. */
const HD_MIC: MediaStreamConstraints["audio"] = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
};

/** Opus at 64 kbps is transparent for speech and survives weak connections. */
const VOICE_MAX_BITRATE = 64_000;
/** Give up ringing if the other side never answers. */
const RING_TIMEOUT_MS = 45_000;

/* --------------------------------- runtime --------------------------------- */

let pc: RTCPeerConnection | null = null;
let role: "caller" | "callee" | null = null;
let peer: { id: string; name: string } | null = null;
let localStream: MediaStream | null = null;
let micTrack: MediaStreamTrack | null = null;
let remoteStream: MediaStream | null = null;
let remoteAudio: HTMLAudioElement | null = null;
let pendingCandidates: RTCIceCandidateInit[] = [];
let pendingOffer: RoomSignal | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let restartAttempted = false;

let meterCtx: AudioContext | null = null;
let localAnalyser: AnalyserNode | null = null;
let remoteAnalyser: AnalyserNode | null = null;
let meterRaf = 0;
let lastMeterAt = 0;

/* -------------------------------- transport -------------------------------- */

async function sendSignal(
  kind: RoomSignal["kind"],
  to: string,
  data = "",
  opts: { join?: boolean; leave?: boolean } = {}
): Promise<boolean> {
  const session = useRoom.getState().session;
  if (!session) return false;
  try {
    const res = await fetch(`/api/rooms/${session.code}/signal`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-room-token": session.token },
      body: JSON.stringify({ kind, to, data, join: opts.join, leave: opts.leave }),
      keepalive: kind === "bye",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* ------------------------------ microphone in ------------------------------ */

async function openMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: HD_MIC, video: false });
  } catch {
    // Some engines reject the richer constraint set; plain audio still gets
    // echo cancellation by default and is better than no call at all.
    return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }
}

async function attachMic(peerConn: RTCPeerConnection) {
  const stream = await openMicrophone();
  localStream = stream;
  micTrack = stream.getAudioTracks()[0] ?? null;
  if (micTrack && "contentHint" in micTrack) micTrack.contentHint = "speech";
  for (const track of stream.getAudioTracks()) {
    const sender = peerConn.addTrack(track, stream);
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
      params.encodings[0].maxBitrate = VOICE_MAX_BITRATE;
      await sender.setParameters(params);
    } catch {
      /* older WebRTC engines without encoding controls — defaults are already Opus */
    }
  }
  setupLocalMeter(stream);
}

/* ------------------------------ peer connection ---------------------------- */

function createPeerConnection(): RTCPeerConnection {
  const conn = new RTCPeerConnection(ICE_CONFIG);

  conn.onicecandidate = (event) => {
    if (event.candidate && peer) {
      void sendSignal("candidate", peer.id, JSON.stringify(event.candidate.toJSON()));
    }
  };

  conn.ontrack = (event) => {
    remoteStream = event.streams[0] ?? new MediaStream([event.track]);
    attachRemoteAudio(remoteStream);
    setupRemoteMeter(remoteStream);
  };

  conn.onconnectionstatechange = () => {
    switch (conn.connectionState) {
      case "connected":
        restartAttempted = false;
        V().set({ status: "live", reconnecting: false });
        setMusicDuck(true);
        break;
      case "disconnected":
        V().set({ reconnecting: true });
        break;
      case "failed":
        void recoverOrDrop(conn);
        break;
      case "closed":
        break;
    }
  };

  return conn;
}

async function recoverOrDrop(conn: RTCPeerConnection) {
  // One ICE restart from the caller's side; otherwise tear the call down.
  if (role === "caller" && peer && !restartAttempted) {
    restartAttempted = true;
    V().set({ reconnecting: true });
    try {
      const offer = await conn.createOffer({ iceRestart: true });
      await conn.setLocalDescription(offer);
      await sendSignal("offer", peer.id, offer.sdp ?? "");
      return;
    } catch {
      /* fall through to hang-up */
    }
  }
  failCall("The connection dropped and couldn't recover");
}

function attachRemoteAudio(stream: MediaStream) {
  if (!remoteAudio) {
    const el = new Audio();
    el.autoplay = true;
    el.setAttribute("playsinline", "");
    document.body.appendChild(el);
    remoteAudio = el;
  }
  remoteAudio.srcObject = stream;
  void remoteAudio.play().catch(() => {
    /* Accept/start clicks unlock autoplay; a retry happens on the next ontrack. */
  });
}

/* ----------------------------- SDP/ICE signaling --------------------------- */

async function flushCandidates(conn: RTCPeerConnection) {
  const queued = pendingCandidates;
  pendingCandidates = [];
  for (const cand of queued) {
    try {
      await conn.addIceCandidate(cand);
    } catch {
      /* stale candidate for an old description */
    }
  }
}

async function handleOffer(sig: RoomSignal) {
  if (!pc) {
    // The callee has not pressed Accept yet; keep it for acceptCall().
    pendingOffer = sig;
    return;
  }
  if (role !== "callee") return;
  await pc.setRemoteDescription({ type: "offer", sdp: sig.data });
  await flushCandidates(pc);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await sendSignal("answer", sig.from, answer.sdp ?? "", { join: true });
}

async function handleAnswer(sig: RoomSignal) {
  if (!pc || role !== "caller") return;
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
  V().set({ status: "connecting" });
  await pc.setRemoteDescription({ type: "answer", sdp: sig.data });
  await flushCandidates(pc);
}

async function handleCandidate(sig: RoomSignal) {
  let cand: RTCIceCandidateInit;
  try {
    cand = JSON.parse(sig.data) as RTCIceCandidateInit;
  } catch {
    return;
  }
  // Candidates often trickle in before the callee has accepted (no pc yet) or
  // before a remote description exists — queue them and flush on negotiation.
  if (pc?.remoteDescription) {
    try {
      await pc.addIceCandidate(cand);
    } catch {
      /* stale candidate for an old description */
    }
  } else {
    pendingCandidates.push(cand);
  }
}

function remoteHangup(sig: RoomSignal) {
  const wasRequesting = V().status === "requesting";
  const name = peer?.name || nameOf(sig.from) || "The other listener";
  teardown();
  resetStore();
  toast(wasRequesting ? `${name} declined the call` : `${name} ended the call`);
}

function nameOf(memberId: string): string | null {
  return useRoom.getState().room?.members.find((m) => m.id === memberId)?.name ?? null;
}

async function onSignals(signals: RoomSignal[]) {
  for (const sig of signals) {
    // Envelopes from a previous call are ignored once we have gone idle.
    if (peer && sig.from !== peer.id && V().status !== "ringing") continue;
    try {
      switch (sig.kind) {
        case "offer":
          if (!peer) peer = { id: sig.from, name: nameOf(sig.from) ?? "Listener" };
          await handleOffer(sig);
          break;
        case "answer":
          await handleAnswer(sig);
          break;
        case "candidate":
          await handleCandidate(sig);
          break;
        case "bye":
          remoteHangup(sig);
          return;
      }
    } catch (error) {
      console.error("voice signal failed", error);
    }
  }
}

/* ------------------------------- speech meter ------------------------------ */

function ensureMeterContext(): AudioContext {
  if (!meterCtx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    meterCtx = new Ctor!();
  }
  if (meterCtx.state === "suspended") void meterCtx.resume();
  return meterCtx;
}

function setupLocalMeter(stream: MediaStream) {
  const ctx = ensureMeterContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  localAnalyser = analyser;
  startMeterLoop();
}

function setupRemoteMeter(stream: MediaStream) {
  const ctx = ensureMeterContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 512;
  ctx.createMediaStreamSource(stream).connect(analyser);
  remoteAnalyser = analyser;
  startMeterLoop();
}

function level(analyser: AnalyserNode | null): number {
  if (!analyser) return 0;
  const buf = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(buf);
  let sum = 0;
  for (const sample of buf) {
    const centered = (sample - 128) / 128;
    sum += centered * centered;
  }
  return Math.sqrt(sum / buf.length);
}

function startMeterLoop() {
  if (meterRaf) return;
  const tick = () => {
    meterRaf = requestAnimationFrame(tick);
    const now = performance.now();
    if (now - lastMeterAt < 120) return;
    lastMeterAt = now;
    const localOn = level(localAnalyser) > 0.055;
    const remoteOn = level(remoteAnalyser) > 0.055;
    const state = V();
    if (localOn !== state.speaking) state.set({ speaking: localOn });
    if (remoteOn !== state.peerSpeaking) state.set({ peerSpeaking: remoteOn });
  };
  meterRaf = requestAnimationFrame(tick);
}

function stopMeters() {
  if (meterRaf) cancelAnimationFrame(meterRaf);
  meterRaf = 0;
  localAnalyser = null;
  remoteAnalyser = null;
  if (meterCtx) {
    void meterCtx.close().catch(() => {});
    meterCtx = null;
  }
}

/* -------------------------------- lifecycle -------------------------------- */

function resetStore() {
  V().set({
    status: "idle",
    micOn: false,
    peerId: null,
    peerName: null,
    speaking: false,
    peerSpeaking: false,
    reconnecting: false,
    error: null,
  });
}

function teardown() {
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
  stopMeters();
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  micTrack = null;
  if (remoteAudio) {
    remoteAudio.srcObject = null;
    remoteAudio.remove();
    remoteAudio = null;
  }
  remoteStream = null;
  if (pc) {
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.oniceconnectionstatechange = null;
    try {
      pc.close();
    } catch {
      /* already closed */
    }
    pc = null;
  }
  pendingCandidates = [];
  pendingOffer = null;
  peer = null;
  role = null;
  restartAttempted = false;
  setMusicDuck(false);
}

function failCall(message: string) {
  const peerId = peer?.id ?? null;
  teardown();
  V().set({
    status: "idle",
    micOn: false,
    peerId: null,
    peerName: null,
    speaking: false,
    peerSpeaking: false,
    reconnecting: false,
    error: message,
  });
  // Release the server-side voice seat so the other side stops ringing.
  if (peerId) void sendSignal("bye", peerId, "", { leave: true });
  toast("Voice call unavailable", message, "warn");
}

/** Outgoing call from the room's "Start voice call" button. */
export async function startCall(peerId: string, peerName: string) {
  const session = useRoom.getState().session;
  if (!session || V().status !== "idle") return;
  if (peerId === session.memberId) return;
  role = "caller";
  peer = { id: peerId, name: peerName };
  V().set({ status: "requesting", peerId, peerName, micOn: true, error: null, reconnecting: false });
  try {
    const conn = createPeerConnection();
    pc = conn;
    await attachMic(conn);
    const offer = await conn.createOffer();
    await conn.setLocalDescription(offer);
    const ok = await sendSignal("offer", peerId, offer.sdp ?? "", { join: true });
    if (!ok) throw new Error("signaling");
    ringTimer = setTimeout(() => failCall("No answer — they may be away"), RING_TIMEOUT_MS);
  } catch (error) {
    console.error("startCall failed", error);
    failCall(
      error instanceof Error && error.message === "unsupported"
        ? "This browser does not support microphone calls"
        : "Couldn't reach the microphone or the room"
    );
  }
}

/** Accept an incoming ringing call. */
export async function acceptCall() {
  const state = V();
  if (state.status !== "ringing" || !state.peerId) return;
  role = "callee";
  peer = { id: state.peerId, name: state.peerName ?? "Listener" };
  state.set({ status: "connecting", micOn: true, error: null });
  try {
    const conn = createPeerConnection();
    pc = conn;
    await attachMic(conn);
    const offer = pendingOffer;
    pendingOffer = null;
    if (offer) await handleOffer(offer);
  } catch (error) {
    console.error("acceptCall failed", error);
    failCall("Couldn't open your microphone");
  }
}

/** Decline a ringing call without opening the microphone. */
export async function declineCall() {
  const state = V();
  if (state.status !== "ringing" || !state.peerId) return;
  await sendSignal("bye", state.peerId, "", { leave: true });
  pendingOffer = null;
  resetStore();
}

/** Hang up an active/requested/connecting call. */
export async function endCall() {
  const state = V();
  if (state.status === "idle") return;
  if (state.peerId) await sendSignal("bye", state.peerId, "", { leave: true });
  teardown();
  resetStore();
}

/** Mute/unmute the local mic. The track stays connected; it simply goes silent. */
export function toggleMic() {
  if (!micTrack) return;
  const next = !V().micOn;
  micTrack.enabled = next;
  V().set({ micOn: next, speaking: next ? V().speaking : false });
}

/**
 * Mark the local seat as ringing because another member's voice presence
 * appeared. Driven by the room-state watcher in the VoiceCall UI.
 */
export function markRinging(peerId: string, peerName: string) {
  if (V().status !== "idle") return;
  peer = { id: peerId, name: peerName };
  V().set({ status: "ringing", peerId, peerName, error: null });
}

/** A ringing call vanished (cancelled before we accepted). */
export function cancelRinging() {
  if (V().status !== "ringing") return;
  pendingOffer = null;
  peer = null;
  resetStore();
}

/** Local reset when the room/session disappears (navigation, removal, reload). */
export function resetVoiceCall() {
  if (V().status === "idle" && !peer) return;
  teardown();
  resetStore();
}

/** Clear a stale server-side voice presence for this seat after a reload. */
export async function clearStaleVoicePresence() {
  const session = useRoom.getState().session;
  if (!session) return;
  await sendSignal("bye", "", "", { leave: true });
}

/** Wire the room poll's signal delivery to this engine. Mount once per room view. */
export function mountVoiceEngine() {
  setIncomingSignalHandler(onSignals);
  return () => setIncomingSignalHandler(null);
}
