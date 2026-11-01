"use client";

/* Menu callbacks access media refs only when the user selects an option. */
/* eslint-disable react-hooks/refs */

import { useEffect, useRef, useState, type RefObject } from "react";
import { Captions, Check, Gauge, Languages, Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { ShakaAudioTrackOption, ShakaPlaybackHandle, ShakaTextTrackOption, ShakaVideoQualityOption } from "@/lib/media/shakaPlayer";

export const BUFFERING_TIP = "Agar play karte waqt zyada buffering ho rahi hai, toh quality kam karke dekhein. Ho sakta hai aapke internet connection ki dikkat ho. Internet band hone par video sirf buffered hissa khatam hone tak chalega.";

type QualityChoice = { label: string; selected: boolean; onSelect: () => void };
type MenuName = "Quality" | "Subtitles" | "Speed" | "Audio";

/** Controls are inside the video container so menus remain available in fullscreen. */
export function PlayerControls({ videoRef, handleRef, audio, text, video, releases = [], visible = true }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  handleRef: RefObject<ShakaPlaybackHandle | null>;
  audio: ShakaAudioTrackOption[];
  text: ShakaTextTrackOption[];
  video: ShakaVideoQualityOption[];
  releases?: QualityChoice[];
  visible?: boolean;
}) {
  const [menu, setMenu] = useState<MenuName | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [landscapeHint, setLandscapeHint] = useState(false);
  const [rotateHint, setRotateHint] = useState(false);
  const autoTried = useRef(false);
  const orientationLocked = useRef(false);
  const [quality, setQuality] = useState<number | "auto">("auto");

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    const update = () => {
      setPlaying(!el.paused && !el.ended);
      setMuted(el.muted || el.volume === 0);
      setTime(Number.isFinite(el.currentTime) ? el.currentTime : 0);
      setDuration(Number.isFinite(el.duration) ? el.duration : 0);
      setSpeed(el.playbackRate);
    };
    const events = ["play", "pause", "ended", "timeupdate", "durationchange", "volumechange", "ratechange", "loadedmetadata"];
    events.forEach((event) => el.addEventListener(event, update));
    update();
    return () => events.forEach((event) => el.removeEventListener(event, update));
  }, [videoRef]);

  // Fullscreen and orientation locking are browser permissions, not guarantees. A
  // delayed autoplay often has no user activation; keep a one-tap fallback visible.
  const enterFullscreen = async () => {
    const el = videoRef.current;
    const container = el?.parentElement;
    if (!el || !container) return;
    try {
      if (container.requestFullscreen) {
        await container.requestFullscreen();
        if (document.fullscreenElement !== container) return;
        if (window.matchMedia?.("(pointer: coarse)").matches) {
          const orientation = window.screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
          try {
            if (orientation?.lock) {
              await orientation.lock("landscape");
              if (document.fullscreenElement === container) orientationLocked.current = true;
              else orientation.unlock?.();
            }
          } catch { /* iOS and some browsers do not allow orientation lock. */ }
          if (!orientationLocked.current && window.matchMedia?.("(orientation: portrait)").matches) setRotateHint(true);
        }
        setLandscapeHint(false);
      } else {
        const iosVideo = el as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
        if (!iosVideo.webkitEnterFullscreen) throw new Error("Fullscreen unavailable");
        iosVideo.webkitEnterFullscreen();
        setLandscapeHint(false);
      }
    } catch {
      setLandscapeHint(true);
    }
  };
  const enterRef = useRef(enterFullscreen);
  useEffect(() => { enterRef.current = enterFullscreen; });
  useEffect(() => {
    const el = videoRef.current;
    const container = el?.parentElement;
    if (!el || !container) return;
    const mobile = () => Boolean(window.matchMedia?.("(pointer: coarse) and (max-width: 1024px)").matches);
    const tryAuto = () => {
      if (autoTried.current || !mobile()) return;
      autoTried.current = true;
      if (window.navigator.userActivation?.isActive) void enterRef.current();
      else setLandscapeHint(true);
    };
    const onFullscreenChange = () => {
      const isFullscreen = document.fullscreenElement === container;
      setFullscreen(isFullscreen);
      if (!isFullscreen) setRotateHint(false);
      if (!isFullscreen && orientationLocked.current) {
        window.screen.orientation?.unlock?.();
        orientationLocked.current = false;
      }
    };
    const onOrientationChange = () => {
      if (window.matchMedia?.("(orientation: landscape)").matches) setRotateHint(false);
    };
    window.addEventListener("resize", onOrientationChange);
    el.addEventListener("playing", tryAuto);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    if (!el.paused && el.readyState >= 2) tryAuto();
    return () => {
      window.removeEventListener("resize", onOrientationChange);
      el.removeEventListener("playing", tryAuto);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (orientationLocked.current) {
        window.screen.orientation?.unlock?.();
        orientationLocked.current = false;
      }
      if (document.fullscreenElement === container) void document.exitFullscreen().catch(() => {});
    };
  }, [videoRef]);

  const fmt = (seconds: number) => {
    const s = Math.floor(seconds);
    const h = Math.floor(s / 3600);
    return `${h ? `${h}:` : ""}${h ? String(Math.floor(s / 60) % 60).padStart(2, "0") : Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  const options: Record<MenuName, QualityChoice[]> = {
    Quality: [
      ...(video.length ? [{ label: "Auto (adaptive)", selected: quality === "auto", onSelect: () => { handleRef.current?.selectVideoQuality("auto"); setQuality("auto"); } }, ...video.filter((v) => v.height).map((v) => ({ label: `${v.height}p`, selected: quality === v.height, onSelect: () => { handleRef.current?.selectVideoQuality(v.height!); setQuality(v.height!); } }))] : []),
      ...releases,
    ],
    Subtitles: [{ label: "Off", selected: !text.some((t) => t.active), onSelect: () => { void handleRef.current?.selectTextTrack(null); } }, ...text.map((t) => ({ label: t.label, selected: t.active, onSelect: () => { void handleRef.current?.selectTextTrack(t.id); } }))],
    Speed: [0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => ({ label: rate === 1 ? "Normal" : `${rate}×`, selected: speed === rate, onSelect: () => { if (videoRef.current) videoRef.current.playbackRate = rate; } })),
    Audio: audio.map((t) => ({ label: t.label, selected: t.active, onSelect: () => { handleRef.current?.selectAudioTrack(t.id); } })),
  };
  const icons = { Quality: Gauge, Subtitles: Captions, Speed: Gauge, Audio: Languages };
  return (
    <div hidden={!visible} className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/85 to-transparent px-2 pt-5 pb-2 text-white sm:px-5 sm:pt-9 sm:pb-3" onKeyDown={(e) => { if (e.key === "Escape" && menu) { e.stopPropagation(); setMenu(null); } }}>
      {menu && (
        <div className="absolute right-3 bottom-full z-20 mb-1 max-h-[80px] sm:max-h-[160px] w-52 overflow-y-auto rounded-xl bg-neutral-900/95 p-2 shadow-xl ring-1 ring-white/20" role="menu" aria-label={`${menu} options`}>
          <p className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/60">{menu}</p>
          {options[menu].length ? options[menu].map((option, index) => <button key={`${option.label}-${index}`} type="button" role="menuitemradio" aria-checked={option.selected} onClick={() => { option.onSelect(); setMenu(null); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/15 focus-visible:bg-white/20">{option.label}{option.selected && <Check size={16} />}</button>) : <p className="px-3 py-2 text-xs text-white/60">No options available for this stream</p>}
          {menu === "Subtitles" && text.length === 0 && <p className="px-3 pb-2 text-xs text-white/60">No subtitles available</p>}
        </div>
      )}
      {rotateHint && fullscreen && <p role="status" className="mb-1 rounded bg-black/80 px-2 py-1 text-xs text-white">Rotate your phone for landscape</p>}
      {landscapeHint && !fullscreen && <button type="button" onClick={() => void enterFullscreen()} className="mb-1 rounded bg-black/80 px-2 py-1 text-xs text-white">Tap for fullscreen &amp; landscape</button>}
      <input aria-label="Seek" type="range" min={0} max={duration || 0} step="0.1" value={Math.min(time, duration)} disabled={!duration} onChange={(e) => { if (videoRef.current) videoRef.current.currentTime = Number(e.target.value); }} className="mb-2 w-full accent-red-600" />
      <div className="flex items-center gap-x-1 gap-y-1 sm:gap-x-3">
        <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => { const el = videoRef.current; if (el) { if (el.paused) { if (!autoTried.current && window.matchMedia?.("(pointer: coarse) and (max-width: 1024px)").matches) { autoTried.current = true; void enterFullscreen(); } void el.play().catch(() => {}); } else el.pause(); } }} className="rounded p-1 hover:bg-white/15">{playing ? <Pause size={20} /> : <Play size={20} />}</button>
        <button type="button" aria-label={muted ? "Unmute" : "Mute"} onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }} className="rounded p-1 hover:bg-white/15">{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
        <span className="whitespace-nowrap text-[10px] tabular-nums text-white/80 sm:text-xs">{fmt(time)} / {fmt(duration)}</span>
        <div className="ml-auto flex min-w-0 items-center gap-0 sm:gap-1">
          {(["Quality", "Subtitles", "Speed", "Audio"] as const).map((name) => { const Icon = icons[name]; return <button key={name} type="button" aria-label={name} title={name} aria-expanded={menu === name} onClick={() => setMenu(menu === name ? null : name)} className="flex items-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-semibold hover:bg-white/15 sm:px-2 sm:text-xs"><Icon size={15} /><span className="sr-only min-[520px]:not-sr-only">{name}</span></button>; })}
          <button type="button" aria-label="Toggle fullscreen" onClick={() => { if (fullscreen) void document.exitFullscreen().catch(() => {}); else void enterFullscreen(); }} className="rounded p-1.5 hover:bg-white/15"><Maximize size={17} /></button>
        </div>
      </div>
    </div>
  );
}
