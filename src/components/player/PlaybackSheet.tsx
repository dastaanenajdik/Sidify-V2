"use client";

import { useEffect } from "react";
import { Activity, Gauge, Moon, MonitorPlay, SlidersHorizontal } from "lucide-react";
import { usePlayer } from "@/store/player";
import { useUi } from "@/store/ui";
import { useSettings, EQ_BANDS, EQ_PRESETS, effectiveGains } from "@/store/settings";
import { applySettings, clearSleepTimer, setSleepTimer, setSpeed, setVideoMode } from "@/lib/audioEngine";
import { useRoom } from "@/lib/rooms/client";
import { cx, formatTime } from "@/lib/format";
import { Chips, Sheet, Switch } from "../ui";
import { useNow } from "@/lib/useNow";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

/** The capsule's headphones button: how this device plays the music. */
export default function PlaybackSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const videoMode = usePlayer((s) => s.videoMode);
  const speed = usePlayer((s) => s.speed);
  const inRoom = useRoom((s) => !!s.session);
  return (
    <Sheet open={open} onClose={onClose} title="Playback" subtitle="Only changes how it plays on this device">
      <div className="space-y-6">
        <Row icon={<MonitorPlay size={18} />} title="Watch the video" desc="Play the music video instead of audio only">
          <Switch checked={videoMode} onChange={(v) => void setVideoMode(v)} label="Video mode" />
        </Row>

        <Block icon={<Gauge size={18} />} title="Speed">
          <Chips
            value={String(speed)}
            options={SPEEDS.map((v) => ({ id: String(v), label: `${v}×` }))}
            onChange={(v) => setSpeed(Number(v))}
            size="sm"
          />
          {inRoom && speed !== 1 && <p className="mt-2 text-[12px] text-fg-2">Other speeds drift out of sync in a room.</p>}
        </Block>

        <SleepBlock />
        <EqBlock />

        <button
          type="button"
          onClick={() => {
            onClose();
            useUi.getState().setStatsOpen(true);
          }}
          className="flex w-full items-center gap-3 rounded-[12px] bg-fill px-4 py-3 text-left hover:bg-fill-2"
        >
          <Activity size={18} />
          <span className="flex-1 text-[15px]">Stats for nerds</span>
        </button>
      </div>
    </Sheet>
  );
}

function Row({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-fg-2">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-medium">{title}</div>
        {desc && <div className="text-[12.5px] text-fg-2">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

function Block({ icon, title, trailing, children }: { icon: React.ReactNode; title: string; trailing?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex items-center gap-3">
        <span className="text-fg-2">{icon}</span>
        <span className="flex-1 text-[15px] font-medium">{title}</span>
        {trailing}
      </div>
      {children}
    </div>
  );
}

export function SleepBlock() {
  const sleepMode = usePlayer((s) => s.sleepMode);
  const endsAt = usePlayer((s) => s.sleepEndsAt);
  const now = useNow(sleepMode === "timer" ? 1000 : 0);
  const left = endsAt ? Math.max(0, endsAt - now) : 0;
  const value = sleepMode === "eot" ? "eot" : sleepMode === "timer" ? "on" : "off";
  return (
    <Block
      icon={<Moon size={18} />}
      title="Sleep timer"
      trailing={
        sleepMode ? (
          <span className="text-[13px] font-semibold text-playing tabular-nums">{sleepMode === "eot" ? "End of song" : formatTime(left)}</span>
        ) : null
      }
    >
      <Chips
        value={value as string}
        size="sm"
        options={[
          { id: "off", label: "Off" },
          { id: "15", label: "15 min" },
          { id: "30", label: "30 min" },
          { id: "45", label: "45 min" },
          { id: "60", label: "1 hour" },
          { id: "eot", label: "End of song" },
          ...(value === "on" ? [{ id: "on", label: "Running" }] : []),
        ]}
        onChange={(v) => {
          if (v === "off") clearSleepTimer();
          else if (v === "eot") setSleepTimer("eot");
          else if (v !== "on") setSleepTimer(Number(v));
        }}
      />
    </Block>
  );
}

export function EqBlock() {
  const eqPreset = useSettings((s) => s.eqPreset);
  const eqGains = useSettings((s) => s.eqGains);
  const set = useSettings((s) => s.set);
  const gains = effectiveGains({ eqPreset, eqGains });
  useEffect(() => {
    applySettings();
  }, [eqPreset, eqGains]);
  return (
    <Block icon={<SlidersHorizontal size={18} />} title="Equalizer">
      <Chips
        value={eqPreset}
        size="sm"
        options={Object.entries(EQ_PRESETS).map(([id, p]) => ({ id, label: p.label }))}
        onChange={(v) => set({ eqPreset: v })}
      />
      <div className="mt-4 flex items-end justify-between gap-1 px-1">
        {EQ_BANDS.map((band, i) => (
          <div key={band} className="flex flex-col items-center gap-1.5">
            <span className="text-[10.5px] font-semibold text-fg-2 tabular-nums">{gains[i] > 0 ? `+${gains[i]}` : gains[i]}</span>
            <input
              type="range"
              className="v-slider"
              min={-12}
              max={12}
              step={1}
              value={gains[i]}
              aria-label={`${band} Hz`}
              onChange={(e) => {
                const nextGains = [...gains];
                nextGains[i] = Number(e.target.value);
                set({ eqPreset: "custom", eqGains: nextGains });
              }}
            />
            <span className={cx("text-[10.5px] text-fg-2 tabular-nums")}>{band >= 1000 ? `${band / 1000}k` : band}</span>
          </div>
        ))}
      </div>
    </Block>
  );
}
