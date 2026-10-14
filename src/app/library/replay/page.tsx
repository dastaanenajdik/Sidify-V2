"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useMounted } from "@/lib/useMounted";
import { Play } from "lucide-react";
import { readPlayLog, entryTrack, type PlayEntry } from "@/lib/playLog";
import { computeReplay, type ReplayPeriod } from "@/lib/replay";
import { playContext } from "@/lib/audioEngine";
import { useSettings } from "@/store/settings";
import ReplayCard from "@/components/ReplayCard";
import { Artwork, Button, ButtonLink, Chips, EmptyState, PageTitle, SectionHeader, Shelf } from "@/components/ui";

const PERIODS: { id: ReplayPeriod; label: string }[] = [
  { id: "month", label: "This month" },
  { id: "year", label: "This year" },
  { id: "all", label: "All time" },
];

/** Replay — your listening, counted on this device. */
export default function ReplayPage() {
  const name = useSettings((s) => s.profileName);
  const mounted = useMounted();
  const log = useMemo<PlayEntry[]>(() => (mounted ? readPlayLog() : []), [mounted]);
  const [period, setPeriod] = useState<ReplayPeriod>("year");
  const stats = useMemo(() => computeReplay(log, period), [log, period]);
  const since = stats.firstAt ? new Date(stats.firstAt).toLocaleDateString(undefined, { month: "2-digit", year: "2-digit" }) : null;
  const topTracks = stats.songs.slice(0, 25).map((s) => entryTrack(s.entry));
  const maxHour = Math.max(1, ...stats.byHour);
  const peakHour = stats.byHour.indexOf(Math.max(...stats.byHour));
  const label = `Replay · ${PERIODS.find((p) => p.id === period)?.label}`;

  return (
    <div className="fade-up">
      <PageTitle trailing={<span className="text-[13px] font-semibold text-fg-2">On this device</span>}>Replay</PageTitle>
      <Chips className="mb-5 px-4 desk:px-8" value={period} options={PERIODS} onChange={setPeriod} />

      {stats.plays === 0 ? (
        <EmptyState
          title="Nothing to replay yet"
          desc="Listen for a while — your minutes, top songs and top artists build up here."
          action={<ButtonLink href="/">Start listening</ButtonLink>}
        />
      ) : (
        <>
          <div className="mb-8">
            <Shelf gap={12}>
              <ReplayCard
                label="Minutes listened"
                value={stats.minutes.toLocaleString()}
                detail={`${stats.plays} plays · ${stats.activeDays} active day${stats.activeDays === 1 ? "" : "s"}`}
                artwork={stats.songs[0]?.entry.art}
                holder={name}
                since={since}
                href="#songs"
              />
              {stats.artists[0] && (
                <ReplayCard
                  label="Top artist"
                  value={stats.artists[0].name}
                  detail={`${stats.artists[0].plays} plays · ${Math.round(stats.artists[0].ms / 60000)} min`}
                  artwork={stats.artists[0].artwork}
                  holder={name}
                  since={since}
                  href="#artists"
                />
              )}
              {stats.songs[0] && (
                <ReplayCard
                  label="Top song"
                  value={stats.songs[0].entry.t}
                  detail={`${stats.songs[0].entry.a} · ${stats.songs[0].plays} plays`}
                  artwork={stats.songs[0].entry.art}
                  holder={name}
                  since={since}
                  href="#songs"
                />
              )}
              <ReplayCard
                label="Streak"
                value={`${stats.streak} day${stats.streak === 1 ? "" : "s"}`}
                detail={stats.byHour.some(Boolean) ? `Most often around ${peakHour % 12 || 12} ${peakHour < 12 ? "AM" : "PM"}` : undefined}
                artwork={stats.songs[1]?.entry.art ?? stats.songs[0]?.entry.art}
                holder={name}
                since={since}
                href="#hours"
              />
            </Shelf>
          </div>

          <section id="songs" className="mb-9 scroll-mt-4">
            <SectionHeader
              title="Top songs"
              trailing={
                <Button size="sm" variant="secondary" onClick={() => playContext(topTracks, 0, label)}>
                  <Play size={13} fill="currentColor" /> Play all
                </Button>
              }
            />
            <ol className="px-2 desk:px-6">
              {stats.songs.slice(0, 25).map((s, i) => (
                <li key={s.entry.id}>
                  <button
                    type="button"
                    onClick={() => playContext(topTracks, i, label)}
                    className="flex h-[64px] w-full items-center gap-3 rounded-[8px] px-2 text-left hover:bg-fill"
                  >
                    <span className="w-6 shrink-0 text-center text-[15px] font-semibold text-fg-2 tabular-nums">{i + 1}</span>
                    <Artwork src={s.entry.art} size={48} rounded="rounded-[6px]" className="h-12 w-12 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{s.entry.t}</span>
                      <span className="block truncate text-[13px] text-fg-2">{s.entry.a}</span>
                    </span>
                    <span className="shrink-0 text-right text-[12.5px] text-fg-2 tabular-nums">
                      {s.plays} play{s.plays === 1 ? "" : "s"}
                      <br />
                      {Math.max(1, Math.round(s.ms / 60000))} min
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </section>

          <section id="artists" className="mb-9 scroll-mt-4">
            <SectionHeader title="Top artists" />
            <Shelf>
              {stats.artists.slice(0, 15).map((a, i) => {
                const card = (
                  <>
                    <div className="relative">
                      <Artwork src={a.artwork} size={170} round className="aspect-square w-full" />
                      <span className="absolute top-1 left-1 grid h-7 min-w-7 place-items-center rounded-full bg-black/65 px-1.5 text-[12px] font-bold text-white">{i + 1}</span>
                    </div>
                    <div className="mt-2 truncate text-center text-[14px] font-medium">{a.name}</div>
                    <div className="text-center text-[12px] text-fg-2">
                      {a.plays} plays · {Math.max(1, Math.round(a.ms / 60000))} min
                    </div>
                  </>
                );
                return a.artistId ? (
                  <Link key={a.name} href={`/artist/${encodeURIComponent(a.artistId)}`} className="block w-[140px] shrink-0 snap-start desk:w-[160px]">
                    {card}
                  </Link>
                ) : (
                  <div key={a.name} className="w-[140px] shrink-0 snap-start desk:w-[160px]">
                    {card}
                  </div>
                );
              })}
            </Shelf>
          </section>

          <section id="hours" className="mb-9 scroll-mt-4 px-4 desk:px-8">
            <h2 className="t-section mb-3">When you listen</h2>
            <div className="flex h-36 items-end gap-[3px] rounded-[16px] bg-raised p-4 ring-1 ring-edge">
              {stats.byHour.map((v, h) => (
                <div key={h} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${h}:00 · ${Math.round(v / 60000)} min`}>
                  <div className="w-full rounded-t-[3px] bg-playing/80" style={{ height: `${Math.max(2, (v / maxHour) * 100)}%`, opacity: v ? 1 : 0.25 }} />
                  {h % 6 === 0 && <span className="text-[9.5px] text-fg-3 tabular-nums">{h}</span>}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
