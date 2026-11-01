"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { mediaApi } from "@/lib/media/client";
import { telegramLinks, telegramRelease, telegramReleaseBracket } from "@/lib/media/playbackPlan";
import { cx } from "@/lib/format";
import { useUi } from "@/store/ui";
import type { WatchTarget } from "./watch";

/**
 * "Download from Telegram (1080p · Hindi / English)" — sits beside the plain
 * Download button on a movie page. The bracket names the exact release the
 * button acts on (the best downloadable quality), because the Telegram
 * hand-off (`/tg/go?…`) is issued per release by that quality's mirror page:
 * the tap resolves that release's mirrors (the same resolve route Download
 * uses — no other backend path), finds its Telegram link and opens it.
 *
 * Renders nothing when the target has no main-catalogue release, so pages
 * that share these components but never had Telegram links (exclusive/vault
 * titles) are visually unchanged.
 */
export function TelegramDownloadButton({
  target,
  className,
  iconSize = 15,
}: {
  target: WatchTarget;
  className?: string;
  iconSize?: number;
}) {
  const release = telegramRelease(target.releases);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const pushToast = useUi((s) => s.pushToast);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!release) return null;
  const bracket = telegramReleaseBracket(release);
  const label = busy ? "Getting Telegram link…" : `Download from Telegram${bracket ? ` ${bracket}` : ""}`;

  const open = async () => {
    if (busy) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    // Open the tab on the tap itself — a tab opened after the resolve
    // round-trip is treated as a popup and blocked by most browsers.
    const pendingTab = typeof window !== "undefined" ? window.open("about:blank", "_blank") : null;

    try {
      for (const mirror of release.mirrors) {
        if (mirror.source === "vault") continue;
        try {
          const result = await mediaApi.resolveMirror({
            url: mirror.shortUrl,
            fileName: release.fileName,
            label: release.title,
            source: mirror.source,
            headers: mirror.headers,
            signal: controller.signal,
          });
          if (controller.signal.aborted) {
            pendingTab?.close();
            return;
          }
          const link = telegramLinks(result.links)[0];
          if (link) {
            if (pendingTab && !pendingTab.closed) pendingTab.location.href = link.url;
            else window.open(link.url, "_blank", "noreferrer,noopener");
            return;
          }
        } catch {
          if (controller.signal.aborted) {
            pendingTab?.close();
            return;
          }
          /* try the next mirror of the same release */
        }
      }
      pendingTab?.close();
      pushToast({
        title: "Telegram download isn't available for this one",
        desc: "Use Download to save the file directly instead.",
        kind: "warn",
      });
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void open()}
      disabled={busy}
      aria-busy={busy || undefined}
      title={label}
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-4 font-semibold transition-[background,opacity,transform] active:scale-[0.97] disabled:opacity-70",
        className && /\bbg-/.test(className) ? undefined : "bg-fill-2 text-fg hover:bg-fill-3",
        className
      )}
    >
      {busy ? (
        <Loader2 size={iconSize} className="animate-spin" aria-hidden="true" />
      ) : (
        <Send size={iconSize} aria-hidden="true" />
      )}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}
