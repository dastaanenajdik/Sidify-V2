"use client";

import Link from "next/link";
import MeshBackdrop from "./MeshBackdrop";
import { LogoMark } from "./Logo";
import { cx } from "@/lib/format";

/**
 * One headline number from Replay, as a card you could keep in a wallet:
 * real card proportions (85.6 × 54mm), the artwork's own mesh behind it, an
 * embossed cardholder line, and the mark top-right.
 */
export default function ReplayCard({
  label,
  value,
  detail,
  artwork,
  holder,
  since,
  href,
  className,
}: {
  label: string;
  value: string;
  detail?: string;
  artwork?: string;
  holder: string;
  since?: string | null;
  href: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cx(
        "relative block aspect-[1.586] w-[290px] shrink-0 snap-start overflow-hidden rounded-[16px] text-white shadow-[0_16px_40px_-12px_rgba(0,0,0,.6)] transition-transform duration-300 hover:-translate-y-0.5 desk:w-[320px]",
        className
      )}
    >
      <MeshBackdrop artwork={artwork} blur={34} scrim={false} />
      <div className="absolute inset-0" style={{ background: "linear-gradient(180deg, rgba(0,0,0,.08) 0%, rgba(0,0,0,.18) 45%, rgba(0,0,0,.55) 100%)" }} />
      <div className="relative flex h-full flex-col p-4">
        <div className="flex items-start justify-between">
          <span className="text-[11px] font-bold tracking-[0.14em] text-white/80 uppercase">{label}</span>
          <LogoMark size={26} />
        </div>
        <div className="mt-auto">
          <div className="truncate text-[28px] leading-tight font-extrabold tracking-[-0.6px]">{value}</div>
          {detail && <div className="truncate text-[13px] text-white/75">{detail}</div>}
        </div>
        <div className="mt-3 flex items-end justify-between gap-3">
          <span className="emboss truncate text-[12.5px] font-semibold">{holder || "Listener"}</span>
          {since && (
            <span className="shrink-0 text-right leading-none">
              <span className="block text-[7px] font-bold tracking-[0.12em] text-white/60 uppercase">Member since</span>
              <span className="emboss text-[11px] font-semibold">{since}</span>
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
