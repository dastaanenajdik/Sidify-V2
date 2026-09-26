"use client";

import { useEffect, useRef } from "react";
import { usePlayer } from "@/store/player";
import { useUi } from "@/store/ui";
import {
  BACK_EXIT_WINDOW_MS,
  SIDIFY_GUARD_KEY,
  SIDIFY_PLAYER_KEY,
  decideBackAction,
  isPlaybackGuardActive,
  shouldConsumeSentinel,
  shouldParkSentinel,
} from "@/lib/backGuard";

/**
 * Android Back button vs. the music (v2 — TECH_STACK §15.8).
 *
 * v1 (unchanged): full player ek overlay hai, isliye uske khulne pe ek history
 * entry park hoti hai — Back #1 = player band (gaana chalta rehta hai).
 *
 * v2 (naya): jab tak gaana loaded + playing/buffering hai, ek history SENTINEL
 * entry (`sidifyGuard` state flag) park rehti hai, taaki root/mini-player pe
 * Back dabane se app band na ho (page unload = audio dead):
 *
 *   Back #1  → absorb: sentinel wapas park + toast ("Back again to exit")
 *   Back #2 (2.5s ke andar) → exit allow: guard hat jata hai, Back normal
 *
 * Untouched rehta hai:
 * - Normal in-app navigation (URL badalne wala har Back hamesha allow —
 *   sentinel sirf same-URL pop pe absorb karta hai).
 * - Paused / khaali-queue state (guard active hi nahi hota, Back bilkul normal).
 * - Player overlay ka Back-to-close (har Back pe player-close ko priority).
 *
 * Next.js ka apna state preserve karne ke liye `history.state` ko copy karke
 * sirf apne flags add karte hain, warna router entry ko foreign maan sakta hai.
 */

type HistState = Record<string, unknown> | null;

function topState(): HistState {
  try {
    return (history.state ?? null) as HistState;
  } catch {
    return null;
  }
}

function snapshotOf(s: {
  queue: unknown[];
  index: number;
  isPlaying: boolean;
  isLoading: boolean;
}) {
  return {
    hasTrack: s.index >= 0 && s.index < s.queue.length,
    isPlaying: s.isPlaying,
    isLoading: s.isLoading,
  };
}

// --- history.pushState/replaceState observation ------------------------------
// popstate akela ye nahi bata sakta ki pop "same-URL sentinel pop" tha ya
// "in-app back navigation" — dono me sirf DESTINATION state milta hai. Isliye
// pre-pop URL track karte hain (push/replace observe karke), aur apne flags ko
// router.replace (search `?q=` typing) se clobber hone se bachate hain.
// Sirf observe + flag-preserve — Next ke behaviour me koi change nahi.
let urlHooked = false;
let lastSeenUrl = "";
let origPush: History["pushState"] | null = null;
let origReplace: History["replaceState"] | null = null;

function hookHistoryUrl() {
  if (urlHooked || typeof window === "undefined") return;
  urlHooked = true;
  lastSeenUrl = window.location.href;
  origPush = history.pushState.bind(history);
  origReplace = history.replaceState.bind(history);
  const push = origPush;
  const replace = origReplace;
  history.pushState = function (data: unknown, unused: string, url?: string | URL | null) {
    push(data, unused, url);
    lastSeenUrl = window.location.href;
  };
  history.replaceState = function (data: unknown, unused: string, url?: string | URL | null) {
    let next: unknown = data;
    const cur = topState();
    const keepGuard = !!cur?.[SIDIFY_GUARD_KEY];
    const keepPlayer = !!cur?.[SIDIFY_PLAYER_KEY];
    if ((keepGuard || keepPlayer) && next !== null && typeof next === "object") {
      next = { ...(next as Record<string, unknown>) };
      if (keepGuard) (next as Record<string, unknown>)[SIDIFY_GUARD_KEY] = true;
      if (keepPlayer) (next as Record<string, unknown>)[SIDIFY_PLAYER_KEY] = true;
    }
    replace(next, unused, url);
    lastSeenUrl = window.location.href;
  };
}

function unhookHistoryUrl() {
  if (!urlHooked) return;
  urlHooked = false;
  if (origPush) history.pushState = origPush;
  if (origReplace) history.replaceState = origReplace;
  origPush = null;
  origReplace = null;
}

