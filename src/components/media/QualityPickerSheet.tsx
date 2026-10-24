"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, ChevronRight, Copy, Download, ExternalLink, Loader2 } from "lucide-react";
import { Sheet } from "@/components/ui";
import { copyText } from "@/lib/clipboard";
import { MediaApiError, mediaApi } from "@/lib/media/client";
import { redactUrl, reportMediaDiagnostic } from "@/lib/media/diagnostics";
import {
  downloadLinks,
  downloadableReleases,
  externalPlayerLink,
  isArchiveRelease,
  landingPageUrl,
} from "@/lib/media/playbackPlan";
import { hintChips, parseReleaseHints } from "@/lib/media/releaseHints";
import type { MediaReleaseItem, ResolvedMirrorLink } from "@/lib/media/types";
import { SOMETHING_WENT_WRONG } from "@/lib/media/userError";
import { cx } from "@/lib/format";
import { useUi } from "@/store/ui";
import { ExternalPlayerLinks } from "./ExternalPlayerLinks";
import { VlcPlayButton } from "./VlcPlayButton";
import type { WatchTarget } from "./watch";

/**
 * Download popup: qualities are only listed here (one row per item on the page), and a
 * quality's mirrors are resolved only after the user picks it.
 */
export function QualityPickerSheet({ target, onClose }: { target: WatchTarget | null; onClose: () => void }) {
  return (
    <Sheet
      open={Boolean(target)}
      onClose={onClose}
      title={target ? `Download · ${target.heading}` : undefined}
      subtitle="Choose a quality"
      width={600}
    >
      {target && <QualityPicker key={target.key} target={target} />}
    </Sheet>
  );
}

type ResolveState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; links: ResolvedMirrorLink[] }
  /** No direct links, but the host's own download page was validated — open it to continue. */
  | { phase: "manual"; url: string }
  | { phase: "error"; manualUrl?: string };

