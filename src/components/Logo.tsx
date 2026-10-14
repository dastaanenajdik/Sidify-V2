import { useId } from "react";
import { cx } from "@/lib/format";

/** The S, drawn as one stroke so it stays crisp from 16px favicons to the splash. */
export const S_PATH =
  "M16.3 7.7c-.95-1.55-2.6-2.4-4.55-2.4-2.65 0-4.55 1.45-4.55 3.5 0 4.75 9.6 2.55 9.6 7.5 0 2.15-2.05 3.75-4.95 3.75-2.2 0-4.05-.95-5.05-2.7";

/**
 * Sidify's mark: a red squircle with a white S. Nothing else — no wordmark
 * inside, no bars — so it reads the same in a tab, on a home screen and here.
 */
export function LogoMark({ size = 32, className, flat }: { size?: number; className?: string; flat?: boolean }) {
  const id = useId().replace(/:/g, "");
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cx("shrink-0", className)}
      role="img"
      aria-label="Sidify"
    >
      <defs>
        <linearGradient id={`sg-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ff5b6e" />
          <stop offset="1" stopColor="#fa233b" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="24" height="24" rx="5.4" fill={flat ? "#fa2d48" : `url(#sg-${id})`} />
      <path d={S_PATH} fill="none" stroke="#fff" strokeWidth="2.75" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Mark + "Sidify", for the desktop sidebar. */
export function LogoFull({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <span className={cx("inline-flex items-center gap-2.5", className)}>
      <LogoMark size={size} />
      <span className="text-[19px] leading-none font-bold tracking-[-0.4px]">Sidify</span>
    </span>
  );
}
