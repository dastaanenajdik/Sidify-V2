import { cx } from "@/lib/format";

export function BetaBadge({
  tone = "amber",
  className,
}: {
  /** `amber` on neutral surfaces, `inverse` inside primary buttons, `onWhite` on the white hero button. */
  tone?: "amber" | "inverse" | "onWhite";
  className?: string;
}) {
  return (
    <span
      className={cx(
        "rounded-full px-1.5 py-[1px] text-[9.5px] font-bold tracking-[0.06em] uppercase",
        tone === "amber" && "bg-amber-500/15 text-amber-500",
        tone === "inverse" && "bg-on-primary/15 text-on-primary",
        tone === "onWhite" && "bg-black/10 text-black/70",
        className
      )}
    >
      Beta
    </span>
  );
}
