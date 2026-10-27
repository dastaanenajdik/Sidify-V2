"use client";

/**
 * Listen Together — 1:1 voice AND 4K video call engine.
 *
 * The media itself never touches our servers: two browsers connect directly
 * with WebRTC. Only tiny SDP/ICE envelopes are relayed, through the room's
 * existing polling transport (POST /api/rooms/{code}/signal → collected on the
 * next GET). During negotiation that poll is temporarily sped up so SDP and
 * ICE arrive promptly; once connected, media is pure peer-to-peer.
 *
 * Voice calls: 48 kHz fullband Opus with echo cancellation / noise
 * suppression, 10 ms frames and no FEC, and the shared music ducks to 22%.
 *
 * Video calls: the same audio path PLUS a 3840×2160/60 camera track, VP9/H.264
 * preference, a 24 Mbps ceiling (adapted to the measured link so frames never
 * queue up behind congestion), `maintain-resolution` encoding, and zero-hint
 * jitter/playout buffers on the receiver. Crucially, video calls do NOT duck
 * the shared music — the song keeps playing at full volume. Echo cancellation
 * on the mic keeps the speaker's own playback out of their outgoing audio, and
 * a "Duck music" control is there for anyone who wants the old behaviour.
 */

import { create } from "zustand";
import { setCallSignalingUrgent, setIncomingSignalHandler, useRoom } from "./client";
import { callModeOf, type CallMode, type RoomSignal } from "./logic";
import {
  AUDIO_BITRATE_VIDEO,
  AUDIO_BITRATE_VOICE,
  orderVideoCodecs,
  qualityLabel,
  targetBitrate,
  tuneSdp,
  VIDEO_CONSTRAINTS,
  VIDEO_FPS,
  VIDEO_MAX_BITRATE,
} from "./media";
import { setMusicDuck } from "@/lib/audioEngine";
import { useUi } from "@/store/ui";

export type VoiceStatus = "idle" | "ringing" | "requesting" | "connecting" | "live";

/** Live, measured call quality shown on the video stage. */
export interface CallQuality {
  width: number;
  height: number;
  fps: number;
  /** ICE candidate-pair round-trip time, i.e. the transport's real latency. */
  rttMs: number | null;
  /** Current video send ceiling in kbps. */
  bitrateKbps: number;
  label: string;
}

interface VoiceState {
  status: VoiceStatus;
  /** voice = audio only; video = 4K camera + audio. */
  mode: CallMode;
  micOn: boolean;
  camOn: boolean;
  /** True while the shared song is lowered under the call. */
  musicDucked: boolean;
  peerId: string | null;
  peerName: string | null;
  /** Local mic is picking up speech. */
  speaking: boolean;
  /** The remote side's mic is picking up speech. */
  peerSpeaking: boolean;
  /** ICE dropped momentarily and is trying to recover. */
  reconnecting: boolean;
  error: string | null;
  /** Local camera+mic stream for the self-view tile. */
  localStream: MediaStream | null;
  /** Peer's stream for the big tile (audio is played by the hidden element). */
  remoteStream: MediaStream | null;
  quality: CallQuality | null;
  set: (p: Partial<VoiceState>) => void;
}

