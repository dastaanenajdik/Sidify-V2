/**
 * Playback diagnostics — a tiny ring buffer of transport/visibility events plus a
 * report builder.
 *
 * Why this exists: "the song pauses when I lock the screen" cannot be reproduced in a
 * desktop browser, and the fix depends on *which* engine was live and *who* paused it.
 * Chrome pauses a YouTube `<iframe>` embed on screen-off but keeps a plain `<audio>`
 * element alive; a Web Audio graph that is still `running` may be silent anyway. So the
 * engine records what actually happened on the phone, and Settings offers a one-tap
 * "Copy playback report" that can be pasted back into the bug report.
 *
 * Nothing here touches audio or the DOM — it only records, so it is safe to call from
 * anywhere in the transport.
 */

export interface DiagEvent {
  /** `Date.now()` at the moment of the event. */
  at: number;
  /** Short machine-ish label (`visibility`, `mode`, `PAUSE-WHILE-HIDDEN`, …). */
  kind: string;
  /** Optional free-form context (engine, position, element identity). */
  detail?: string;
}

const MAX_EVENTS = 90;
const events: DiagEvent[] = [];

/** Record one event. Oldest entries are dropped once the ring buffer is full. */
export function diagLog(kind: string, detail?: string) {
  const event: DiagEvent = { at: Date.now(), kind };
  if (detail) event.detail = detail;
  events.push(event);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

export function diagClear() {
  events.length = 0;
}

/** Snapshot (copy) of the buffer, oldest first. */
export function diagEvents(): DiagEvent[] {
  return events.slice();
}

/** `14:03:09.482` — a pause is only useful evidence together with *when* it happened. */
export function stamp(at: number): string {
  const d = new Date(at);
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

export function formatEvents(list: DiagEvent[]): string {
  if (!list.length) return "(no events recorded yet — play a song, then lock the screen)";
  return list.map((e) => `${stamp(e.at)}  ${e.kind}${e.detail ? `  · ${e.detail}` : ""}`).join("\n");
}

/**
 * Text blob for the clipboard: a `key: value` header block (user agent, engine, context
 * state, screen state) followed by the event log. Plain text on purpose — it gets pasted
 * into a chat/issue, not parsed.
 */
export function buildReport({
  fields,
  list = events,
  now = Date.now(),
}: {
  fields: Array<[string, string]>;
  list?: DiagEvent[];
  now?: number;
}): string {
  const width = Math.max(12, ...fields.map(([k]) => k.length));
  const head = fields.map(([k, v]) => `${k.padEnd(width)}: ${v}`).join("\n");
  return [
    "Sidify playback report",
    new Date(now).toISOString(),
    "",
    head,
    "",
    "--- events (oldest first) ---",
    formatEvents(list),
    "",
  ].join("\n");
}
