"use client";

import { useMemo, useState } from "react";
import { Archive, Calendar, Clock, Download, Play, Star } from "lucide-react";
import { Chips, SectionHeader } from "@/components/ui";
import { useSeasonEpisodes } from "@/lib/media/hooks";
import {
  downloadableReleases,
  isArchiveRelease,
  playableReleases,
  qualityTiers,
  sizeRangeLabel,
} from "@/lib/media/playbackPlan";
import { buildSeasonTabs, episodeCode, type SeasonTab } from "@/lib/media/seasonTabs";
import type { Episode, MediaReleaseItem, MediaTitle, Season } from "@/lib/media/types";
import { SOMETHING_WENT_WRONG } from "@/lib/media/userError";
import { formatPlaybackTime } from "@/lib/media/resumePoints";
import { cx } from "@/lib/format";
import { BetaBadge } from "./BetaPlayerSheet";
import { useResumePoint } from "./useResumePoint";
import type { WatchTarget } from "./watch";

type OpenTarget = (target: WatchTarget) => void;

function summary(releases: MediaReleaseItem[]): string {
  const tiers = qualityTiers(downloadableReleases(releases));
  return [tiers.join(" · "), sizeRangeLabel(releases)].filter(Boolean).join("  ·  ");
}

/** "Try Play (beta)" + "Download" for one item. Qualities are chosen later, in the sheets. */
export function WatchActions({
  releases,
  onPlay,
  onDownload,
  resumeKey,
  size = "md",
}: {
  releases: MediaReleaseItem[];
  onPlay: () => void;
  onDownload: () => void;
  /** `WatchTarget.key` — shows "Resume 23:10" when this item was left part-way. */
  resumeKey?: string;
  size?: "md" | "sm";
}) {
  const canPlay = playableReleases(releases).length > 0;
  const canDownload = downloadableReleases(releases).length > 0;
  const resumeAt = useResumePoint(resumeKey);
  const base = cx(
    "inline-flex shrink-0 items-center gap-1.5 rounded-full font-semibold transition-[background,opacity,transform] active:scale-[0.97]",
    size === "md" ? "h-10 px-4 text-[14px]" : "h-8 px-3 text-[12.5px]"
  );
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
      {canPlay && (
        <button type="button" onClick={onPlay} className={cx(base, "bg-primary text-on-primary hover:opacity-90")}>
          <Play size={size === "md" ? 15 : 12} fill="currentColor" aria-hidden="true" />{" "}
          {resumeAt !== null ? `Resume ${formatPlaybackTime(resumeAt)}` : "Try Play"}
          <BetaBadge tone="inverse" />
        </button>
      )}
      {canDownload && (
        <button type="button" onClick={onDownload} className={cx(base, "bg-fill-2 text-fg hover:bg-fill-3")}>
          <Download size={size === "md" ? 15 : 12} aria-hidden="true" /> Download
        </button>
      )}
    </div>
  );
}

/** A movie is one row: one Try Play, one Download (quality chosen in the popup). */
export function MovieWatchSection({
  title,
  target,
  onPlay,
  onDownload,
}: {
  title: MediaTitle;
  target: WatchTarget;
  onPlay: OpenTarget;
  onDownload: OpenTarget;
}) {
  return (
    <section id="watch" aria-labelledby="watch-heading" className="px-4 desk:px-8">
      <div className="rounded-[16px] bg-raised/70 p-4 ring-1 ring-edge desk:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 id="watch-heading" className="t-title truncate">
              {title.title}
              {title.year ? ` (${title.year})` : ""}
            </h2>
            <p className="mt-0.5 text-[12.5px] text-fg-2">{summary(target.releases)}</p>
          </div>
          <WatchActions
            releases={target.releases}
            resumeKey={target.key}
            onPlay={() => onPlay(target)}
            onDownload={() => onDownload(target)}
          />
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-fg-3">
          Download asks which quality you want. Try Play starts with the best quality and steps down automatically if
          it won&apos;t play in your browser.
        </p>
      </div>
    </section>
  );
}

/** Season names as tabs; each season's episodes and downloads stay inside its own tab. */
export function SeasonTabsSection({
  slug,
  title,
  seasons,
  releases,
  poster,
  onPlay,
  onDownload,
}: {
  slug: string;
  title: MediaTitle;
  seasons: Season[];
  releases: MediaReleaseItem[];
  poster?: string;
  onPlay: OpenTarget;
  onDownload: OpenTarget;
}) {
  const tabs = useMemo(() => buildSeasonTabs(seasons, releases), [seasons, releases]);
  const [activeKey, setActiveKey] = useState<string>(tabs[0]?.key ?? "");
  if (!tabs.length) return null;
  const active = tabs.find((tab) => tab.key === activeKey) ?? tabs[0];
  const seasonCount = tabs.filter((tab) => tab.seasonNumber !== null).length;

  return (
    <section id="episodes" className="mb-9" aria-labelledby="episodes-heading">
      <SectionHeader
        title={<span id="episodes-heading">Seasons &amp; episodes</span>}
        subtitle={`${seasonCount} season${seasonCount === 1 ? "" : "s"}`}
      />
      <div className="px-4 desk:px-8">
        <Chips value={active.key} options={tabs.map((tab) => ({ id: tab.key, label: tab.label }))} onChange={setActiveKey} />
        <div role="tabpanel" aria-label={active.label} className="mt-3">
          <SeasonPanel
            key={active.key}
            tab={active}
            slug={slug}
            seriesTitle={title.title}
            poster={poster}
            onPlay={onPlay}
            onDownload={onDownload}
          />
        </div>
      </div>
    </section>
  );
}