export const useVoice = create<VoiceState>()((set) => ({
  status: "idle",
  mode: "voice",
  micOn: false,
  camOn: false,
  musicDucked: false,
  peerId: null,
  peerName: null,
  speaking: false,
  peerSpeaking: false,
  reconnecting: false,
  error: null,
  localStream: null,
  remoteStream: null,
  quality: null,
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
  // Pre-gather more candidates: fewer negotiation round trips before first frame.
  iceCandidatePoolSize: 8,
  bundlePolicy: "max-bundle",
  rtcpMuxPolicy: "require",
};

/**
 * Low-latency mic capture. `latency: 0` and `voiceIsolation` are newer hints
 * that Chromium honours and other engines safely ignore; the whole object is
 * tried first and a plain `{ audio: true }` fallback covers strict engines.
 */
const HD_MIC = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
  latency: 0,
  voiceIsolation: true,
} as MediaTrackConstraints;

/** Give up ringing if the other side never answers. */
const RING_TIMEOUT_MS = 45_000;

/* --------------------------------- runtime --------------------------------- */

let pc: RTCPeerConnection | null = null;
let role: "caller" | "callee" | null = null;
let peer: { id: string; name: string } | null = null;
let mode: CallMode = "voice";
let localStream: MediaStream | null = null;
let micTrack: MediaStreamTrack | null = null;
let camTrack: MediaStreamTrack | null = null;
let remoteStream: MediaStream | null = null;
let remoteAudio: HTMLAudioElement | null = null;
let videoSender: RTCRtpSender | null = null;
let currentBitrate = VIDEO_MAX_BITRATE;
let statsTimer: ReturnType<typeof setInterval> | null = null;
let statsBusy = false;
let pendingCandidates: RTCIceCandidateInit[] = [];
let pendingOffer: RoomSignal | null = null;
let ringTimer: ReturnType<typeof setTimeout> | null = null;
let restartAttempted = false;
/**
 * Bumped on every teardown so an async start/accept flow that was awaiting
 * (mic/camera prompt, SDP, fetch) knows it belongs to a dead call and bails
 * quietly instead of touching a closed peer connection or re-opening the mic.
 */
let callGeneration = 0;

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
      body: JSON.stringify({ kind, to, data, mode, join: opts.join, leave: opts.leave }),
      keepalive: kind === "bye",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/* --------------------------- microphone + camera in ------------------------ */

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

/**
 * Walk the 4K → QHD → 1080p → 720p ladder. `ideal` constraints never fail on
 * a lesser camera, but a driver can still reject an exact combination, so the
 * next rung (and finally a bare `video: true`) keeps the call connectable.
 */
async function openCamera(): Promise<MediaStreamTrack | null> {
  const devices = navigator.mediaDevices;
  if (!devices?.getUserMedia) return null;
  for (const constraints of VIDEO_CONSTRAINTS) {
    try {
      const stream = await devices.getUserMedia({ audio: false, video: constraints });
      const track = stream.getVideoTracks()[0] ?? null;
      if (track) return track;
      stream.getTracks().forEach((t) => t.stop());
    } catch {
      /* try the next rung */
    }
  }
  try {
    const stream = await devices.getUserMedia({ audio: false, video: true });
    return stream.getVideoTracks()[0] ?? null;
  } catch {
    return null;
  }
}

async function openMedia(callMode: CallMode): Promise<MediaStream> {
  const audio = await openMicrophone();
  if (callMode === "voice") return audio;
  const camera = await openCamera();
  if (!camera) {
    // No camera (permission denied / none attached): still connect the call
    // with audio rather than failing the whole conversation.
    toast("Camera unavailable", "Connected with audio — check camera permissions", "warn");
    return audio;
  }
  return new MediaStream([...audio.getAudioTracks(), camera]);
}

/** Ask the peer connection + platform for the shortest possible playout queue. */
function applyLowLatency(receiver: RTCRtpReceiver) {
  try {
    // Milliseconds; 0 keeps only the platform's irreducible safety buffer.
    receiver.jitterBufferTarget = 0;
  } catch {
    /* Firefox/Safari don't expose this hint yet */
  }
  try {
    const r = receiver as RTCRtpReceiver & { playoutDelayHint?: number };
    if ("playoutDelayHint" in r) r.playoutDelayHint = 0;
  } catch {
    /* Chromium-only hint */
  }
}

/**
 * Video send parameters: full resolution, high priority, no queued frames.
 * `networkPriority` / `degradationPreference` are not writable on every
 * engine, so a rejected `setParameters` is retried with the essential bitrate
 * knobs only — the 4K ceiling must not be lost to an optional hint.
 */
async function applyVideoParameters(sender: RTCRtpSender, bitrate: number) {
  for (const extras of [true, false]) {
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      const enc = params.encodings[0];
      enc.maxBitrate = bitrate;
      enc.maxFramerate = VIDEO_FPS;
      enc.scaleResolutionDownBy = 1;
      if (extras) {
        enc.networkPriority = "high";
        enc.priority = "high";
        // Never silently shrink the 2160p frame to hide a slow link — spend
        // fewer bits on it instead, which also avoids rescaling buffers.
        params.degradationPreference = "maintain-resolution";
      }
      await sender.setParameters(params);
      return;
    } catch {
      /* try the reduced set, then leave the engine's defaults alone */
    }
  }
}

/** Put 4K-capable codecs first on the video transceiver, before SDP is made. */
function preferVideoCodecs(conn: RTCPeerConnection) {
  try {
    const caps = typeof RTCRtpSender !== "undefined" ? RTCRtpSender.getCapabilities("video") : null;
    if (!caps?.codecs?.length) return;
    const ordered = orderVideoCodecs(caps.codecs);
    for (const transceiver of conn.getTransceivers()) {
      if (transceiver.sender.track?.kind === "video" || transceiver.receiver.track.kind === "video") {
        transceiver.setCodecPreferences(ordered);
      }
    }
  } catch {
    /* codec preferences are an optimisation, not a requirement */
  }
}

