/**
 * BackGuard v2 — pure decision logic (TECH_STACK §15.8).
 *
 * Jab tak gaana loaded + playing/buffering hai, Back button app ko band na kare.
 * Pehla Back absorb hota hai (+ toast), 2.5s ke andar dusra Back = exit allow.
 *
 * Ye file jaan-boojh kar DOM-free hai taaki `node --test` se unit test ho sake —
 * actual history/toast wiring `src/components/BackGuard.tsx` me hai.
 */

/** History sentinel entry ka state flag — gaana bajte waqt park hota hai. */
export const SIDIFY_GUARD_KEY = "sidifyGuard";

/** Full-player overlay entry ka state flag (v1, unchanged). */
export const SIDIFY_PLAYER_KEY = "sidifyPlayer";

/** Double-Back-to-exit window (ms). Dusra Back iske andar = exit allow. */
export const BACK_EXIT_WINDOW_MS = 2500;

export interface PlaybackSnapshot {
  hasTrack: boolean;
  isPlaying: boolean;
  isLoading: boolean;
}

/**
 * Guard sirf tab jab gaana loaded HAI aur baj/buffer raha hai.
 * Paused / khaali queue / failed load → Back bilkul untouched.
 */
export function isPlaybackGuardActive(s: PlaybackSnapshot): boolean {
  return s.hasTrack && (s.isPlaying || s.isLoading);
}

export type BackDecision = "allow" | "absorb" | "exit";

export interface BackPopContext {
  /** Guard active hai? (playing/buffering + track loaded) */
  guardActive: boolean;
  /** Pop ke baad URL badla? (asli in-app navigation → hamesha allow) */
  urlChanged: boolean;
  /** Pop ke baad wali entry pe sentinel flag hai? (buried sentinel → allow) */
  destHasSentinel: boolean;
  /** Kya ye pop hamare apne programmatic history.back() se aaya? */
  programmatic: boolean;
  /** Pichhle absorbed Back ke baad kitne ms (koi absorb na hua ho to Infinity). */
  sinceLastAbsorbMs: number;
}

/**
 * Ek popstate pop pe kya karna hai:
 * - "allow"   → kuch mat karo, Back normal chalne do (navigation / paused / exit).
 * - "absorb"  → sentinel wapas park karo + toast ("Back again to exit").
 * - "exit"    → 2.5s ke andar dusra Back — guard hat jao, exit allow.
 */
export function decideBackAction(ctx: BackPopContext): BackDecision {
  if (ctx.programmatic) return "allow";
  if (!ctx.guardActive) return "allow";
  if (ctx.urlChanged) return "allow";
  if (ctx.destHasSentinel) return "allow";
  if (ctx.sinceLastAbsorbMs < BACK_EXIT_WINDOW_MS) return "exit";
  return "absorb";
}

export interface SentinelContext {
  guardActive: boolean;
  playerOpen: boolean;
  topHasSentinel: boolean;
  topHasPlayerFlag: boolean;
}

/**
 * Sentinel kab park karna hai: playing + player band + top entry saaf ho.
 * Player khula ho to park defer hota hai (player entry stack-top own karti hai).
 */
export function shouldParkSentinel(c: SentinelContext): boolean {
  return c.guardActive && !c.playerOpen && !c.topHasSentinel && !c.topHasPlayerFlag;
}

/**
 * Sentinel kab wapas lena hai: paused/khaali + player band + top pe hamara
 * sentinel ho. Buried (neeche dabi) entries ko chhuna nahi — Back unpe aayega
 * to `destHasSentinel` rule se allow ho jayega.
 */
export function shouldConsumeSentinel(c: SentinelContext): boolean {
  return !c.guardActive && !c.playerOpen && c.topHasSentinel && !c.topHasPlayerFlag;
}