function SeasonPanel({
  tab,
  slug,
  seriesTitle,
  poster,
  onPlay,
  onDownload,
}: {
  tab: SeasonTab;
  slug: string;
  seriesTitle: string;
  poster?: string;
  onPlay: OpenTarget;
  onDownload: OpenTarget;
}) {
  const season = tab.season;
  // Providers that don't send episodes with the detail page load them when the tab opens.
  const needsFetch = Boolean(season && season.episodes.length === 0 && tab.seasonNumber !== null);
  const { data, isLoading, isError } = useSeasonEpisodes(slug, tab.seasonNumber ?? 0, needsFetch);
  const episodes: Episode[] = season && season.episodes.length > 0 ? season.episodes : (data?.seasons[0]?.episodes ?? []);
  const overview = season?.overview ?? data?.seasons[0]?.overview;

  // Season-level downloads are usually complete-season archives; say so only when they are.
  const allArchives = tab.packs.length > 0 && tab.packs.every(isArchiveRelease);
  const packLabel =
    tab.seasonNumber === null ? "More downloads" : allArchives ? `Complete ${tab.label}` : `${tab.label} downloads`;
  const packTarget: WatchTarget | null = tab.packs.length
    ? {
        key: `${slug}-${tab.key}-packs`,
        heading:
          tab.seasonNumber === null
            ? `${seriesTitle} · More downloads`
            : `${seriesTitle} · ${tab.label}${allArchives ? " (complete)" : ""}`,
        mediaTitle: `${seriesTitle} ${tab.label}`,
        releases: tab.packs,
        poster,
      }
    : null;

  return (
    <div className="space-y-2">
      {overview && <p className="text-[13px] leading-relaxed text-fg-2">{overview}</p>}

      {packTarget && (
        <div className="flex flex-col gap-2 rounded-[12px] bg-raised/70 px-3 py-3 ring-1 ring-edge sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-fill text-fg-2">
              <Archive size={15} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-semibold">{packLabel}</p>
              <p className="text-[12px] text-fg-2">{summary(tab.packs)}</p>
            </div>
          </div>
          <WatchActions
            releases={tab.packs}
            size="sm"
            resumeKey={packTarget.key}
            onPlay={() => onPlay(packTarget)}
            onDownload={() => onDownload(packTarget)}
          />
        </div>
      )}

      {isLoading ? (
        <div className="space-y-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[56px] w-full animate-pulse rounded-[12px] bg-fill" />
          ))}
        </div>
      ) : isError ? (
        <p className="py-2 text-[13px] text-fg-2">{SOMETHING_WENT_WRONG}</p>
      ) : episodes.length === 0 ? (
        tab.seasonNumber !== null && (
          <p className="py-2 text-[13px] text-fg-2">
            {packTarget ? "Individual episodes aren't listed for this season." : "No episodes listed for this season."}
          </p>
        )
      ) : (
        <ol className="space-y-1.5" aria-label={`${tab.label} episodes`}>
          {episodes.map((episode) => (
            <EpisodeRow
              key={episode.id}
              episode={episode}
              seriesTitle={seriesTitle}
              poster={poster}
              onPlay={onPlay}
              onDownload={onDownload}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function EpisodeRow({
  episode,
  seriesTitle,
  poster,
  onPlay,
  onDownload,
}: {
  episode: Episode;
  seriesTitle: string;
  poster?: string;
  onPlay: OpenTarget;
  onDownload: OpenTarget;
}) {
  const releases = episode.releases ?? [];
  const code = episodeCode(episode.seasonNumber, episode.episodeNumber);
  const target: WatchTarget = {
    key: episode.id,
    heading: `${code} · ${seriesTitle}`,
    mediaTitle: `${seriesTitle} ${code}`,
    releases,
    poster,
  };

  return (
    <li className="flex flex-col gap-2 rounded-[12px] bg-fill/40 px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 gap-3">
        <span className="w-6 shrink-0 pt-0.5 text-right text-[13px] font-semibold text-fg-3 tabular-nums">
          {episode.episodeNumber}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[14px] font-medium">{episode.title}</span>
            {episode.runtimeMinutes ? (
              <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
                <Clock size={11} aria-hidden="true" /> {episode.runtimeMinutes} min
              </span>
            ) : null}
            {episode.airDate ? (
              <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
                <Calendar size={11} aria-hidden="true" /> {episode.airDate.slice(0, 10)}
              </span>
            ) : null}
            {episode.rating ? (
              <span className="flex items-center gap-1 text-[11.5px] text-fg-3">
                <Star size={10} fill="currentColor" aria-hidden="true" /> {episode.rating.toFixed(1)}
              </span>
            ) : null}
          </div>
          {releases.length > 0 && <p className="mt-0.5 text-[12px] text-fg-2">{summary(releases)}</p>}
          {episode.overview && (
            <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-relaxed text-fg-2">{episode.overview}</p>
          )}
        </div>
      </div>
      {releases.length > 0 && (
        <div className="pl-9 sm:pl-0">
          <WatchActions
            releases={releases}
            size="sm"
            resumeKey={target.key}
            onPlay={() => onPlay(target)}
            onDownload={() => onDownload(target)}
          />
        </div>
      )}
    </li>
  );
}
