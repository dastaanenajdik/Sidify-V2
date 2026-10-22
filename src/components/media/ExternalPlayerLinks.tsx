"use client";

import { useMemo } from "react";
import { Copy, ExternalLink, FileDown } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { saveTextFile } from "@/lib/media/externalLaunch";
import { detectClientPlatform, externalPlayerOptions, type ExternalPlayerOption } from "@/lib/media/externalPlayers";
import { useMounted } from "@/lib/useMounted";
import { useUi } from "@/store/ui";

const chip =
  "inline-flex h-8 items-center gap-1.5 rounded-full bg-fill-2 px-3 text-[12.5px] font-semibold text-fg transition-colors hover:bg-fill-3";

/**
 * "Open in VLC / MX Player / Infuse / desktop player" for one direct URL, plus Copy URL.
 * App links are best-effort (they only work when the app is installed); Copy URL always
 * works and can be pasted into any player's "Open network stream".
 */
export function ExternalPlayerLinks({ url, title, className }: { url: string; title?: string; className?: string }) {
  const mounted = useMounted();
  const pushToast = useUi((s) => s.pushToast);

  const options = useMemo<ExternalPlayerOption[]>(() => {
    if (!mounted) return [];
    const platform = detectClientPlatform({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    });
    return externalPlayerOptions(url, { title, platform });
  }, [mounted, url, title]);

  const copy = async () => {
    try {
      await copyText(url);
      pushToast({ title: "Link copied", desc: "Paste it into your player's “Open network stream”.", kind: "ok" });
    } catch {
      pushToast({ title: "Couldn't copy the link", kind: "warn" });
    }
  };

  const saveFile = (file: NonNullable<ExternalPlayerOption["file"]>) => saveTextFile(file);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((option) =>
          option.href ? (
            <a key={option.id} href={option.href} rel="noreferrer noopener" className={chip} title={option.note}>
              <ExternalLink size={12} aria-hidden="true" /> {option.label}
            </a>
          ) : option.file ? (
            <button key={option.id} type="button" onClick={() => saveFile(option.file!)} className={chip} title={option.note}>
              <FileDown size={12} aria-hidden="true" /> {option.label}
            </button>
          ) : null
        )}
        <button type="button" onClick={() => void copy()} className={chip}>
          <Copy size={12} aria-hidden="true" /> Copy URL
        </button>
      </div>
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-fg-3">
        App buttons work only if that app is installed. Copy URL works with any player — in VLC use “Open Network Stream”.
      </p>
    </div>
  );
}
