"use client";

/* Menu callbacks access media refs only when the user selects an option. */
/* eslint-disable react-hooks/refs */

import { useEffect, useState, type RefObject } from "react";
import { Captions, Check, Gauge, Languages, Maximize, Pause, Play, Volume2, VolumeX } from "lucide-react";
import type { ShakaAudioTrackOption, ShakaPlaybackHandle, ShakaTextTrackOption, ShakaVideoQualityOption } from "@/lib/media/shakaPlayer";

export const BUFFERING_TIP = "Agar play karte waqt zyada buffering ho rahi hai, toh quality kam karke dekhein. Ho sakta hai aapke internet connection ki dikkat ho.";

type QualityChoice = { label: string; selected: boolean; onSelect: () => void };
type MenuName = "Quality" | "Subtitles" | "Speed" | "Audio";

/** Controls are inside the video container so menus remain available in fullscreen. */
export function PlayerControls({ videoRef, handleRef, audio, text, video, releases = [] }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  handleRef: RefObject<ShakaPlaybackHandle | null>;
  audio: ShakaAudioTrackOption[];
  text: ShakaTextTrackOption[];
  video: ShakaVideoQualityOption[];
  releases?: QualityChoice[];
}) {
  const [menu, setMenu] = useState<MenuName | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
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
    <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black via-black/85 to-transparent px-3 pt-9 pb-3 text-white sm:px-5" onKeyDown={(e) => { if (e.key === "Escape" && menu) { e.stopPropagation(); setMenu(null); } }}>
      {menu && (
        <div className="absolute right-3 bottom-full z-20 mb-1 max-h-[80px] sm:max-h-[160px] w-52 overflow-y-auto rounded-xl bg-neutral-900/95 p-2 shadow-xl ring-1 ring-white/20" role="menu" aria-label={`${menu} options`}>
          <p className="px-3 py-2 text-xs font-bold uppercase tracking-wider text-white/60">{menu}</p>
          {options[menu].length ? options[menu].map((option, index) => <button key={`${option.label}-${index}`} type="button" role="menuitemradio" aria-checked={option.selected} onClick={() => { option.onSelect(); setMenu(null); }} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-white/15 focus-visible:bg-white/20">{option.label}{option.selected && <Check size={16} />}</button>) : <p className="px-3 py-2 text-xs text-white/60">No options available for this stream</p>}
          {menu === "Subtitles" && text.length === 0 && <p className="px-3 pb-2 text-xs text-white/60">No subtitles available</p>}
        </div>
      )}
      <input aria-label="Seek" type="range" min={0} max={duration || 0} step="0.1" value={Math.min(time, duration)} disabled={!duration} onChange={(e) => { if (videoRef.current) videoRef.current.currentTime = Number(e.target.value); }} className="mb-2 w-full accent-red-600" />
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => { const el = videoRef.current; if (el) { if (el.paused) void el.play().catch(() => {}); else el.pause(); } }} className="rounded p-1 hover:bg-white/15">{playing ? <Pause size={20} /> : <Play size={20} />}</button>
        <button type="button" aria-label={muted ? "Unmute" : "Mute"} onClick={() => { if (videoRef.current) videoRef.current.muted = !videoRef.current.muted; }} className="rounded p-1 hover:bg-white/15">{muted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
        <span className="text-xs tabular-nums text-white/80">{fmt(time)} / {fmt(duration)}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1">
          {(["Quality", "Subtitles", "Speed", "Audio"] as const).map((name) => { const Icon = icons[name]; return <button key={name} type="button" aria-expanded={menu === name} onClick={() => setMenu(menu === name ? null : name)} className="flex items-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-semibold hover:bg-white/15 sm:px-2 sm:text-xs"><Icon size={15} /><span>{name}</span></button>; })}
          <button type="button" aria-label="Toggle fullscreen" onClick={() => { const container = videoRef.current?.parentElement; if (document.fullscreenElement) void document.exitFullscreen(); else if (container?.requestFullscreen) void container.requestFullscreen(); else videoRef.current?.requestFullscreen?.(); }} className="rounded p-1.5 hover:bg-white/15"><Maximize size={17} /></button>
        </div>
      </div>
    </div>
  );
}
