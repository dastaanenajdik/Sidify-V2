"use client";

import { useEffect } from "react";
import { usePlayer } from "@/store/player";

/**
 * Android Back button vs. the music.
 *
 * Sidify ka full player ek full-screen overlay hai — apna route nahi. Pehle Back dabane pe
 * browser seedha ek page peeche chala jata tha aur page unload hone ke saath audio bhi mar
 * jata tha ("back karte hi gana band"). Ab jab player khulta hai to ek history entry park
 * hoti hai, isliye:
 *
 *   Back #1  → player band (gaana chalta rehta hai, app me hi rehte ho)
 *   Back #2  → normal navigation / app se bahar
 *
 * Next.js ka apna state preserve karne ke liye `history.state` ko copy karke sirf apna
 * `sidifyPlayer` flag add karte hain, warna router is entry ko foreign maan sakta hai.
 */
export default function BackGuard() {
  const open = usePlayer((s) => s.fullPlayerOpen);

  useEffect(() => {
    if (!open) return;

    const base = (history.state ?? {}) as Record<string, unknown>;
    history.pushState({ ...base, sidifyPlayer: true }, "");

    // Popping our parked entry means "close the player", never "leave the site".
    const onPop = () => usePlayer.getState().set({ fullPlayerOpen: false });
    window.addEventListener("popstate", onPop);

    return () => {
      window.removeEventListener("popstate", onPop);
      // Player band hua UI se (swipe/close) — parked entry wapas browser ko de do, taaki
      // user ka agla Back ek "khaali" press na bane.
      const now = history.state as { sidifyPlayer?: boolean } | null;
      if (now?.sidifyPlayer) history.back();
    };
  }, [open]);

  return null;
}
