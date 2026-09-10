"use client";

import { ReactNode, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => {
    ref.current?.scrollBy({ left: dir * (ref.current.clientWidth * 0.8), behavior: "smooth" });
  };
  return (
    <section className="group/sec relative">
      <div className="mb-3 flex items-end justify-between px-1">
        <div>
          <h2 className="font-display text-[19px] font-bold tracking-tight md:text-[21px]">{title}</h2>
          {subtitle && <p className="text-muted mt-0.5 text-[12.5px]">{subtitle}</p>}
        </div>
        <div className="flex items-center gap-2">
          {action}
          <div className="hidden gap-1 opacity-0 transition-opacity group-hover/sec:opacity-100 md:flex">
            <button
              aria-label="Scroll left"
              onClick={() => scroll(-1)}
              className="glass grid h-8 w-8 place-items-center rounded-full text-muted hover:text-[var(--text)]"
            >
              <ChevronLeft size={17} />
            </button>
            <button
              aria-label="Scroll right"
              onClick={() => scroll(1)}
              className="glass grid h-8 w-8 place-items-center rounded-full text-muted hover:text-[var(--text)]"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>
      </div>
      <div
        ref={ref}
        className="no-scrollbar -mx-1 flex snap-x snap-mandatory gap-1 overflow-x-auto scroll-smooth px-1 pb-1"
      >
        {children}
      </div>
    </section>
  );
}