async function attachMedia(peerConn: RTCPeerConnection, callMode: CallMode, generation: number) {
  const stream = await openMedia(callMode);
  if (generation !== callGeneration) {
    // The call was torn down while the permission prompt was open: release
    // the streams the user just granted so no mic/camera light stays on.
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("stale");
  }
  localStream = stream;
  micTrack = stream.getAudioTracks()[0] ?? null;
  camTrack = stream.getVideoTracks()[0] ?? null;
  if (micTrack && "contentHint" in micTrack) micTrack.contentHint = "speech";
  if (camTrack) {
    if ("contentHint" in camTrack) camTrack.contentHint = "motion";
    camTrack.onended = () => V().set({ camOn: false });
  }
  V().set({ localStream: stream, micOn: !!micTrack, camOn: !!camTrack });

  for (const track of stream.getTracks()) {
    const sender = peerConn.addTrack(track, stream);
    if (track.kind === "audio") {
      const bitrate = callMode === "video" ? AUDIO_BITRATE_VIDEO : AUDIO_BITRATE_VOICE;
      for (const priority of [true, false]) {
        try {
          const params = sender.getParameters();
          if (!params.encodings?.length) params.encodings = [{}];
          params.encodings[0].maxBitrate = bitrate;
          if (priority) {
            params.encodings[0].networkPriority = "high";
            params.encodings[0].priority = "high";
          }
          await sender.setParameters(params);
          break;
        } catch {
          /* defaults are already Opus */
        }
      }
    } else {
      videoSender = sender;
      currentBitrate = VIDEO_MAX_BITRATE;
      await applyVideoParameters(sender, currentBitrate);
    }
  }
  preferVideoCodecs(peerConn);
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
    applyLowLatency(event.receiver);
    const track = event.track;
    remoteStream ??= new MediaStream();
    if (!remoteStream.getTracks().some((t) => t.id === track.id)) remoteStream.addTrack(track);
    if (track.kind === "audio") {
      attachRemoteAudio(remoteStream);
      if (!remoteAnalyser) setupRemoteMeter(remoteStream);
    }
    // A fresh MediaStream instance gives React a new identity on every track,
    // so the video tile attaches as soon as the first frame is available.
    V().set({ remoteStream: new MediaStream(remoteStream.getTracks()) });
  };

  conn.onconnectionstatechange = () => {
    switch (conn.connectionState) {
      case "connected": {
        restartAttempted = false;
        setCallSignalingUrgent(false);
        // Voice calls duck the song; video calls keep it playing at full volume.
        const duck = mode === "voice";
        setMusicDuck(duck);
        V().set({ status: "live", reconnecting: false, musicDucked: duck });
        startStats(conn);
        break;
      }
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
      const sdp = await applyLocalDescription(conn, offer);
      await sendSignal("offer", peer.id, sdp);
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

/**
 * Install a local description after applying the 4K/low-latency SDP tuning.
 * If an engine rejects the rewritten SDP, retry with the browser's original —
 * a call with default settings beats no call at all.
 */
async function applyLocalDescription(conn: RTCPeerConnection, desc: RTCSessionDescriptionInit): Promise<string> {
  let tuned: string | null = null;
  try {
    tuned = tuneSdp(desc.sdp ?? "", mode);
  } catch {
    tuned = null;
  }
  if (tuned) {
    try {
      await conn.setLocalDescription({ type: desc.type, sdp: tuned });
      return conn.localDescription?.sdp ?? tuned;
    } catch {
      /* retry untouched below */
    }
  }
  await conn.setLocalDescription(desc);
  return conn.localDescription?.sdp ?? desc.sdp ?? "";
}

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
  const sdp = await applyLocalDescription(pc, answer);
  const delivered = await sendNegotiation("answer", sig.from, sdp, true);
  if (!delivered) throw new Error("signaling");
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
      console.error("call signal failed", error);
    }
  }
}

/* --------------------------- live quality + bitrate ------------------------ */

function startStats(conn: RTCPeerConnection) {
  stopStats();
  statsTimer = setInterval(() => void collectStats(conn), 1000);
  void collectStats(conn);
}

