"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Camera, Check, Copy, Link2, QrCode, Share2, Smartphone } from "lucide-react";
import { ANDROID_APP, APP_SIZE_LABEL } from "@/lib/appRelease";
import { cx } from "@/lib/format";
import { SHORT_PATH, qrImagePath, shareText, shortLinkFor } from "@/lib/shortLink";
import { useUi } from "@/store/ui";

/* The QR itself is rendered by the server route, so it is one <img> everywhere. */
const QR_SIZE = 512;

function useClipboard() {
  const pushToast = useUi((s) => s.pushToast);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 2400);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async (text: string, what: string) => {
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // Non-HTTPS contexts and older browsers block the async clipboard API.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "-1000px";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand("copy");
      } catch {
        ok = false;
      }
      ta.remove();
    }
    if (ok) {
      setCopied(what);
      pushToast({ title: `${what} copied`, desc: what === "Link" ? "Paste it anywhere" : "Ready to send", kind: "ok" });
    } else {
      pushToast({ title: "Copy failed", desc: text, kind: "warn" });
    }
  };

  return { copied, copy };
}


/**
 * The browser origin, read hydration-safely: the server (and the first client paint)
 * sees an empty string, then React re-reads the real value. The QR image itself needs
 * no origin at all — that endpoint derives the host from the request.
 */
const noopSubscribe = () => () => {};

function useClientOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => ""
  );
}

/* ------------------------------------------------------------------ */
/*  Compact QR — home banner, sidebar-ish surfaces                     */
/* ------------------------------------------------------------------ */

export function QrQuickScan({ className }: { className?: string }) {
  const origin = useClientOrigin();

  return (
    <div
      className={cx("glass-strong flex items-center gap-3.5 rounded-3xl p-3.5 pr-5", className)}
      style={{ boxShadow: "0 24px 60px -30px var(--shadow)" }}
    >
      <span className="grid h-[86px] w-[86px] shrink-0 place-items-center overflow-hidden rounded-2xl bg-white p-1.5">
        {origin ? (
          <img src={qrImagePath(256)} alt="QR code for the app download link" className="h-full w-full" />
        ) : (
          <QrCode size={38} className="text-neutral-400" />
        )}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[12.5px] font-extrabold">
          <Camera size={13} className="accent-text" /> Scan to install
        </span>
        <span className="text-muted mt-1 block max-w-[15ch] text-[11.5px] leading-4">
          Point your phone camera here — the APK downloads straight to it.
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Full block — the /app page                                         */
/* ------------------------------------------------------------------ */

export function AppDownloadQr() {
  const { copied, copy } = useClipboard();
  const origin = useClientOrigin();

  const link = origin ? shortLinkFor(origin) : SHORT_PATH;
  const shortLabel = link.replace(/^https?:\/\//, "");

  return (
    <div className="grid gap-4 lg:grid-cols-[auto_1fr] lg:gap-6">
      {/* the code */}
      <div
        className="glass-strong mx-auto flex w-full max-w-[330px] flex-col items-center rounded-3xl p-5"
        style={{ boxShadow: "0 34px 90px -44px var(--shadow)" }}
      >
        <span className="grid aspect-square w-full place-items-center rounded-2xl bg-white p-3">
          {origin ? (
            <img src={qrImagePath(QR_SIZE)} alt="QR code that opens the app download link" className="h-full w-full" />
          ) : (
            <QrCode size={96} className="text-neutral-300" />
          )}
        </span>
        <div className="mt-3.5 flex items-center gap-2 text-[12px] font-bold">
          <Smartphone size={13} className="accent-text" />
          {ANDROID_APP.name} {ANDROID_APP.tag} · {APP_SIZE_LABEL}
        </div>
        <p className="text-muted-2 mt-1 text-center text-[11.5px] leading-4">
          Point your camera at the code — the file downloads on the phone.
        </p>
      </div>

      {/* the words */}
      <div className="flex flex-col justify-center">
        <h3 className="font-display text-[20px] font-extrabold tracking-tight md:text-[24px]">
          On a computer? Scan the code.
        </h3>
        <p className="text-muted mt-2 max-w-xl text-[13.5px] leading-6">
          The QR points at this site&apos;s short link, so the same code always downloads the newest release — print it,
          put it in a story, or keep it on screen and open it with the phone you want the app on.
        </p>

        {/* short link + copy */}
        <div className="glass mt-4 flex flex-wrap items-center gap-2 rounded-2xl p-2 pl-3.5">
          <Link2 size={14} className="accent-text shrink-0" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold">{shortLabel}</span>
          <button
            type="button"
            onClick={() => void copy(link, "Link")}
            className="ring-focus glass hover-panel flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold active:scale-95"
          >
            {copied === "Link" ? <Check size={13} strokeWidth={3} /> : <Copy size={13} />}
            {copied === "Link" ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            onClick={() => void copy(shareText(window.location.origin), "Message")}
            className="ring-focus glass hover-panel accent-text flex items-center gap-1.5 rounded-xl px-3 py-2 text-[12px] font-bold active:scale-95"
          >
            {copied === "Message" ? <Check size={13} strokeWidth={3} /> : <Share2 size={13} />}
            Share text
          </button>
        </div>

        {/* print files */}
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <a
            href={qrImagePath(1024, "png")}
            download={`${ANDROID_APP.name.toLowerCase()}-${ANDROID_APP.version}-qr.png`}
            className="ring-focus glass hover-panel flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px] font-bold"
          >
            <QrCode size={14} /> Download QR (PNG)
          </a>
          <a
            href={qrImagePath(1024, "svg")}
            download={`${ANDROID_APP.name.toLowerCase()}-${ANDROID_APP.version}-qr.svg`}
            className="ring-focus glass hover-panel flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[12.5px] font-bold"
          >
            <QrCode size={14} /> SVG for print
          </a>
        </div>

        <p className="text-muted-2 mt-3 text-[12px] leading-5">
          Already reading this on the phone? Skip the code — <span className="font-bold text-[var(--text)]">tap the
          download button above</span>.
        </p>
      </div>
    </div>
  );
}
