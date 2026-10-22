"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Copy, ExternalLink, FileDown, Loader2, Play, RotateCcw } from "lucide-react";
import { Sheet } from "@/components/ui";
import { copyText } from "@/lib/clipboard";
import { buildVlcHandoff, saveTextFile } from "@/lib/media/externalLaunch";
import {
  resolveAllReleaseStreams,
  resolveReleaseStreams,
  type ReleaseStreamResolution,
} from "@/lib/media/externalStream";
import { externalPlayerReleases, type ExternalPlayerLink } from "@/lib/media/playbackPlan";
import { hintChips, parseReleaseHints } from "@/lib/media/releaseHints";
import type { MediaReleaseItem } from "@/lib/media/types";
import { SOMETHING_WENT_WRONG } from "@/lib/media/userError";
import { useMounted } from "@/lib/useMounted";
import { useUi } from "@/store/ui";
import type { WatchTarget } from "./watch";

type EntryState = { phase: "loading" } | ({ phase: "done" } & Exclude<ReleaseStreamResolution, { status: "aborted" }>);

/**
 * "Play with VLC" popup: as soon as it opens, ALL non-archive qualities load their direct
 * server links automatically. Every resolved link is rendered as a genuine `<a href>` so
 * whichever link the user taps immediately opens VLC inside that tap and starts playing.
 */
export function VlcPickerSheet({ target, onClose }: { target: WatchTarget | null; onClose: () => void }) {
  return (
    <Sheet
      open={Boolean(target)}
      onClose={onClose}
      title={target ? `Play with VLC · ${target.heading}` : undefined}
      subtitle="All qualities load below — tap any link to open and play in VLC"
      width={640}
    >
      {target && <VlcPicker key={target.key} target={target} />}
    </Sheet>
  );
}

function VlcPicker({ target }: { target: WatchTarget }) {
  const releases = useMemo(() => externalPlayerReleases(target.releases), [target.releases]);
  const [entries, setEntries] = useState<Record<string, EntryState>>(() =>
    Object.fromEntries(releases.map((r) => [r.id, { phase: "loading" } as EntryState]))
  );
  const retryControllers = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    if (!releases.length) return;
    const controller = new AbortController();
    const retries = retryControllers.current;

    void resolveAllReleaseStreams(releases, {
      signal: controller.signal,
      label: target.mediaTitle,
      onStart: (release) => {
        setEntries((prev) => ({ ...prev, [release.id]: { phase: "loading" } }));
      },
      onResult: (release, outcome) => {
        if (outcome.status === "aborted") return;
        setEntries((prev) => ({ ...prev, [release.id]: { phase: "done", ...outcome } }));
      },
    });

    return () => {
      controller.abort();
      retries.forEach((c) => c.abort());
      retries.clear();
    };
  }, [releases, target.mediaTitle]);

  const retryRelease = useCallback(
    async (release: MediaReleaseItem, refresh = true) => {
      retryControllers.current.get(release.id)?.abort();
      const controller = new AbortController();
      retryControllers.current.set(release.id, controller);
      setEntries((prev) => ({ ...prev, [release.id]: { phase: "loading" } }));
      const outcome = await resolveReleaseStreams(release, {
        signal: controller.signal,
        label: target.mediaTitle,
        refresh,
      });
      if (controller.signal.aborted || outcome.status === "aborted") return;
      setEntries((prev) => ({ ...prev, [release.id]: { phase: "done", ...outcome } }));
    },
    [target.mediaTitle]
  );

  if (!releases.length) {
    return <p className="py-6 text-center text-[14px] text-fg-2">{SOMETHING_WENT_WRONG}</p>;
  }

  const loadingCount = releases.filter((r) => (entries[r.id]?.phase ?? "loading") === "loading").length;
  const doneCount = releases.length - loadingCount;

  return (
    <div className="space-y-3">
      {loadingCount > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-center gap-2 rounded-[12px] bg-fill px-3.5 py-2.5 text-[12.5px] font-medium text-fg-2"
        >
          <Loader2 size={14} className="shrink-0 animate-spin text-playing" aria-hidden="true" />
          <span>
            Loading stream links across qualities ({doneCount}/{releases.length})…
          </span>
        </div>
      )}

      <ul className="space-y-2.5" aria-label="Qualities and VLC stream links">
        {releases.map((release) => (
          <li key={release.id}>
            <QualityVlcCard
              release={release}
              mediaTitle={target.mediaTitle}
              entry={entries[release.id] ?? { phase: "loading" }}
              onRetry={() => void retryRelease(release)}
            />
          </li>
        ))}
      </ul>

      <p className="text-[11.5px] leading-relaxed text-fg-3">
        Tap any loaded server link above to launch VLC immediately. If one server buffers or fails on your network, tap
        another server or quality right here.
      </p>
    </div>
  );
}

