"use client";

import { ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Pause, Play, X } from "lucide-react";
import { cx } from "@/lib/format";

/* -------------------------------- buttons -------------------------------- */
export function PlayButton({
  playing,
  onClick,
  size = 52,
  className,
  label = "Play",
}: {
  playing?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={cx(
        "ring-focus grid shrink-0 place-items-center rounded-full accent-bg text-black transition-transform duration-150 hover:scale-105 active:scale-95",
        className
      )}
      style={{ width: size, height: size, boxShadow: "0 8px 28px -6px var(--glow)" }}
    >
      {playing ? (
        <Pause size={size * 0.42} fill="currentColor" strokeWidth={0} />
      ) : (
        <Play size={size * 0.42} fill="currentColor" strokeWidth={0} className="translate-x-[2px]" />
      )}
    </button>
  );
}

export function IconBtn({
  children,
  onClick,
  label,
  active,
  className,
  size = 18,
}: {
  children: ReactNode;
  onClick?: (e: React.MouseEvent) => void;
  label: string;
  active?: boolean;
  className?: string;
  size?: number;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cx(
        "ring-focus grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:text-[var(--text)]",
        active && "accent-text",
        className
      )}
      style={active ? { filter: "drop-shadow(0 0 6px var(--glow))" } : undefined}
    >
      {children}
    </button>
  );
}

/* --------------------------------- toggle --------------------------------- */
export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label || "toggle"}
      onClick={() => onChange(!checked)}
      className="relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200"
      style={{ background: checked ? "var(--accent)" : "var(--panel-strong)" }}
    >
      <span
        className="absolute top-[3px] grid h-[22px] w-[22px] place-items-center rounded-full bg-white shadow transition-all duration-200"
        style={{ left: checked ? "calc(100% - 25px)" : "3px" }}
      />
    </button>
  );
}

/* --------------------------------- slider --------------------------------- */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  alwaysThumb = false,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  alwaysThumb?: boolean;
  ariaLabel?: string;
}) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      aria-label={ariaLabel}
      className={cx("th-slider w-full", alwaysThumb && "thumb-always")}
      style={{ ["--fill" as string]: `${fill}%` }}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

/* -------------------------------- segmented ------------------------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="glass inline-flex rounded-full p-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={cx(
            "rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-all",
            value === o.id ? "accent-bg text-black" : "text-muted hover:text-[var(--text)]"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* --------------------------------- modal ---------------------------------- */
export function Modal({
  open,
  onClose,
  children,
  title,
  maxWidth = 520,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  maxWidth?: number;
}) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            style={{ background: "color-mix(in srgb, var(--bg-deep) 55%, transparent)" }}
          />
          <motion.div
            initial={{ scale: 0.94, y: 14, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, y: 10, opacity: 0 }}
            transition={{ type: "spring", damping: 26, stiffness: 340 }}
            className="glass-strong relative w-full rounded-3xl p-6"
            style={{ maxWidth, boxShadow: "0 30px 80px -20px var(--shadow)" }}
          >
            {title && (
              <div className="mb-5 flex items-center justify-between">
                <h3 className="font-display text-lg font-bold">{title}</h3>
                <button onClick={onClose} aria-label="Close" className="text-muted hover:text-[var(--text)]">
                  <X size={20} />
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
