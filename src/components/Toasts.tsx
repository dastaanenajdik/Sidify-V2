"use client";

import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { useUi } from "@/store/ui";

export default function Toasts() {
  const toasts = useUi((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed bottom-44 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col items-center gap-2 px-4 md:bottom-28">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 18, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ type: "spring", damping: 26, stiffness: 380 }}
            className="glass-strong pointer-events-auto flex w-auto max-w-full items-center gap-2.5 rounded-full py-2.5 pr-5 pl-3.5"
            style={{ boxShadow: "0 16px 44px -10px var(--shadow)" }}
          >
            {t.kind === "warn" ? (
              <AlertTriangle size={17} className="shrink-0 text-amber-400" />
            ) : t.kind === "info" ? (
              <Info size={17} className="shrink-0 text-sky-400" />
            ) : (
              <CheckCircle2 size={17} className="accent-text shrink-0" />
            )}
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{t.title}</div>
              {t.desc && <div className="text-muted truncate text-[11.5px]">{t.desc}</div>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
