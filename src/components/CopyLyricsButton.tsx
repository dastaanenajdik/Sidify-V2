"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { copyText } from "@/lib/clipboard";
import { cx } from "@/lib/format";

/**
 * Compact copy affordance for a block of lyrics.
 * Sits *under* the lyrics text (bottom of the panel) and keeps a small footprint:
 * an icon button by default, `label` opts into the slightly wider pill version.
 */
export default function CopyLyricsButton({
  lyrics,
  label = "",
  className,
}: {
  lyrics: string;
  /** Optional short text next to the icon ("Copy"). Leave empty for icon-only. */
  label?: string;
  className?: string;
}) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const mounted = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setStatus("idle"), 2000);
    return () => clearTimeout(timer);
  }, [status]);

  async function handleCopy() {
    if (busy.current || !lyrics.trim()) return;
    busy.current = true;
    setStatus("copying");
    try {
      await copyText(lyrics);
      if (mounted.current) setStatus("copied");
    } catch {
      if (mounted.current) setStatus("error");
    } finally {
      busy.current = false;
    }
  }

  const text = status === "copied" ? "Copied" : status === "copying" ? "Copying…" : label;

  return (
    <div className={cx("flex shrink-0 items-center gap-2", className)}>
      <button
        type="button"
        onClick={handleCopy}
        disabled={status === "copying" || status === "copied" || !lyrics.trim()}
        aria-label={label ? undefined : "Copy lyrics"}
        title="Copy lyrics"
        className={cx(
          "ring-focus accent-text glass flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-[11.5px] font-semibold transition duration-200 hover:brightness-125 active:scale-95",
          "disabled:cursor-default disabled:opacity-70 disabled:active:scale-100",
          !text && "w-8 px-0"
        )}
        style={{ borderColor: "color-mix(in srgb, var(--accent) 34%, transparent)" }}
      >
        {status === "copied" ? <Check size={13} aria-hidden="true" /> : status === "copying" ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
        {text && <span>{text}</span>}
      </button>
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={status === "error" ? "text-muted text-[11px]" : "sr-only"}
      >
        {status === "copied" ? "All lyrics copied to clipboard." : status === "error" ? "Couldn't copy — select the lyrics manually." : ""}
      </p>
    </div>
  );
}
