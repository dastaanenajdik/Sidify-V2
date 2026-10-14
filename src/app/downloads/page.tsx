"use client";

import { useEffect, useState } from "react";
import { Download, HardDrive, Play, X } from "lucide-react";
import { DOWNLOADS_ENABLED, useDownloads } from "@/lib/library";
import { playContext } from "@/lib/audioEngine";
import { usePlayer, currentTrack } from "@/store/player";
import { useSettings } from "@/store/settings";
import { cx, formatBytes, formatTime } from "@/lib/format";
import { Artwork, Button, EmptyState, IconButton, PageTitle } from "@/components/ui";
import { PlayingBars } from "@/components/icons";

const QUALITY: Record<string, string> = { low: "Data saver", medium: "Standard", high: "High" };

export default function DownloadsPage() {
  const { data, remove, clear } = useDownloads();
  const quality = useSettings((s) => s.downloadQuality);
  const rows = data?.downloads ?? [];
  const tracks = rows.map((r) => r.track);
  const total = rows.reduce((a, r) => a + (r.sizeBytes || 0), 0);
  const playingId = usePlayer((s) => currentTrack(s)?.id);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null);

  useEffect(() => {
    navigator.storage?.estimate?.().then((e) => setEstimate({ usage: e.usage || 0, quota: e.quota || 0 })).catch(() => {});
  }, [rows.length]);
  const pct = estimate?.quota ? Math.min(100, (estimate.usage / estimate.quota) * 100) : 0;

  return (
    <div className="fade-up">
      <PageTitle
        trailing={
          rows.length ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => playContext(tracks, 0, "Downloads")}>
                <Play size={14} fill="currentColor" /> Play
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void clear()}>
                Delete all
              </Button>
            </>
          ) : null
        }
      >
        Downloads
      </PageTitle>

      <div className="mx-4 mb-6 max-w-[760px] rounded-[16px] bg-raised p-4 ring-1 ring-edge desk:mx-8">
        <div className="mb-3 flex items-center gap-3">
          <HardDrive size={20} className="text-fg-2" />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold">On this device</div>
            <div className="text-[12.5px] text-fg-2">
              {rows.length} song{rows.length === 1 ? "" : "s"} · {formatBytes(total)}
              {estimate ? ` · browser storage ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)}` : ""} · quality {QUALITY[quality]}
            </div>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-fill-2">
          <div className="h-full rounded-full bg-fg/80 transition-all duration-700" style={{ width: `${Math.max(pct, rows.length ? 2 : 0)}%` }} />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Download size={28} />}
          title={DOWNLOADS_ENABLED ? "No downloads yet" : "Downloads are coming soon"}
          desc={
            DOWNLOADS_ENABLED
              ? "Choose “Download” from any song's menu — it plays from this device, even offline."
              : "Saving songs for offline listening is being finished. Everything else works as usual."
          }
        />
      ) : (
        <div className="px-2 desk:px-6">
          {rows.map((r, i) => {
            const t = r.track;
            const active = playingId === t.id;
            return (
              <div
                key={r.trackId}
                role="button"
                tabIndex={0}
                onClick={() => playContext(tracks, i, "Downloads")}
                className="group flex h-[64px] cursor-default items-center gap-3 rounded-[8px] px-2 hover:bg-fill"
              >
                <span className="relative shrink-0">
                  <Artwork src={t.artwork} size={52} rounded="rounded-[6px]" className="h-[52px] w-[52px]" />
                  {active && (
                    <span className="absolute inset-0 grid place-items-center rounded-[6px] bg-black/45 text-white">
                      <PlayingBars paused={!isPlaying} />
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cx("block truncate text-[15px]", active && "text-playing")}>{t.title}</span>
                  <span className="block truncate text-[13px] text-fg-2">
                    {t.artist} · {formatTime(t.durationMs)}
                  </span>
                </span>
                <span className="text-right text-[12px] text-fg-2 tabular-nums">
                  {QUALITY[r.quality] ?? r.quality}
                  <br />
                  {formatBytes(r.sizeBytes)}
                </span>
                <IconButton
                  label="Remove download"
                  size={32}
                  className="text-fg-2 opacity-100 desk:opacity-0 desk:group-hover:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(r.trackId);
                  }}
                >
                  <X size={16} />
                </IconButton>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
