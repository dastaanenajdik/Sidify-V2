"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { copyText } from "@/lib/clipboard";

export default function CopyLyricsButton({ lyrics }: { lyrics: string }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const mounted = useRef(true);
  const busy = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (status !== "copied") return;
    const timer = setTimeout(() => setStatus("idle"), 2400);
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

  return (
    <div className="shrink-0 border-b border-[var(--border)] px-5 py-3">
      <button
        type="button"
        onClick={handleCopy}
        disabled={status === "copying" || status === "copied"}
        className="ring-focus accent-text flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-[13px] font-semibold shadow-sm transition duration-200 hover:brightness-110 active:scale-[0.98] disabled:cursor-default disabled:active:scale-100"
        style={{
          borderColor: "color-mix(in srgb, var(--accent) 32%, transparent)",
          background: "linear-gradient(135deg, color-mix(in srgb, var(--accent) 16%, transparent), color-mix(in srgb, var(--accent) 6%, transparent))",
        }}
      >
        {status === "copied" ? <Check size={16} aria-hidden="true" /> : status === "copying" ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
        {status === "copied" ? "Copied!" : status === "copying" ? "Copying…" : "Copy Lyrics"}
      </button>
      <p role="status" aria-live="polite" aria-atomic="true" className={status === "error" ? "text-muted mt-2 text-center text-xs" : "sr-only"}>
        {status === "copied" ? "All lyrics copied to clipboard." : status === "error" ? "Couldn't copy lyrics. Please try again or select the lyrics to copy manually." : ""}
      </p>
    </div>
  );
}
