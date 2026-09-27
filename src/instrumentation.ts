/**
 * Next.js instrumentation hook — runs once per server instance, before that instance
 * serves its first request.
 *
 * Its only job is to pay for the YouTube engine bootstrap up front. Creating the
 * InnerTube session downloads and parses YouTube's `base.js` (the script that
 * decipheres the `n` throttle token), which takes a few seconds — and every cold
 * instance used to spend them inside a user's first `/api/stream` request, i.e. as
 * silence after pressing play (and again for every 2 MB download chunk that landed on
 * a fresh instance). See `warmEngine()` in src/lib/engine.ts.
 */
export async function register(): Promise<void> {
  // Node runtime only: the decipher evaluator needs `node:vm`, which Edge doesn't have.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // `next build` imports this module during "Collecting page data" — don't touch the
  // network (or fail the build) from there.
  if (process.env.NEXT_PHASE === "phase-next-build") return;

  // Imported lazily so the build never evaluates the youtubei.js module graph.
  const { warmEngine } = await import("@/lib/engine");
  // Deliberately not awaited: a request that arrives mid-bootstrap shares the same
  // in-flight session promise, so nothing is duplicated and the server stays responsive.
  void warmEngine();
}