export default function BackGuard() {
  const fullPlayerOpen = usePlayer((s) => s.fullPlayerOpen);
  const queueLen = usePlayer((s) => s.queue.length);
  const index = usePlayer((s) => s.index);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isLoading = usePlayer((s) => s.isLoading);

  const guardActive = isPlaybackGuardActive({
    hasTrack: index >= 0 && index < queueLen,
    isPlaying,
    isLoading,
  });

  // Pichhle absorbed Back ka timestamp (0 = abhi tak koi absorb nahi).
  const firstAbsorbAt = useRef(0);
  // Hamare apne programmatic history.back() — agla popstate inhe passthrough de.
  const consumePass = useRef(false); // parked-entry consume (heal allowed)
  const exitPass = useRef(false); // double-Back exit (koi heal nahi)

  // --- 1. Player overlay: sidifyPlayer entry park/consume (v1, unchanged) ---
  useEffect(() => {
    if (!fullPlayerOpen) return;

    const base = topState() ?? {};
    history.pushState({ ...base, [SIDIFY_PLAYER_KEY]: true }, "");

    return () => {
      // Player band hua UI se (swipe/close) — parked entry wapas browser ko de do,
      // taaki user ka agla Back ek "khaali" press na bane.
      const now = topState();
      if (now?.[SIDIFY_PLAYER_KEY]) {
        consumePass.current = true;
        history.back();
      }
    };
  }, [fullPlayerOpen]);

  // --- 2. Playback exit-guard: sidifyGuard sentinel park/consume (v2) ---
  useEffect(() => {
    const top = topState();
    const ctx = {
      guardActive,
      playerOpen: fullPlayerOpen,
      topHasSentinel: !!top?.[SIDIFY_GUARD_KEY],
      topHasPlayerFlag: !!top?.[SIDIFY_PLAYER_KEY],
    };
    if (shouldParkSentinel(ctx)) {
      history.pushState({ ...(top ?? {}), [SIDIFY_GUARD_KEY]: true }, "");
      // Naya sentinel = naya cycle: purana window/pass state stale hai.
      firstAbsorbAt.current = 0;
      consumePass.current = false;
      exitPass.current = false;
    } else if (shouldConsumeSentinel(ctx)) {
      consumePass.current = true;
      history.back();
    }
    // Player khula ho to kuch nahi — player entry stack-top own karti hai;
    // band hote hi upar wala heal (popstate) ya ye effect park kar lega.
  }, [guardActive, fullPlayerOpen]);

  // --- 3. Unified popstate: player-close ko priority, phir exit-guard ---
  useEffect(() => {
    hookHistoryUrl();

    const onPop = () => {
      const urlChanged = window.location.href !== lastSeenUrl;
      lastSeenUrl = window.location.href;

      const programmatic = consumePass.current || exitPass.current;
      const wasConsume = consumePass.current;
      consumePass.current = false;
      exitPass.current = false;

      const st = usePlayer.getState();
      const open = st.fullPlayerOpen;

      // Hamara apna consume-back: deferred park heal karo (player khula hote
      // hue play dabaya tha) ya atki hui sentinel saaf karo (pause + close).
      if (programmatic) {
        if (wasConsume && !open) {
          const top = topState();
          const ctx = {
            guardActive: isPlaybackGuardActive(snapshotOf(st)),
            playerOpen: open,
            topHasSentinel: !!top?.[SIDIFY_GUARD_KEY],
            topHasPlayerFlag: !!top?.[SIDIFY_PLAYER_KEY],
          };
          if (shouldParkSentinel(ctx)) {
            history.pushState({ ...(top ?? {}), [SIDIFY_GUARD_KEY]: true }, "");
            firstAbsorbAt.current = 0;
          } else if (shouldConsumeSentinel(ctx)) {
            consumePass.current = true;
            history.back();
          }
        }
        return;
      }

      // Player khula hai → har Back player-close hai (v1 behaviour, unchanged).
      if (open) {
        st.set({ fullPlayerOpen: false });
        return;
      }

      const top = topState();
      const decision = decideBackAction({
        guardActive: isPlaybackGuardActive(snapshotOf(st)),
        urlChanged,
        destHasSentinel: !!top?.[SIDIFY_GUARD_KEY],
        programmatic: false,
        sinceLastAbsorbMs:
          firstAbsorbAt.current === 0 ? Number.POSITIVE_INFINITY : Date.now() - firstAbsorbAt.current,
      });

      if (decision === "absorb") {
        firstAbsorbAt.current = Date.now();
        // Sentinel wapas park — player flag scrub karke (stuck entry hygiene).
        const { [SIDIFY_PLAYER_KEY]: _dropped, ...rest } = top ?? {};
        void _dropped;
        history.pushState({ ...rest, [SIDIFY_GUARD_KEY]: true }, "");
        useUi.getState().pushToast({
          title: "Press Back again to exit",
          desc: "Music is playing",
          kind: "info",
          duration: BACK_EXIT_WINDOW_MS + 100,
        });
      } else if (decision === "exit") {
        // 2.5s ke andar dusra Back — guard hat jao, asli Back chalne do.
        firstAbsorbAt.current = 0;
        exitPass.current = true;
        history.back();
      }
      // "allow" → kuch nahi: normal navigation / paused Back bilkul untouched.
    };

    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      unhookHistoryUrl();
    };
  }, []);

  return null;
}
