"use client";

import { useEffect, useMemo } from "react";
import { ART_FADE_MS, ART_INTERVAL_MS, DELUXE_ART, moodFor, moodLayerStyle } from "@/lib/backdrop";
import { useBackdrop, upcomingArt } from "@/store/backdrop";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";

/**
 * Full-screen "deluxe" backdrop: 12 artworks crossfading on a slow loop behind the whole
 * app, with a mood tint that follows whatever is playing and a scrim that keeps UI text
 * readable on top. Purely decorative — never blocks pointer events.
 *
 * Nothing is rendered on the server (the store starts at `current = -1`), which keeps the
 * random starting artwork from breaking hydration.
 */
export default function DeluxeBackdrop() {
  const enabled = useSettings((s) => s.deluxeBackdrop);
  const moodId = useUi((s) => s.mood);
  const prevMoodId = useUi((s) => s.prevMood);
  const current = useBackdrop((s) => s.current);
  const previous = useBackdrop((s) => s.previous);
  const rev = useBackdrop((s) => s.rev);

  const live = current >= 0;
  const mood = useMemo(() => moodFor(moodId), [moodId]);

  // First artwork (after mount only).
  useEffect(() => {
    if (current < 0) useBackdrop.getState().next();
  }, [current]);

  // Auto-rotation: 11s per artwork, timer restarts whenever someone jumps manually.
  useEffect(() => {
    if (!enabled || !live) return;
    const t = window.setInterval(() => useBackdrop.getState().next(), ART_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [enabled, live, rev]);

  // Drop the outgoing image once its fade is done (keeps at most 2 in memory).
  useEffect(() => {
    if (previous == null) return;
    const t = window.setTimeout(() => useBackdrop.getState().clearPrevious(), ART_FADE_MS + 120);
    return () => window.clearTimeout(t);
  }, [previous, rev]);

  // Prefetch the upcoming artwork so a crossfade never waits on the network.
  useEffect(() => {
    if (!enabled || !live) return;
    const t = window.setTimeout(() => {
      const img = new Image();
      img.decoding = "async";
      img.src = window.innerWidth < 768 ? DELUXE_ART[upcomingArt()].srcSmall : DELUXE_ART[upcomingArt()].src;
    }, 3500);
    return () => window.clearTimeout(t);
  }, [enabled, live, rev]);

  if (!enabled) return null;

  const visible = [current, previous].filter((i) => i != null && i >= 0) as number[];

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-[var(--bg-deep)]" aria-hidden>
      {/* artwork slideshow */}
      {visible.map((i) => {
        const art = DELUXE_ART[i];
        if (!art) return null;
        const isCurrent = i === current;
        return (
          <img
            key={art.id}
            src={art.srcSmall}
            srcSet={`${art.srcSmall} 960w, ${art.src} 1920w`}
            sizes="100vw"
            alt=""
            draggable={false}
            decoding="async"
            fetchPriority={isCurrent ? "high" : "low"}
            className="kenburns absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: isCurrent ? 1 : 0,
              transition: `opacity ${ART_FADE_MS}ms ease-in-out`,
              willChange: "opacity, transform",
            }}
          />
        );
      })}

      {/* mood tint that follows the music: the outgoing mood stays opaque underneath while
          the incoming one fades in on top of it */}
      {live && prevMoodId && prevMoodId !== mood.id && (
        <div key={`prev-${prevMoodId}`} className="absolute inset-0" style={moodLayerStyle(moodFor(prevMoodId))} />
      )}
      {live && (
        <div
          key={mood.id}
          className="absolute inset-0"
          style={{ ...moodLayerStyle(mood), animation: `moodfade ${ART_FADE_MS}ms ease-in-out both` }}
        />
      )}

      {/* readability scrim — keeps every screen's copy crisp over the art */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--bg) 82%, transparent) 0%, color-mix(in srgb, var(--bg) 62%, transparent) 42%, color-mix(in srgb, var(--bg) 78%, transparent) 100%)",
        }}
      />

      {/* top/bottom falloff so the sidebar and player edges melt into the art */}
      <div
        className="absolute inset-x-0 bottom-0 h-40"
        style={{ background: "linear-gradient(180deg, transparent, var(--bg))", opacity: 0.7 }}
      />
      <div className="absolute inset-x-0 top-0 h-24" style={{ background: "linear-gradient(0deg, transparent, var(--bg))", opacity: 0.45 }} />
    </div>
  );
}

/**
 * Tiny dot rail for the hero card: shows which of the 12 artworks is on screen and lets
 * anyone jump between them (the slideshow keeps rolling from there).
 */
export function DeluxeArtDots({ className }: { className?: string }) {
  const current = useBackdrop((s) => s.current);
  const jump = useBackdrop((s) => s.jump);
  const enabled = useSettings((s) => s.deluxeBackdrop);

  if (!enabled) return null;

  return (
    <div className={className}>
      <div className="glass flex items-center gap-1.5 rounded-full px-2.5 py-1.5" style={{ backdropFilter: "blur(16px)" }}>
        {DELUXE_ART.map((a, i) => (
          <button
            key={a.id}
            aria-label={`Backdrop ${i + 1}: ${a.label}`}
            title={a.label}
            onClick={(e) => {
              e.stopPropagation();
              jump(i);
            }}
            className="rounded-full transition-all duration-300"
            style={{
              width: i === current ? 18 : 6,
              height: 6,
              background: i === current ? "var(--accent)" : "var(--muted-2)",
              opacity: i === current ? 1 : 0.5,
              boxShadow: i === current ? "0 0 10px var(--glow)" : undefined,
            }}
          />
        ))}
      </div>
      <div className="text-muted-2 mt-1.5 hidden text-[10.5px] font-semibold tracking-[0.16em] uppercase sm:block">
        {current >= 0 ? DELUXE_ART[current].label : "Deluxe backdrop"}
      </div>
    </div>
  );
}