function stopStats() {
  if (statsTimer) clearInterval(statsTimer);
  statsTimer = null;
  statsBusy = false;
}

/**
 * Read the real inbound resolution/fps and the transport RTT, show them, and
 * steer the send bitrate to the measured available bandwidth. A congested
 * 4K stream is what produces "video lag": packets queue, so we lower the bits
 * (keeping 2160p) instead of letting a backlog build up.
 */
async function collectStats(conn: RTCPeerConnection) {
  if (statsBusy || conn.signalingState === "closed") return;
  statsBusy = true;
  try {
    const report = await conn.getStats();
    let rttMs: number | null = null;
    let available = 0;
    let width = 0;
    let height = 0;
    let fps = 0;
    report.forEach((entry) => {
      if (entry.type === "candidate-pair") {
        const pair = entry as RTCIceCandidatePairStats;
        if (pair.state === "succeeded") {
          if (typeof pair.currentRoundTripTime === "number") rttMs = pair.currentRoundTripTime * 1000;
          if (typeof pair.availableOutgoingBitrate === "number") available = pair.availableOutgoingBitrate;
        }
      } else if (entry.type === "inbound-rtp") {
        const inbound = entry as RTCInboundRtpStreamStats;
        if (inbound.kind === "video" && (inbound.frameWidth ?? 0) > 0) {
          width = inbound.frameWidth ?? 0;
          height = inbound.frameHeight ?? 0;
          fps = inbound.framesPerSecond ?? 0;
        }
      }
    });
    if (!width && camTrack) {
      const settings = camTrack.getSettings();
      width = settings.width ?? 0;
      height = settings.height ?? 0;
      fps = settings.frameRate ?? 0;
    }
    V().set({
      quality: {
        width,
        height,
        fps,
        rttMs,
        bitrateKbps: Math.round(currentBitrate / 1000),
        label: qualityLabel(width, height),
      },
    });
    if (mode === "video" && videoSender) {
      const wanted = targetBitrate(available, currentBitrate);
      if (wanted !== currentBitrate) {
        currentBitrate = wanted;
        await applyVideoParameters(videoSender, currentBitrate);
      }
    }
  } catch {
    /* getStats is informational; never let it disturb a live call */
  } finally {
    statsBusy = false;
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
  try {
    const ctx = ensureMeterContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    localAnalyser = analyser;
    startMeterLoop();
  } catch (error) {
    // Speaking indicators are optional; a missing AudioContext must not kill the call.
    console.warn("local voice meter unavailable", error);
  }
}

function setupRemoteMeter(stream: MediaStream) {
  try {
    const ctx = ensureMeterContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(analyser);
    remoteAnalyser = analyser;
    startMeterLoop();
  } catch (error) {
    console.warn("remote voice meter unavailable", error);
  }
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
    mode: "voice",
    micOn: false,
    camOn: false,
    musicDucked: false,
    peerId: null,
    peerName: null,
    speaking: false,
    peerSpeaking: false,
    reconnecting: false,
    error: null,
    localStream: null,
    remoteStream: null,
    quality: null,
  });
}

function teardown() {
  // Invalidate any start/accept flow still awaiting a mic or fetch below us.
  callGeneration++;
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
  stopStats();
  stopMeters();
  setCallSignalingUrgent(false);
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  micTrack = null;
  camTrack = null;
  videoSender = null;
  currentBitrate = VIDEO_MAX_BITRATE;
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
  mode = "voice";
  restartAttempted = false;
  setMusicDuck(false);
  V().set({ localStream: null, remoteStream: null, quality: null });
}

function failCall(message: string) {
  const peerId = peer?.id ?? null;
  teardown();
  resetStore();
  V().set({ error: message });
  // Release the server-side call seat so the other side stops ringing.
  if (peerId) void sendSignal("bye", peerId, "", { leave: true });
  toast("Call unavailable", message, "warn");
}

/** POST an offer/answer once, with a single retry for cold starts/flaky mobile networks. */
async function sendNegotiation(kind: "offer" | "answer", to: string, sdp: string, join: boolean): Promise<boolean> {
  let ok = await sendSignal(kind, to, sdp, join ? { join: true } : undefined);
  if (!ok) {
    await new Promise((resolve) => setTimeout(resolve, 700));
    ok = await sendSignal(kind, to, sdp, join ? { join: true } : undefined);
  }
  return ok;
}

