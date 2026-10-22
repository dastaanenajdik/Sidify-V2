"use client";

import { useMemo, useState } from "react";
import { MonitorPlay } from "lucide-react";
import { buildVlcHandoff, saveTextFile } from "@/lib/media/externalLaunch";
import { isDirectMediaUrl } from "@/lib/media/externalPlayers";
import { externalPlayerReleases } from "@/lib/media/playbackPlan";
import type { MediaReleaseItem } from "@/lib/media/types";
import { cx } from "@/lib/format";
import { useMounted } from "@/lib/useMounted";
import { useUi } from "@/store/ui";
import { VlcPickerSheet } from "./VlcPickerSheet";
import type { WatchTarget } from "./watch";

const DEFAULT_BUTTON =
  "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-fill-2 px-4 text-[14px] font-semibold transition-[background,opacity,transform] active:scale-[0.97] hover:bg-fill-3";

/**
 * "Play with VLC" control with two clean, gesture-safe modes:
 *
 *   1. `url` (an ALREADY-RESOLVED direct HTTPS link): renders a real `<a href>` on phones
 *      (`intent:` on Android, `vlc-x-callback:` on iOS) so the user's single tap launches
 *      VLC synchronously without losing user activation, or saves an `.m3u` playlist on
 *      desktop.
 *   2. `releases` / `target` (unresolved title / episode mirrors): clicking opens the
 *      `VlcPickerSheet` popup where ALL qualities and ALL server links load right away so
 *      the user taps any link to launch VLC directly.
 */
export function VlcPlayButton({
  title,
  heading,
  url,
  releases,
  onOpen,
  className,
  iconSize = 14,
  label = "Play with VLC",
}: {
  /** VLC's now-playing name, and the file name of any saved desktop playlist. */
  title: string;
  /** Sheet title when different from `title` (e.g. `S01E01 · Show`). */
  heading?: string;
  /** Already-resolved direct HTTPS URL — rendered straight as `<a href>` on mobile. */
  url?: string | null;
  /** Releases for `VlcPickerSheet` when links must load first across all qualities. */
  releases?: MediaReleaseItem[];
  /** Optional parent-owned sheet opener (when omitted, renders its own `VlcPickerSheet`). */
  onOpen?: () => void;
  className?: string;
  iconSize?: number;
  label?: string;
}) {
  const mounted = useMounted();
  const pushToast = useUi((s) => s.pushToast);
  const [sheetOpen, setSheetOpen] = useState(false);

  const directUrl = isDirectMediaUrl(url) ? url : null;
  const streamableReleases = useMemo(
    () => (releases ? externalPlayerReleases(releases) : []),
    [releases]
  );

  const handoff = useMemo(
    () => (mounted && directUrl ? buildVlcHandoff(directUrl, { title }) : null),
    [mounted, directUrl, title]
  );

  const buttonClass = className ?? DEFAULT_BUTTON;
  const content = (
    <>
      <MonitorPlay size={iconSize} aria-hidden="true" />
      {label}
    </>
  );

  // Mode 1: already-resolved direct URL -> real `<a href>` on mobile, synchronous `.m3u` on desktop.
  if (directUrl) {
    if (handoff?.plan.href) {
      return (
        <a href={handoff.plan.href} rel="noreferrer noopener" className={buttonClass} title={handoff.plan.note}>
          {content}
        </a>
      );
    }
    return (
      <button
        type="button"
        onClick={() => {
          if (!handoff?.plan.file) return;
          saveTextFile(handoff.plan.file);
          pushToast({ title: "Playlist saved", desc: handoff.plan.note, kind: "ok", duration: 6000 });
        }}
        disabled={!handoff}
        className={cx(buttonClass, !handoff && "opacity-70")}
        title={handoff?.plan.note ?? label}
      >
        {content}
      </button>
    );
  }

  // Mode 2: unresolved releases -> open the all-qualities VLC link sheet immediately on click.
  if (!streamableReleases.length && !onOpen) return null;

  const target: WatchTarget = {
    key: `vlc-${title}`,
    heading: heading ?? title,
    mediaTitle: title,
    releases: releases ?? [],
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          if (onOpen) onOpen();
          else setSheetOpen(true);
        }}
        className={buttonClass}
      >
        {content}
      </button>
      {!onOpen && <VlcPickerSheet target={sheetOpen ? target : null} onClose={() => setSheetOpen(false)} />}
    </>
  );
}
