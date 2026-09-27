"use client";

import { useEffect, useState } from "react";
import { Check, Download, HardDrive, Trash2, X } from "lucide-react";
import { useDownloads } from "@/lib/library";
import { playContext } from "@/lib/audioEngine";
import { usePlayer } from "@/store/player";
import { useSettings } from "@/store/settings";
import { cx, formatBytes, formatTime, upscaleArtwork } from "@/lib/format";
import DownloadButton from "@/components/DownloadButton";
import { LiveEq } from "@/components/SidifyLogo";
import { currentTrack } from "@/store/player";

const QUALITY_META: Record<string, { label: string; kbps: string; cls: string }> = {
  low: { label: "Low", kbps: "96 kbps", cls: "text-amber-400" },
  medium: { label: "Medium", kbps: "160 kbps", cls: "text-sky-400" },
  high: { label: "High", kbps: "320 kbps", cls: "accent-text" },
};

export default function DownloadsPage() {
  const { data, remove, clear } = useDownloads();
  const downloadQuality = useSettings((s) => s.downloadQuality);
  const rows = data?.downloads ?? [];
  const tracks = rows.map((r) => r.track);
  const totalSize = rows.reduce((a, r) => a + (r.sizeBytes || 0), 0);
  const playingId = usePlayer((s) => currentTrack(s)?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);

  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);
  useEffect(() => {
    if (navigator.storage?.estimate) {
      navigator.storage.estimate().then((e) => setEstimate({ usage: e.usage || 0, quota: e.quota || 0 })).catch(() => {});
    }
  }, [rows.length]);

  const pct = estimate && estimate.quota ? Math.min(100, (estimate.usage / estimate.quota) * 100) : 0;

  return (
    <div className="mx-auto max-w-[1100px] px-4 pt-6 md:px-7">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[30px] font-extrabold tracking-tight md:text-[36px]">Downloads</h1>
          <p className="text-muted mt-1 text-[13.5px]">
            Real offline audio stored in this browser · tagged{" "}
            <span className="font-semibold text-[var(--text)]">{QUALITY_META[downloadQuality]?.label}</span> (change in Settings) ·
            use ⋮ → “Save to device” on any track for a file
          </p>
        </div>
        {rows.length > 0 && (
          <button
            onClick={() => void clear()}
            className="flex items-center gap-2 rounded-full border border-red-500/40 px-4 py-2 text-[12.5px] font-bold text-red-400 transition-colors hover:bg-red-500/10"
          >
            <Trash2 size={14} /> Clear all
          </button>
        )}
      </div>

      {/* storage meter */}
      <div className="glass mb-8 rounded-3xl p-5">
        <div className="mb-3 flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--panel-strong)]">
            <HardDrive size={20} className="accent-text" />
          </span>
          <div className="flex-1">
            <div className="text-[14.5px] font-bold">Offline storage</div>
            <div className="text-muted text-[12.5px]">
              {rows.length} songs · {formatBytes(totalSize)} of music
              {estimate ? ` · browser using ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}` : ""}
            </div>
          </div>
          <span className="accent-text text-[13px] font-bold tabular-nums">{estimate ? `${pct.toFixed(1)}%` : ""}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[var(--panel-strong)]">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.max(pct, rows.length ? 2 : 0)}%`, background: "linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 55%, white))", boxShadow: "0 0 12px var(--glow)" }}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="glass mx-auto mt-8 flex max-w-md flex-col items-center rounded-3xl px-8 py-14 text-center">
          <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-[var(--panel-strong)] text-muted">
            <Download size={28} />
          </div>
          <h3 className="font-display text-[18px] font-bold">No downloads yet</h3>
          <p className="text-muted mt-2 text-[13.5px] leading-6">
            Tap the download icon on any track — the audio file is saved locally and plays instantly, even with bad network.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => {
            const t = r.track;
            const active = playingId === t.id;
            const q = QUALITY_META[r.quality] || QUALITY_META.high;
            return (
              <div
                key={r.trackId}
                onClick={() => playContext(tracks, i, "Downloads")}
                className={cx("hover-panel group grid cursor-pointer grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl px-3 py-2.5", active && "bg-[var(--panel-strong)]")}
              >
                <div className="relative">
                  <img src={upscaleArtwork(t.artwork, 200)} alt="" loading="lazy" className="h-12 w-12 rounded-lg object-cover" />
                  <span className="absolute -right-1.5 -bottom-1.5 grid h-5 w-5 place-items-center rounded-full accent-bg text-black">
                    <Check size={11} strokeWidth={3.5} />
                  </span>
                </div>
                <div className="min-w-0">
                  <div className={cx("flex items-center gap-2 truncate text-[14px] font-semibold", active && "accent-text")}>
                    {active && isPlaying && <LiveEq size={12} />}
                    <span className="truncate">{t.title}</span>
                  </div>
                  <div className="text-muted truncate text-[12.5px]">
                    {t.artist} · {formatTime(t.durationMs)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className={cx("rounded-md bg-[var(--panel)] px-1.5 py-0.5 text-[10px] font-bold tracking-wider uppercase", q.cls)}>
                      {q.label}
                    </span>
                    <div className="text-muted-2 mt-1 text-[11px] tabular-nums">{formatBytes(r.sizeBytes)}</div>
                  </div>
                  <DownloadButton
                    track={t}
                    size={16}
                    toDevice
                    className="h-9 w-9 md:opacity-0 md:group-hover:opacity-100"
                  />
                  <button
                    aria-label="Remove download"
                    onClick={(e) => {
                      e.stopPropagation();
                      void remove(r.trackId);
                    }}
                    className="text-muted grid h-9 w-9 place-items-center rounded-full opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-400"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
