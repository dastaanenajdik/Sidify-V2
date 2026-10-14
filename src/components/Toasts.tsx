"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import { useUi } from "@/store/ui";
import { usePlayer } from "@/store/player";
import { cx } from "@/lib/format";

/** Small glass pills, bottom-centre (above the phone chrome). */
export default function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const hasPlayer = usePlayer((s) => s.index >= 0 && !s.fullPlayerOpen);
  return (
    <div
      className={cx(
        "pointer-events-none fixed inset-x-0 z-[150] flex flex-col items-center gap-2 px-4 desk:bottom-6",
        hasPlayer ? "bottom-[calc(150px+env(safe-area-inset-bottom,0px))]" : "bottom-[calc(88px+env(safe-area-inset-bottom,0px))]"
      )}
      aria-live="polite"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            layout
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ type: "spring", damping: 30, stiffness: 420 }}
            onClick={() => dismiss(t.id)}
            className="menu-glass pointer-events-auto flex max-w-[420px] items-center gap-3 rounded-full py-2.5 pr-5 pl-3.5 text-left"
          >
            <span className={cx("shrink-0", t.kind === "warn" ? "text-danger" : t.kind === "ok" ? "text-fg" : "text-fg-2")}>
              {t.kind === "warn" ? <AlertCircle size={18} /> : t.kind === "ok" ? <CheckCircle2 size={18} /> : <Info size={18} />}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-[13.5px] leading-tight font-semibold">{t.title}</span>
              {t.desc && <span className="block truncate text-[12px] leading-tight text-fg-2">{t.desc}</span>}
            </span>
            {typeof t.pct === "number" && (
              <span className="ml-1 h-1 w-12 shrink-0 overflow-hidden rounded-full bg-fill-2">
                <span className="block h-full bg-fg" style={{ width: `${t.pct}%` }} />
              </span>
            )}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
