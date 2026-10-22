"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, ExternalLink, Loader2, MonitorPlay } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { isDirectMediaUrl, type ExternalPlayerOption } from "@/lib/media/externalPlayers";
import { playWithVlc, saveTextFile, type VlcHandoff } from "@/lib/media/externalLaunch";
import { resolveExternalStream } from "@/lib/media/externalStream";
import type { MediaReleaseItem } from "@/lib/media/types";
import { cx } from "@/lib/format";
import { useUi } from "@/store/ui";

const miniChip =
  "inline-flex h-7 items-center gap-1 rounded-full bg-fill-2 px-2.5 text-[11.5px] font-semibold text-fg transition-colors hover:bg-fill-3";

const DEFAULT_BUTTON =
  "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full bg-fill-2 px-4 text-[14px] font-semibold transition-[background,opacity,transform] active:scale-[0.97] hover:bg-fill-3";

type Status =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "opened"; url: string; handoff: VlcHandoff }
  | { phase: "failed" };

/**
 * "Play with VLC" — one button that starts the file in VLC instead of in the browser, next to
 * Try Play (beta) and Download.
 *
 * Phones get VLC's own link, so the app opens and streams the file — which is exactly what
 * the Dolby / HEVC / MKV releases that show a black screen or stay silent here need. A web
 * page cannot launch a desktop app, so on a computer the same button saves a one-line `.m3u`
 * that opens in VLC, and the link can always be copied. Other players for the same link
 * (MX Player, Infuse, IINA, the Android chooser) ride along under it, as before.
 *
 * A row on a title page only knows mirror short-links, so the first tap resolves the best
 * quality's direct link and hands it over; a sheet that has already resolved one passes
 * `url` and the button opens inside the tap itself.
 */
export function VlcPlayButton({
  title,
  url,
  releases,
  className,
  iconSize = 14,
  label = "Play with VLC",
  showActions = true,
}: {
  /** VLC's now-playing name, and the file name of the saved playlist. */
  title: string;
  /** A link that is already resolved — used as it is, with no network call. */
  url?: string | null;
  /** Releases to resolve a link from when `url` isn't known (best quality first). */
  releases?: MediaReleaseItem[];
  /** Full classes for the button, so it matches the buttons beside it. */
  className?: string;
  /** Icon size, for rows and heroes that use bigger controls. */
  iconSize?: number;
  label?: string;
  /**
   * Skip the row under the button (note, Copy link, other players) where the surrounding UI
   * already lists them — e.g. the Try Play panel, which shows `ExternalPlayerLinks`.
   */
  showActions?: boolean;
}) {
  const pushToast = useUi((s) => s.pushToast);
  const [status, setStatus] = useState<Status>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const directUrl = isDirectMediaUrl(url) ? url : null;
  const canResolve = !directUrl && (releases?.length ?? 0) > 0;

  const open = useCallback(
    (target: string) => {
      const handoff = playWithVlc(target, { title });
      if (!handoff) {
        setStatus({ phase: "failed" });
        return;
      }
      setStatus({ phase: "opened", url: target, handoff });
      // On a computer nothing visibly happens after a save, so say what to do next.
      if (handoff.plan.mode === "playlist") {
        pushToast({ title: "Playlist saved", desc: handoff.plan.note, kind: "ok", duration: 7000 });
      }
    },
    [pushToast, title]
  );

  const click = async () => {
    if (status.phase === "loading") return;
    if (directUrl) {
      open(directUrl);
      return;
    }
    if (!canResolve) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus({ phase: "loading" });
    const stream = await resolveExternalStream(releases ?? [], { signal: controller.signal, label: title });
    if (controller.signal.aborted) return;
    if (!stream || !isDirectMediaUrl(stream.url)) {
      setStatus({ phase: "failed" });
      pushToast({ title: "Couldn't get a direct link", desc: "Download still works for this one.", kind: "warn" });
      return;
    }
    open(stream.url);
  };

  const copy = async () => {
    const link = status.phase === "opened" ? status.url : directUrl;
    if (!link) return;
    try {
      await copyText(link);
      pushToast({ title: "Link copied", desc: "Paste it into VLC's “Open Network Stream”.", kind: "ok" });
    } catch {
      pushToast({ title: "Couldn't copy the link", kind: "warn" });
    }
  };

  const opened = status.phase === "opened" ? status : null;
  if (!opened && !directUrl && !canResolve) return null;

  const buttonClass = cx(className ?? DEFAULT_BUTTON, status.phase === "loading" && "cursor-progress opacity-80");
  const content = (
    <>
      {status.phase === "loading" ? (
        <Loader2 size={iconSize} className="animate-spin" aria-hidden="true" />
      ) : (
        <MonitorPlay size={iconSize} aria-hidden="true" />
      )}
      {status.phase === "loading" ? "Getting link…" : label}
    </>
  );
  const others: ExternalPlayerOption[] = opened ? opened.handoff.others : [];

  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      {opened?.handoff.plan.href ? (
        /* The link is in hand: a real `href` means every later tap is a user gesture, which
           is what phones require to open another app. */
        <a href={opened.handoff.plan.href} rel="noreferrer noopener" className={buttonClass} title={opened.handoff.plan.note}>
          {content}
        </a>
      ) : (
        <button
          type="button"
          onClick={() => void click()}
          className={buttonClass}
          disabled={status.phase === "loading"}
          aria-busy={status.phase === "loading" || undefined}
          title={opened ? opened.handoff.plan.note : directUrl ? label : "Opens VLC — the link is fetched first"}
        >
          {content}
        </button>
      )}

      {opened && showActions && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11.5px] leading-relaxed text-fg-3">
            {opened.handoff.plan.mode === "app" ? "VLC should be opening — tap the button again if it didn't." : opened.handoff.plan.note}
          </span>
          <button type="button" onClick={() => void copy()} className={miniChip}>
            <Copy size={11} aria-hidden="true" /> Copy link
          </button>
          {others.map((option) =>
            option.href ? (
              <a key={option.id} href={option.href} rel="noreferrer noopener" className={miniChip} title={option.note}>
                <ExternalLink size={11} aria-hidden="true" /> {option.label}
              </a>
            ) : option.file ? (
              <button key={option.id} type="button" onClick={() => saveTextFile(option.file!)} className={miniChip} title={option.note}>
                {option.label}
              </button>
            ) : null
          )}
        </div>
      )}

      {status.phase === "failed" && showActions && (
        <p className="text-[11.5px] leading-relaxed text-fg-3">
          No direct link for this one right now —{" "}
          <button type="button" onClick={() => void click()} className="font-semibold text-fg underline decoration-fg-3 underline-offset-2">
            try again
          </button>
          .
        </p>
      )}
    </div>
  );
}
