"use client";

import { useEffect, useState } from "react";
import { Check, ClipboardCopy, TriangleAlert } from "lucide-react";
import { getEngineDiag, playbackReport, type EngineDiag } from "@/lib/audioEngine";
import { copyText } from "@/lib/clipboard";
import { useUi } from "@/store/ui";
import { cx } from "@/lib/format";

/**
 * Live "which engine is playing right now" row for Settings.
 *
 * Screen-off pauses depend on the engine, not on the song: a plain `<audio>` element keeps
 * playing in the background, a YouTube `<iframe>` embed does not (Chrome pauses embeds;
 * Brave keeps them running). Users had no way to see which one they got, so the report
 * button below copies the engine + event log for a real bug report.
 */
export default function PlaybackStatusRow() {
  const pushToast = useUi((s) => s.pushToast);
  const [diag, setDiag] = useState<EngineDiag | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const update = () => {
      try {
        setDiag(getEngineDiag());
      } catch {
        setDiag(null);
      }
    };
    update();
    const id = setInterval(update, 2000);
    document.addEventListener("visibilitychange", update);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(t);
  }, [copied]);

  const status = diag?.status ?? "idle";
  const safe = diag?.backgroundSafe ?? false;
  const risky = status === "embed";

  const copyReport = async () => {
    try {
      await copyText(playbackReport());
      setCopied(true);
      pushToast({ title: "Playback report copied", desc: "Paste it wherever you're reporting the issue", kind: "ok" });
    } catch {
      pushToast({ title: "Couldn't copy the report", desc: "Try again from a secure (https) page", kind: "warn" });
    }
  };

  return (
    <div className="flex min-h-[64px] flex-wrap items-center justify-between gap-3 px-5 py-3.5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
          Playback engine
          {status !== "idle" && (
            <span
              className={cx(
                "rounded-full px-2 py-[3px] text-[10px] font-extrabold tracking-wider uppercase",
                safe ? "accent-bg text-black" : risky ? "bg-amber-400/15 text-amber-400" : "bg-[var(--panel-strong)] text-muted"
              )}
            >
              {safe ? "Background-safe" : risky ? "Pauses off-screen" : "See note"}
            </span>
          )}
        </div>
        <div className="text-muted-2 mt-0.5 text-[12px] leading-5">
          {diag?.label ?? "Waiting for the transport…"}
          {risky && " · Brave or the Android app keeps playing with the screen off."}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={() => void copyReport()}
          className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold hover:accent-text"
        >
          {copied ? <Check size={14} /> : <ClipboardCopy size={14} />} Copy report
        </button>
        {risky && (
          <button
            onClick={() => useUi.getState().setBgHelpOpen(true)}
            className="glass flex items-center gap-2 rounded-xl px-4 py-2 text-[12.5px] font-bold text-amber-400"
          >
            <TriangleAlert size={14} /> Fix
          </button>
        )}
      </div>
    </div>
  );
}