/** Outgoing call from the room's "Voice call" / "Video call" buttons. */
export async function startCall(peerId: string, peerName: string, callMode: CallMode = "voice") {
  const session = useRoom.getState().session;
  if (!session || V().status !== "idle") return;
  if (peerId === session.memberId) return;
  const generation = callGeneration;
  role = "caller";
  peer = { id: peerId, name: peerName };
  mode = callModeOf(callMode);
  setCallSignalingUrgent(true);
  V().set({ status: "requesting", mode, peerId, peerName, micOn: true, camOn: false, musicDucked: false, error: null, reconnecting: false });
  try {
    const conn = createPeerConnection();
    pc = conn;
    await attachMedia(conn, mode, generation);
    if (generation !== callGeneration) return;
    const offer = await conn.createOffer();
    const sdp = await applyLocalDescription(conn, offer);
    const ok = await sendNegotiation("offer", peerId, sdp, true);
    if (generation !== callGeneration) return;
    if (!ok) throw new Error("signaling");
    ringTimer = setTimeout(() => failCall("No answer — they may be away"), RING_TIMEOUT_MS);
  } catch (error) {
    if (generation !== callGeneration) return;
    console.error("startCall failed", error);
    failCall(
      error instanceof Error && error.message === "unsupported"
        ? "This browser does not support calls"
        : "Couldn't reach the microphone/camera or the room"
    );
  }
}

/** Accept an incoming ringing call. */
export async function acceptCall() {
  const state = V();
  if (state.status !== "ringing" || !state.peerId) return;
  // The offer must be waiting already; without it negotiation can never start.
  if (!pendingOffer) {
    failCall("The call offer expired — ask them to call again");
    return;
  }
  // The SDP itself is authoritative: if the peer negotiated video, open the
  // camera even when this client somehow missed the room's callMode field.
  const callMode: CallMode = state.mode === "video" || /(^|\r?\n)m=video /.test(pendingOffer.data) ? "video" : "voice";
  const generation = callGeneration;
  role = "callee";
  peer = { id: state.peerId, name: state.peerName ?? "Listener" };
  mode = callMode;
  setCallSignalingUrgent(true);
  state.set({ status: "connecting", mode: callMode, micOn: true, error: null });
  try {
    const conn = createPeerConnection();
    pc = conn;
    await attachMedia(conn, callMode, generation);
    if (generation !== callGeneration) return;
    const offer = pendingOffer;
    pendingOffer = null;
    if (offer) await handleOffer(offer);
  } catch (error) {
    if (generation !== callGeneration) return;
    console.error("acceptCall failed", error);
    failCall(
      error instanceof Error && error.message === "unsupported"
        ? "This browser does not support calls"
        : "Couldn't open your microphone/camera"
    );
  }
}

/** Decline a ringing call without opening the microphone or camera. */
export async function declineCall() {
  const state = V();
  if (state.status !== "ringing" || !state.peerId) return;
  await sendSignal("bye", state.peerId, "", { leave: true });
  pendingOffer = null;
  setCallSignalingUrgent(false);
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

/** Turn the local camera on/off without renegotiating (the track stays live). */
export function toggleCam() {
  if (!camTrack) {
    toast("Camera unavailable", "No camera was available when this call started", "warn");
    return;
  }
  const next = !V().camOn;
  camTrack.enabled = next;
  V().set({ camOn: next });
}

/** Video calls keep the song at full volume; this is the optional duck switch. */
export function toggleMusicDuck() {
  const next = !V().musicDucked;
  setMusicDuck(next);
  V().set({ musicDucked: next });
}

/**
 * Mark the local seat as ringing because another member's call presence
 * appeared. Driven by the room-state watcher in the call UI.
 */
export function markRinging(peerId: string, peerName: string, callMode: CallMode = "voice") {
  if (V().status !== "idle") return;
  peer = { id: peerId, name: peerName };
  mode = callModeOf(callMode);
  setCallSignalingUrgent(true);
  V().set({ status: "ringing", mode, peerId, peerName, error: null });
}

/** A ringing call vanished (cancelled before we accepted). */
export function cancelRinging() {
  if (V().status !== "ringing") return;
  pendingOffer = null;
  peer = null;
  mode = "voice";
  setCallSignalingUrgent(false);
  resetStore();
}

/** Local reset when the room/session disappears (navigation, removal, reload). */
export function resetVoiceCall() {
  if (V().status === "idle" && !peer) return;
  teardown();
  resetStore();
}

/** Clear a stale server-side call presence for this seat after a reload. */
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