function QualityVlcCard({
  release,
  mediaTitle,
  entry,
  onRetry,
}: {
  release: MediaReleaseItem;
  mediaTitle: string;
  entry: EntryState;
  onRetry: () => void;
}) {
  const chips = useMemo(() => hintChips(parseReleaseHints(release.fileName, release.title)), [release.fileName, release.title]);
  const streamTitle = release.quality ? `${mediaTitle} (${release.quality})` : mediaTitle;

  return (
    <div className="rounded-[14px] bg-fill/60 p-3 ring-1 ring-edge">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11.5px] font-bold text-on-primary">
            {release.quality || "Other"}
          </span>
          {release.size && <span className="text-[13px] font-semibold text-fg">{release.size}</span>}
          {release.container && (
            <span className="rounded bg-fill-2 px-1.5 py-0.5 text-[10.5px] font-bold text-fg-2 uppercase">
              {release.container}
            </span>
          )}
          {chips.length > 0 && <span className="text-[12px] text-fg-2">{chips.join(" · ")}</span>}
        </div>
        {release.languages && <span className="text-[11.5px] font-medium text-fg-3">{release.languages}</span>}
      </div>

      <p className="mt-1 line-clamp-1 text-[11.5px] break-all text-fg-3">{release.fileName}</p>

      <div className="mt-2.5">
        {entry.phase === "loading" ? (
          <div className="flex items-center gap-2 rounded-[10px] bg-raised/70 px-3 py-2 text-[12.5px] text-fg-2">
            <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading stream links…
          </div>
        ) : entry.status === "ready" ? (
          <ul className="space-y-1.5" aria-label={`${release.quality || "Release"} VLC links`}>
            {entry.links.map((link) => (
              <li key={link.url}>
                <ServerVlcRow link={link} title={streamTitle} />
              </li>
            ))}
          </ul>
        ) : entry.status === "manual" ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-raised/70 px-3 py-2">
            <span className="text-[12px] text-fg-2">Direct stream link isn&apos;t ready — continue on host page or retry.</span>
            <div className="flex items-center gap-1.5">
              <a
                href={entry.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-7 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3"
              >
                Open page <ExternalLink size={11} aria-hidden="true" />
              </a>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3"
              >
                <RotateCcw size={11} aria-hidden="true" /> Retry
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] bg-raised/70 px-3 py-2">
            <span className="flex items-center gap-1.5 text-[12px] text-fg-2">
              <AlertCircle size={13} className="text-danger" aria-hidden="true" /> Couldn&apos;t load stream link
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-3 text-[12px] font-semibold text-on-primary hover:opacity-90"
              >
                <RotateCcw size={11} aria-hidden="true" /> Retry
              </button>
              {entry.manualUrl && (
                <a
                  href={entry.manualUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-7 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12px] font-semibold text-fg hover:bg-fill-3"
                >
                  Mirror <ExternalLink size={11} aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ServerVlcRow({ link, title }: { link: ExternalPlayerLink; title: string }) {
  const mounted = useMounted();
  const pushToast = useUi((s) => s.pushToast);

  const handoff = useMemo(() => (mounted ? buildVlcHandoff(link.url, { title }) : null), [mounted, link.url, title]);

  const copy = async () => {
    try {
      await copyText(link.url);
      pushToast({ title: "Link copied", desc: "Paste it into VLC's “Open Network Stream”.", kind: "ok" });
    } catch {
      pushToast({ title: "Couldn't copy the link", kind: "warn" });
    }
  };

  const savePlaylist = () => {
    if (!handoff?.plan.file) return;
    saveTextFile(handoff.plan.file);
    pushToast({ title: "Playlist saved", desc: handoff.plan.note, kind: "ok", duration: 6000 });
  };

  const primaryClass =
    "inline-flex h-8 min-w-0 flex-1 items-center justify-between gap-2 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary transition-opacity hover:opacity-90 active:scale-[0.98] sm:flex-initial";
  const secondaryChip =
    "inline-flex h-8 shrink-0 items-center gap-1 rounded-full bg-fill-2 px-2.5 text-[12px] font-semibold text-fg transition-colors hover:bg-fill-3";

  return (
    <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-[10px] bg-raised/85 px-2.5 py-2">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        {handoff?.plan.href ? (
          <a href={handoff.plan.href} rel="noreferrer noopener" className={primaryClass} title={handoff.plan.note}>
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
              <Play size={12} fill="currentColor" className="shrink-0" aria-hidden="true" />
              <span className="truncate">Play in VLC · {link.server}</span>
            </span>
          </a>
        ) : (
          <button
            type="button"
            onClick={savePlaylist}
            disabled={!handoff?.plan.file}
            className={primaryClass}
            title={handoff?.plan.note}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
              <FileDown size={13} className="shrink-0" aria-hidden="true" />
              <span className="truncate">Play in VLC · {link.server}</span>
            </span>
          </button>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-1">
        {handoff?.others.map((option) =>
          option.href ? (
            <a key={option.id} href={option.href} rel="noreferrer noopener" className={secondaryChip} title={option.note}>
              <ExternalLink size={11} aria-hidden="true" /> {option.label}
            </a>
          ) : null
        )}
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`Copy ${link.server} stream link`}
          className={secondaryChip}
        >
          <Copy size={12} aria-hidden="true" /> Copy
        </button>
      </div>
    </div>
  );
}
