"use client";

import { useEffect, useRef } from "react";
import { CameraOff, Loader2, Mic, MicOff, Music2, PhoneOff, Video, VideoOff, VolumeX, Wifi } from "lucide-react";
import { cx } from "@/lib/format";
import { endCall, toggleCam, toggleMic, toggleMusicDuck, useVoice } from "@/lib/rooms/voice";

/**
 * The live 4K video-call panel. Both <video> elements are muted on purpose:
 * the peer's voice is played by the call engine's hidden <audio> element, so
 * audio survives even if this tile is scrolled out of view or re-mounted.
 */
export function VideoCallLive() {
  const local = useVoice((s) => s.localStream);
  const remote = useVoice((s) => s.remoteStream);
  const quality = useVoice((s) => s.quality);
  const camOn = useVoice((s) => s.camOn);
  const micOn = useVoice((s) => s.micOn);
  const musicDucked = useVoice((s) => s.musicDucked);
  const peerName = useVoice((s) => s.peerName);
  const peerSpeaking = useVoice((s) => s.peerSpeaking);
  const reconnecting = useVoice((s) => s.reconnecting);

  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = remoteRef.current;
    if (!el) return;
    el.srcObject = remote;
    if (remote) void el.play().catch(() => {});
  }, [remote]);

  useEffect(() => {
    const el = localRef.current;
    if (!el) return;
    el.srcObject = local;
    if (local) void el.play().catch(() => {});
  }, [local]);

  const hasRemote = !!remote;
  const hasRemoteVideo = hasRemote && remote!.getVideoTracks().length > 0;
  const resolution = quality?.width ? `${quality.width}×${quality.height}` : "up to 3840×2160";
  const rtt = quality?.rttMs != null ? `${Math.round(quality.rttMs)} ms` : null;

  return (
    <div className="p-2.5">
      <div className="relative aspect-video w-full overflow-hidden rounded-[14px] bg-black ring-1 ring-white/10">
        {/* Peer's 4K picture. object-cover keeps the framing without letterboxing. */}
        <video
          ref={remoteRef}
          autoPlay
          playsInline
          muted
          className={cx("h-full w-full object-cover", !hasRemoteVideo && "opacity-0")}
        />

        {!hasRemoteVideo && (
          <div className="absolute inset-0 grid place-items-center text-center text-white/70">
            <div>
              {hasRemote ? (
                <>
                  <VideoOff size={24} className="mx-auto mb-2" />
                  <p className="text-[13px] font-medium">Their camera is off</p>
                  <p className="text-[11.5px] text-white/50">You can still hear each other</p>
                </>
              ) : (
                <>
                  <Loader2 size={24} className="mx-auto mb-2 animate-spin" />
                  <p className="text-[13px] font-medium">Waiting for their camera…</p>
                  <p className="text-[11.5px] text-white/50">Audio is already connected</p>
                </>
              )}
            </div>
          </div>
        )}

        {/* Live quality readout: what is really arriving, not just what we asked for. */}
        <div className="pointer-events-none absolute top-2.5 left-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-md">
            <Video size={12} className="text-[#4ade80]" />
            {quality?.label ?? "4K UHD"}
            <span className="font-medium text-white/65">{resolution}</span>
          </span>
          {quality?.fps ? (
            <span className="rounded-full bg-black/55 px-2 py-1 text-[10.5px] font-semibold text-white/80 backdrop-blur-md">
              {Math.round(quality.fps)} fps
            </span>
          ) : null}
          <span className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10.5px] font-semibold text-white/80 backdrop-blur-md">
            <Wifi size={11} className="text-[#4ade80]" />
            {rtt ?? "low latency"}
            {quality?.bitrateKbps ? ` · ${quality.bitrateKbps} kbps` : ""}
          </span>
        </div>

        {/* The song keeps playing during a video call — this is the headline. */}
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
            <Music2 size={12} className="text-[#ff8fa3]" />
            {musicDucked ? "Music lowered" : "Music playing · full volume"}
          </span>
          {reconnecting && (
            <span className="rounded-full bg-[#e5a148]/85 px-2 py-1 text-[10.5px] font-bold text-black">Reconnecting…</span>
          )}
        </div>

        {/* Self-view PiP, mirrored like a mirror. */}
        <div className="absolute right-2.5 bottom-2.5 h-[76px] w-[112px] overflow-hidden rounded-[10px] bg-fill-3 shadow-lg ring-1 ring-white/25 desk:h-[104px] desk:w-[156px]">
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            style={{ transform: "scaleX(-1)" }}
            className={cx("h-full w-full object-cover", !camOn && "opacity-0")}
          />
          {!camOn && (
            <div className="absolute inset-0 grid place-items-center text-white/70">
              <CameraOff size={20} />
            </div>
          )}
          <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1.5 py-0.5 text-[9.5px] font-bold text-white">You</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 px-1 pt-3 pb-0.5">
        <span className={cx("relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-white", peerSpeaking ? "bg-[#1faf55]" : "bg-fill-3")}>
          <Video size={17} />
          {peerSpeaking && <span className="absolute inset-0 animate-ping rounded-full bg-[#1faf55]/50" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 truncate text-[14px] font-semibold">
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#1faf55]" />
            <span className="truncate">{peerName ?? "Video call"}</span>
            <span className="shrink-0 rounded-full bg-brand/15 px-2 py-0.5 text-[10px] font-bold text-brand">4K</span>
          </p>
          <p className="truncate text-[12px] text-fg-2">
            {peerSpeaking ? "Speaking · song keeps playing" : "Connected · HD audio + 4K video · song keeps playing"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleMic}
            aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
            aria-pressed={!micOn}
            title={micOn ? "Mute microphone" : "Unmute microphone"}
            className={cx("grid h-10 w-10 place-items-center rounded-full transition-transform hover:scale-105 active:scale-95", micOn ? "bg-fill text-fg hover:bg-fill-2" : "bg-[#e5484d] text-white")}
          >
            {micOn ? <Mic size={17} /> : <MicOff size={17} />}
          </button>
          <button
            type="button"
            onClick={toggleCam}
            aria-label={camOn ? "Turn camera off" : "Turn camera on"}
            aria-pressed={!camOn}
            title={camOn ? "Turn camera off" : "Turn camera on"}
            className={cx("grid h-10 w-10 place-items-center rounded-full transition-transform hover:scale-105 active:scale-95", camOn ? "bg-fill text-fg hover:bg-fill-2" : "bg-[#e5484d] text-white")}
          >
            {camOn ? <Video size={17} /> : <VideoOff size={17} />}
          </button>
          <button
            type="button"
            onClick={toggleMusicDuck}
            aria-label={musicDucked ? "Restore music volume" : "Duck the music"}
            aria-pressed={musicDucked}
            title={musicDucked ? "Restore music volume" : "Duck the music (keep the song playing, just quieter)"}
            className={cx("grid h-10 w-10 place-items-center rounded-full transition-transform hover:scale-105 active:scale-95", musicDucked ? "bg-[#e5a148] text-black" : "bg-fill text-fg hover:bg-fill-2")}
          >
            {musicDucked ? <VolumeX size={17} /> : <Music2 size={17} />}
          </button>
          <button
            type="button"
            onClick={() => void endCall()}
            aria-label="End call"
            className="grid h-10 w-10 place-items-center rounded-full bg-[#e5484d] text-white transition-transform hover:scale-105 active:scale-95"
          >
            <PhoneOff size={17} />
          </button>
        </div>
      </div>
    </div>
  );
}
