"use client";

import { forwardRef, memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Music2, X } from "lucide-react";
import { art, cx } from "@/lib/format";

/* -------------------------------------------------------------------------- */
/*  Artwork                                                                    */
/* -------------------------------------------------------------------------- */

export const Artwork = memo(function Artwork({
  src,
  size = 300,
  alt = "",
  className,
  rounded = "rounded-[7px]",
  eager,
  round,
}: {
  src?: string | null;
  /** Rendered size in CSS px — picks the rendition, not the box. */
  size?: number;
  alt?: string;
  className?: string;
  rounded?: string;
  eager?: boolean;
  round?: boolean;
}) {
  const url = art(src, size * 2);
  if (!url) {
    return (
      <div className={cx("grid place-items-center bg-raised text-fg-3", round ? "rounded-full" : rounded, className)}>
        <Music2 size={Math.max(14, Math.min(40, size / 4))} />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      draggable={false}
      className={cx("bg-raised object-cover", round ? "rounded-full" : rounded, className)}
    />
  );
});

/* -------------------------------------------------------------------------- */
/*  Buttons                                                                    */
/* -------------------------------------------------------------------------- */

type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement>;

export const IconButton = forwardRef<
  HTMLButtonElement,
  BtnProps & { label: string; size?: number; active?: boolean; tone?: "plain" | "fill" | "glass" | "art" }
>(function IconButton({ label, size = 32, active, tone = "plain", className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        "grid shrink-0 place-items-center rounded-full transition-[background,color,transform,opacity] duration-150 active:scale-[0.94] disabled:opacity-35",
        tone === "plain" && (active ? "bg-fill-2 text-fg" : "text-fg hover:bg-fill"),
        tone === "fill" && (active ? "bg-primary text-on-primary" : "bg-fill text-fg hover:bg-fill-2"),
        tone === "glass" && "bar-glass text-fg",
        tone === "art" && (active ? "bg-white/35 text-white" : "art-glass text-white hover:bg-white/25"),
        className
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  );
});

export function Button({
  variant = "primary",
  size = "md",
  className,
  children,
  ...rest
}: BtnProps & { variant?: "primary" | "secondary" | "ghost" | "danger" | "brand"; size?: "sm" | "md" | "lg" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition-[background,transform,opacity] duration-150 select-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-10 px-5 text-[14px]",
        size === "lg" && "h-12 px-7 text-[16px]",
        variant === "primary" && "bg-primary text-on-primary hover:opacity-90",
        variant === "secondary" && "bg-fill-2 text-fg hover:bg-fill-3",
        variant === "ghost" && "text-fg hover:bg-fill",
        variant === "danger" && "bg-danger/12 text-danger hover:bg-danger/20",
        variant === "brand" && "bg-brand text-white hover:opacity-90",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function ButtonLink({
  href,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold transition-[background,transform,opacity] duration-150 active:scale-[0.97]",
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-10 px-5 text-[14px]",
        size === "lg" && "h-12 px-7 text-[16px]",
        variant === "primary" && "bg-primary text-on-primary hover:opacity-90",
        variant === "secondary" && "bg-fill-2 text-fg hover:bg-fill-3",
        variant === "ghost" && "text-fg hover:bg-fill",
        className
      )}
    >
      {children}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inputs                                                                     */
/* -------------------------------------------------------------------------- */

/** iOS-style switch: white track and black knob in dark mode, inverted in light. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "relative h-[30px] w-[50px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-40",
        checked ? "bg-primary" : "bg-fill-3"
      )}
    >
      <span
        className={cx(
          "absolute top-[2px] left-[2px] h-[26px] w-[26px] rounded-full shadow-[0_2px_6px_rgba(0,0,0,.3)] transition-transform duration-200",
          checked ? "translate-x-[20px] bg-on-primary" : "bg-white"
        )}
      />
    </button>
  );
}

/** Legacy name. */
export const Toggle = Switch;

export function Range({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  onCommit,
  label,
  className,
  tone,
  big,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  label: string;
  className?: string;
  tone?: "on-art";
  big?: boolean;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      onKeyUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      className={cx("range", tone, big && "big", className)}
      style={{ ["--pct" as string]: `${Math.max(0, Math.min(100, pct))}%` }}
    />
  );
}

/** Legacy slider name. */
export function Slider({
  value,
  min,
  max,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  ariaLabel: string;
}) {
  return <Range value={value} min={min} max={max} onChange={onChange} label={ariaLabel} />;
}

/** A row of chips; the selected one is white with black text. */
export function Chips<T extends string>({
  value,
  options,
  onChange,
  className,
  size = "md",
}: {
  value: T;
  options: { id: T; label: ReactNode }[];
  onChange: (v: T) => void;
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cx("no-scrollbar flex gap-2 overflow-x-auto", className)} role="tablist">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            className={cx(
              "shrink-0 rounded-full font-semibold transition-colors duration-150",
              size === "md" ? "h-8 px-4 text-[13px]" : "h-7 px-3 text-[12px]",
              on ? "bg-primary text-on-primary" : "bg-fill text-fg hover:bg-fill-2"
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Legacy segmented control. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return <Chips value={value} options={options} onChange={onChange} size="sm" />;
}

/* -------------------------------------------------------------------------- */
/*  Sheets & modals                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A centred card on wide screens and a bottom sheet on phones. Escape and the
 * scrim close it.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 440,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: number;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-end justify-center sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <div className="absolute inset-0 bg-black/55" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ y: 40, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 30, opacity: 0, scale: 0.98 }}
            transition={{ type: "spring", damping: 32, stiffness: 380 }}
            className="menu-glass relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[22px] sm:rounded-[18px]"
            style={{ maxWidth: width }}
          >
            {(title || subtitle) && (
              <div className="flex items-start gap-3 px-5 pt-5 pb-3">
                <div className="min-w-0 flex-1">
                  {title && <h2 className="t-title truncate">{title}</h2>}
                  {subtitle && <p className="mt-0.5 text-[13px] text-fg-2">{subtitle}</p>}
                </div>
                <IconButton label="Close" onClick={onClose} tone="fill" size={30}>
                  <X size={16} />
                </IconButton>
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">{children}</div>
            {footer && <div className="hairline-t px-5 py-3.5">{footer}</div>}
            <div className="pb-safe sm:hidden" />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Legacy modal. */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {children}
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*  Page furniture                                                             */
/* -------------------------------------------------------------------------- */

/** Big page title (phones) — desktop pages carry a quieter headline. */
export function PageTitle({ children, trailing, className }: { children: ReactNode; trailing?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-end justify-between gap-3 px-4 pt-2 pb-3 desk:px-8 desk:pt-7", className)}>
      <h1 className="t-display min-w-0 truncate desk:t-headline">{children}</h1>
      {trailing && <div className="flex shrink-0 items-center gap-2 pb-1">{trailing}</div>}
    </div>
  );
}

export function SectionHeader({
  title,
  subtitle,
  href,
  onMore,
  className,
  trailing,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  href?: string;
  onMore?: () => void;
  className?: string;
  trailing?: ReactNode;
}) {
  const head = (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="t-section truncate">{title}</span>
      {(href || onMore) && <ChevronRight size={20} strokeWidth={2.6} className="shrink-0 text-fg-2" />}
    </span>
  );
  return (
    <div className={cx("mb-3 flex flex-wrap items-end justify-between gap-x-3 gap-y-2 px-4 desk:px-8", className)}>
      <div className="min-w-0">
        {subtitle && <div className="mb-0.5 text-[13px] font-medium text-fg-2">{subtitle}</div>}
        {href ? (
          <Link href={href} className="block hover:opacity-80">
            {head}
          </Link>
        ) : onMore ? (
          <button type="button" onClick={onMore} className="block text-left hover:opacity-80">
            {head}
          </button>
        ) : (
          head
        )}
      </div>
      {trailing}
    </div>
  );
}

/**
 * A horizontal shelf: native scrolling on touch, 34px arrow buttons on hover
 * for mouse users.
 */
export function Shelf({ children, className, gap = 14 }: { children: ReactNode; className?: string; gap?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const [edges, setEdges] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const start = el.scrollLeft < 8;
    const end = el.scrollLeft + el.clientWidth > el.scrollWidth - 8;
    setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  const scheduleMeasure = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      measure();
    });
  }, [measure]);

  useEffect(() => {
    measure();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(scheduleMeasure);
    ro.observe(el);
    el.addEventListener("scroll", scheduleMeasure, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", scheduleMeasure);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [measure, scheduleMeasure]);

  const page = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.86, behavior: "smooth" });
  };

  return (
    <div className={cx("group/shelf relative", className)}>
      <div
        ref={ref}
        className="no-scrollbar flex snap-x snap-mandatory scroll-px-4 overflow-x-auto px-4 pb-1 desk:scroll-px-8 desk:px-8"
        style={{ gap }}
      >
        {children}
      </div>
      <ShelfArrow dir={-1} hidden={edges.start} onClick={() => page(-1)} />
      <ShelfArrow dir={1} hidden={edges.end} onClick={() => page(1)} />
    </div>
  );
}

function ShelfArrow({ dir, hidden, onClick }: { dir: 1 | -1; hidden: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={dir === 1 ? "Scroll right" : "Scroll left"}
      onClick={onClick}
      className={cx(
        "absolute top-[38%] z-10 hidden h-[34px] w-[34px] -translate-y-1/2 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition-opacity duration-200 desk:grid",
        dir === 1 ? "right-2" : "left-2",
        hidden ? "pointer-events-none opacity-0" : "opacity-0 group-hover/shelf:opacity-100"
      )}
    >
      {dir === 1 ? <ChevronRight size={20} strokeWidth={2.4} /> : <ChevronLeft size={20} strokeWidth={2.4} />}
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function EmptyState({
  icon,
  title,
  desc,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  desc?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("mx-auto flex max-w-sm flex-col items-center px-6 py-14 text-center", className)}>
      {icon && <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-fill text-fg-2">{icon}</div>}
      <h3 className="t-title">{title}</h3>
      {desc && <p className="mt-1.5 text-[14px] leading-relaxed text-fg-2">{desc}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Grouped settings-style list, iOS fashion. */
export function Group({
  header,
  footer,
  children,
  className,
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx("mb-7", className)}>
      {header && <h3 className="t-eyebrow mb-2 px-4 text-fg-2">{header}</h3>}
      <div className="overflow-hidden rounded-[12px] bg-raised/80 [&>*+*]:shadow-[inset_0_0.5px_0_var(--hairline)]">{children}</div>
      {footer && <p className="mt-2 px-4 text-[12.5px] leading-relaxed text-fg-2">{footer}</p>}
    </section>
  );
}

export function GroupRow({
  icon,
  title,
  subtitle,
  trailing,
  onClick,
  href,
  danger,
  chevron,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  href?: string;
  danger?: boolean;
  chevron?: boolean;
}) {
  const body = (
    <>
      {icon && <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-[7px]", danger ? "text-danger" : "text-fg")}>{icon}</span>}
      <span className="min-w-[140px] flex-1 py-3">
        <span className={cx("block text-[15px] leading-snug", danger && "text-danger")}>{title}</span>
        {subtitle && <span className="mt-0.5 block text-[12.5px] leading-snug text-fg-2">{subtitle}</span>}
      </span>
      {trailing && <span className="flex max-w-full shrink-0 items-center gap-2 py-2">{trailing}</span>}
      {chevron && <ChevronRight size={18} className="shrink-0 text-fg-3" />}
    </>
  );
  const cls = "flex min-h-[52px] w-full flex-wrap items-center gap-x-3 gap-y-0.5 px-4 text-left";
  if (href)
    return (
      <Link href={href} className={cx(cls, "transition-colors hover:bg-fill")}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button type="button" onClick={onClick} className={cx(cls, "transition-colors hover:bg-fill")}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}