function QualityPicker({ target }: { target: WatchTarget }) {
  const releases = useMemo(() => downloadableReleases(target.releases), [target.releases]);
  const [selected, setSelected] = useState<MediaReleaseItem | null>(null);
  const [state, setState] = useState<ResolveState>({ phase: "idle" });
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const resolve = async (release: MediaReleaseItem) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setSelected(release);
    setState({ phase: "loading" });

    let landingUrl: string | undefined;
    let fallbackUrl: string | undefined;
    // Mirror fallback: the first mirror that yields direct links wins.
    for (const mirror of release.mirrors) {
      try {
        const result = await mediaApi.resolveMirror({
          url: mirror.shortUrl,
          fileName: release.fileName,
          label: release.title,
          source: mirror.source,
          headers: mirror.headers,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const links = downloadLinks(result.links);
        if (links.length) {
          setState({ phase: "done", links });
          return;
        }
        landingUrl ??= landingPageUrl(result);
        fallbackUrl ??= result.externalFallbackUrl;
        reportMediaDiagnostic("download: mirror gave no direct links", {
          stage: "resolve-result",
          quality: release.quality,
          mirror: redactUrl(mirror.shortUrl),
          status: result.status,
          reason: result.reason,
          links: result.links.length,
        });
      } catch (err) {
        if (controller.signal.aborted) return;
        reportMediaDiagnostic("download: mirror resolve failed", {
          stage: "resolve-api",
          quality: release.quality,
          mirror: redactUrl(mirror.shortUrl),
          httpStatus: err instanceof MediaApiError ? err.status : undefined,
          code: err instanceof MediaApiError ? err.code : (err as Error)?.name,
        });
      }
    }
    if (landingUrl) setState({ phase: "manual", url: landingUrl });
    else setState({ phase: "error", manualUrl: fallbackUrl ?? release.mirrors[0]?.shortUrl });
  };

  const back = () => {
    abortRef.current?.abort();
    setSelected(null);
    setState({ phase: "idle" });
  };

  if (!releases.length) {
    return <p className="py-6 text-center text-[14px] text-fg-2">{SOMETHING_WENT_WRONG}</p>;
  }

  if (!selected) {
    return (
      <div>
        <ul className="space-y-1.5" aria-label="Available qualities">
          {releases.map((release) => (
            <li key={release.id}>
              <QualityRow release={release} onPick={() => void resolve(release)} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11.5px] leading-relaxed text-fg-3">
          Codec details come from file names and aren&apos;t verified.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={back}
        className="mb-3 inline-flex items-center gap-1 text-[13px] font-semibold text-fg-2 hover:text-fg"
      >
        <ArrowLeft size={14} aria-hidden="true" /> All qualities
      </button>
      <ReleaseSummary release={selected} />

      <div className="mt-3" aria-live="polite">
        {state.phase === "loading" && (
          <div className="flex items-center gap-2 rounded-[12px] bg-fill px-3.5 py-3 text-[13px] text-fg-2">
            <Loader2 size={15} className="animate-spin" aria-hidden="true" /> Getting download links…
          </div>
        )}

        {state.phase === "error" && (
          <div className="rounded-[12px] bg-fill px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-[13.5px] font-semibold text-fg">
              <AlertCircle size={15} className="text-danger" aria-hidden="true" /> {SOMETHING_WENT_WRONG}
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => void resolve(selected)}
                className="inline-flex h-8 items-center rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:opacity-90"
              >
                Try again
              </button>
              {state.manualUrl && (
                <a
                  href={state.manualUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3"
                >
                  Open mirror page <ExternalLink size={12} aria-hidden="true" />
                </a>
              )}
            </div>
          </div>
        )}

        {state.phase === "manual" && (
          <div className="rounded-[12px] bg-fill px-3.5 py-3">
            <p className="text-[13px] leading-relaxed text-fg-2">
              A direct link isn&apos;t ready for this one. Continue on the download page.
            </p>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              <a
                href={state.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:opacity-90"
              >
                Open download page <ExternalLink size={12} aria-hidden="true" />
              </a>
              <button
                type="button"
                onClick={() => void resolve(selected)}
                className="inline-flex h-8 items-center rounded-full bg-fill-2 px-3.5 text-[12.5px] font-semibold text-fg hover:bg-fill-3"
              >
                Try again
              </button>
            </div>
          </div>
        )}

        {state.phase === "done" && <LinkList links={state.links} title={target.mediaTitle} />}
      </div>
    </div>
  );
}

function QualityRow({ release, onPick }: { release: MediaReleaseItem; onPick: () => void }) {
  const chips = hintChips(parseReleaseHints(release.fileName, release.title));
  return (
    <button
      type="button"
      onClick={onPick}
      className="flex w-full items-center gap-3 rounded-[12px] bg-fill/60 px-3 py-2.5 text-left transition-colors hover:bg-fill-2"
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11.5px] font-bold text-on-primary">
            {release.quality || "Other"}
          </span>
          {release.size && <span className="text-[13px] font-semibold text-fg">{release.size}</span>}
          {release.container && (
            <span className="rounded bg-fill-2 px-1.5 py-0.5 text-[10.5px] font-bold text-fg-2 uppercase">{release.container}</span>
          )}
          {release.isPack && (
            <span className="rounded bg-fill-2 px-1.5 py-0.5 text-[10.5px] font-bold text-fg-2 uppercase">Pack</span>
          )}
        </span>
        {chips.length > 0 && <span className="mt-1 block text-[12px] text-fg-2">{chips.join(" · ")}</span>}
        {release.languages && <span className="block text-[11.5px] text-fg-3">{release.languages}</span>}
        <span className="mt-0.5 line-clamp-1 block text-[11.5px] break-all text-fg-3">{release.fileName}</span>
      </span>
      <ChevronRight size={17} className="shrink-0 text-fg-3" aria-hidden="true" />
    </button>
  );
}

function ReleaseSummary({ release }: { release: MediaReleaseItem }) {
  const chips = hintChips(parseReleaseHints(release.fileName, release.title));
  return (
    <div className="rounded-[12px] bg-fill/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-primary px-2.5 py-0.5 text-[11.5px] font-bold text-on-primary">{release.quality || "Other"}</span>
        {release.size && <span className="text-[13px] font-semibold text-fg">{release.size}</span>}
        {chips.length > 0 && <span className="text-[12px] text-fg-2">{chips.join(" · ")}</span>}
      </div>
      <p className="mt-1 text-[11.5px] break-all text-fg-3">{release.fileName}</p>
    </div>
  );
}

function LinkList({ links, title }: { links: ResolvedMirrorLink[]; title: string }) {
  const pushToast = useUi((s) => s.pushToast);
  const preferred = externalPlayerLink(links)?.url;

  const copy = async (url: string) => {
    try {
      await copyText(url);
      pushToast({ title: "Link copied", kind: "ok" });
    } catch {
      pushToast({ title: "Couldn't copy the link", kind: "warn" });
    }
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-1.5" aria-label="Download links">
        {links.map((link) => {
          const canStreamLink = !isArchiveRelease({ container: link.container });
          return (
            <li
              key={link.url}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-fill/60 px-3 py-2.5"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-[13.5px] font-semibold text-fg">{link.server}</span>
                {link.container && (
                  <span className="rounded bg-fill-2 px-1.5 py-0.5 text-[10.5px] font-bold text-fg-2 uppercase">
                    {link.container}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                {canStreamLink && (
                  <VlcPlayButton
                    url={link.url}
                    title={title}
                    label="VLC"
                    iconSize={13}
                    className="inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3 text-[12.5px] font-semibold text-fg transition-colors hover:bg-fill-3"
                  />
                )}
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  download
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-primary px-3.5 text-[12.5px] font-semibold text-on-primary hover:opacity-90"
                >
                  <Download size={13} aria-hidden="true" /> Download
                </a>
                <button
                  type="button"
                  onClick={() => void copy(link.url)}
                  aria-label={`Copy ${link.server} link`}
                  className={cx(
                    "inline-flex h-8 items-center gap-1 rounded-full bg-fill-2 px-3 text-[12.5px] font-semibold text-fg hover:bg-fill-3"
                  )}
                >
                  <Copy size={12} aria-hidden="true" /> Copy
                </button>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="text-[11.5px] leading-relaxed text-fg-3">
        Downloads are the original file — video plus every audio track. If it opens in a browser tab instead of
        saving, long-press the Download button (phone) or right-click it (computer) and choose “Download link” /
        “Save link as”.
      </p>

      {preferred && (
        <div className="rounded-[12px] bg-fill/40 px-3 py-2.5">
          <p className="mb-2 text-[12.5px] font-semibold text-fg-2">Watch without downloading — open in a player app</p>
          <ExternalPlayerLinks url={preferred} title={title} />
        </div>
      )}
    </div>
  );
}
