/**
 * Listen Together — the room model and every state transition, as pure
 * functions (no I/O), shared by the API routes and the client.
 *
 * Timing model: a room stores `positionMs` measured at `anchorMs` (server
 * clock). While playing, the position at time T is
 *   positionMs + max(0, T − anchorMs)
 * clamped to the track length. Play and seek anchor slightly in the future
 * (START_LEAD_MS) so every device has time to start at the same moment.
 * Clients apply only states whose `seq` is newer than the last one applied.
 */

export const ROOM_LIMITS = {
  defaultMembers: 5,
  minMembers: 2,
  maxMembers: 10,
  /** A member who hasn't checked in for this long loses their slot. */
  // Allow backgrounded/mobile browsers to suspend timers without immediately
  // removing a still-open listener from the room.
  graceMs: 5 * 60_000,
  /** Shown as "away" after this long without a check-in. */
  awayMs: 9_000,
  /** An empty room is deleted after this long. */
  emptyTtlMs: 120_000,
  maxAgeMs: 12 * 60 * 60_000,
  maxUpcoming: 25,
  maxHistory: 10,
  startLeadMs: 350,
  activity: 30,
  chatMessages: 80,
  chatMessageLength: 300,
} as const;

/** Six characters; no I, L or O, so a code read aloud can't be misheard. */
export const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 6;

export interface RoomTrack {
  id: string;
  videoId?: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  artwork: string;
  durationMs: number;
  explicit?: boolean;
  /** "user" = someone queued it; "autoplay" = similar music the room lined up. */
  tier?: "user" | "autoplay";
  addedBy?: string;
}

export interface RoomMember {
  id: string;
  name: string;
  joinedAt: number;
  lastSeen: number;
  /** Latest chat message id this member has scrolled past / read (read receipts). */
  readUpTo?: string;
}

export interface RoomActivity {
  at: number;
  by: string;
  text: string;
}

export interface RoomChatMessage {
  id: string;
  at: number;
  memberId: string;
  by: string;
  text: string;
  /** Set when the sender edits the message after sending. */
  edited?: boolean;
  /** A quoted message this one replies to, resolved server-side. */
  replyTo?: { id: string; by: string; text: string } | null;
}

/** What every member sees. */
export interface RoomState {
  code: string;
  name: string;
  createdAt: number;
  hostId: string;
  hostOnly: boolean;
  maxMembers: number;
  autoplay: boolean;
  members: RoomMember[];
  queue: RoomTrack[];
  queueIndex: number;
  isPlaying: boolean;
  positionMs: number;
  anchorMs: number;
  /** Bumped on every change a member can see. */
  seq: number;
  /** Bumped when the queue's contents change. */
  queueSeq: number;
  startedBy: string;
  activity: RoomActivity[];
  chat: RoomChatMessage[];
}

/** Server-side record: the public state plus member tokens and housekeeping. */
export interface RoomRecord extends RoomState {
  tokens: Record<string, string>;
  emptySince: number | null;
  lastFillAt: number;
  dead?: boolean;
}

export type ControlAction =
  | { type: "play"; positionMs?: number }
  | { type: "pause"; positionMs?: number }
  | { type: "seek"; positionMs: number }
  | { type: "load"; queue: unknown[]; index: number; positionMs?: number; play?: boolean }
  | { type: "playNow"; track: unknown }
  | { type: "jump"; index: number }
  | { type: "next" }
  | { type: "prev" }
  | { type: "ended"; trackId: string }
  | { type: "queueAdd"; track: unknown; mode: "next" | "end" }
  | { type: "queueRemove"; index: number }
  | { type: "queueMove"; from: number; to: number }
  | { type: "queueClear" }
  | { type: "setAutoplay"; on: boolean }
  | { type: "setHostOnly"; on: boolean }
  | { type: "setCapacity"; max: number }
  | { type: "kick"; memberId: string }
  | { type: "end" };

export type ControlResult = { ok: true; needsFill?: boolean } | { ok: false; status: number; error: string };

/* ---------------------------------- codes --------------------------------- */

/** Uppercases, drops anything that isn't a letter or digit, reads I/L as 1 and O as 0. */
export function normalizeCode(input: string): string {
  return (input || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0")
    .slice(0, CODE_LENGTH);
}

export function isValidCode(code: string): boolean {
  return code.length === CODE_LENGTH && [...code].every((c) => CODE_ALPHABET.includes(c));
}

export function randomCode(random: () => number = Math.random): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return out;
}

/* -------------------------------- sanitising ------------------------------- */

function str(v: unknown, max: number): string {
  return typeof v === "string" ? v.slice(0, max) : "";
}

export function cleanName(v: unknown): string {
  const name = str(v, 40).replace(/\s+/g, " ").trim().slice(0, 24);
  return name || "Listener";
}

export function cleanTrack(raw: unknown): RoomTrack | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const videoId = str(r.videoId, 20) || undefined;
  if (videoId && !/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  const id = str(r.id, 80) || videoId;
  const title = str(r.title, 200).trim();
  if (!id || !title || !videoId) return null;
  const artwork = str(r.artwork, 600);
  const durationMs = Number(r.durationMs);
  return {
    id,
    videoId,
    title,
    artist: str(r.artist, 200).trim() || "Unknown artist",
    artistId: str(r.artistId, 80) || undefined,
    album: str(r.album, 200) || undefined,
    albumId: str(r.albumId, 200) || undefined,
    artwork: /^https:\/\//.test(artwork) ? artwork : "",
    durationMs: Number.isFinite(durationMs) && durationMs > 0 ? Math.min(durationMs, 6 * 3600_000) : 0,
    explicit: r.explicit === true || undefined,
    tier: r.tier === "user" || r.tier === "autoplay" ? r.tier : undefined,
  };
}

/* ---------------------------------- time ---------------------------------- */

export function currentOf(room: Pick<RoomState, "queue" | "queueIndex">): RoomTrack | null {
  return room.queueIndex >= 0 && room.queueIndex < room.queue.length ? room.queue[room.queueIndex] : null;
}

export function expectedPosition(
  room: Pick<RoomState, "isPlaying" | "positionMs" | "anchorMs" | "queue" | "queueIndex">,
  now: number
): number {
  const dur = currentOf(room)?.durationMs || 0;
  let pos = room.positionMs;
  if (room.isPlaying) pos += Math.max(0, now - room.anchorMs);
  pos = Math.max(0, pos);
  return dur > 0 ? Math.min(pos, dur) : pos;
}

/* -------------------------------- creation -------------------------------- */

export function newRoom(opts: {
  code: string;
  hostId: string;
  hostName: string;
  token: string;
  now: number;
  hostOnly?: boolean;
  autoplay?: boolean;
  seed?: { queue: unknown[]; index: number; positionMs: number; isPlaying: boolean } | null;
}): RoomRecord {
  const host: RoomMember = { id: opts.hostId, name: cleanName(opts.hostName), joinedAt: opts.now, lastSeen: opts.now };
  const rec: RoomRecord = {
    code: opts.code,
    name: `${host.name}'s room`,
    createdAt: opts.now,
    hostId: host.id,
    hostOnly: !!opts.hostOnly,
    maxMembers: ROOM_LIMITS.defaultMembers,
    autoplay: opts.autoplay !== false,
    members: [host],
    queue: [],
    queueIndex: -1,
    isPlaying: false,
    positionMs: 0,
    anchorMs: opts.now,
    seq: 1,
    queueSeq: 1,
    startedBy: host.name,
    activity: [{ at: opts.now, by: host.name, text: "started the room" }],
    chat: [],
    tokens: { [host.id]: opts.token },
    emptySince: null,
    lastFillAt: 0,
  };
  if (opts.seed && Array.isArray(opts.seed.queue)) {
    loadQueue(rec, opts.seed.queue, opts.seed.index, opts.now, {
      positionMs: opts.seed.positionMs,
      play: opts.seed.isPlaying,
      by: host.name,
    });
  }
  return rec;
}

export function publicRoom(rec: RoomRecord): RoomState {
  return {
    code: rec.code,
    name: rec.name,
    createdAt: rec.createdAt,
    hostId: rec.hostId,
    hostOnly: rec.hostOnly,
    maxMembers: rec.maxMembers,
    autoplay: rec.autoplay,
    members: rec.members,
    queue: rec.queue,
    queueIndex: rec.queueIndex,
    isPlaying: rec.isPlaying,
    positionMs: rec.positionMs,
    anchorMs: rec.anchorMs,
    seq: rec.seq,
    queueSeq: rec.queueSeq,
    startedBy: rec.startedBy,
    activity: rec.activity,
    // Existing in-memory/database room records created before chat was added
    // remain readable and simply start with an empty chat history.
    chat: rec.chat ?? [],
  };
}

/* ------------------------------- membership ------------------------------- */

export function memberByToken(rec: RoomRecord, token: string | null | undefined): RoomMember | null {
  if (!token) return null;
  const id = Object.keys(rec.tokens).find((k) => rec.tokens[k] === token);
  return id ? (rec.members.find((m) => m.id === id) ?? null) : null;
}

function log(rec: RoomRecord, now: number, by: string, text: string) {
  rec.activity = [...rec.activity, { at: now, by, text }].slice(-ROOM_LIMITS.activity);
}

/** Names of members who newly left between two snapshots of the same room. */
export function newlyLeftMembers(
  previous: Pick<RoomState, "code" | "activity"> | null,
  next: Pick<RoomState, "code" | "activity">
): string[] {
  if (!previous || previous.code !== next.code) return [];
  const seen = new Set(previous.activity.map((event) => `${event.at}:${event.by}:${event.text}`));
  return next.activity
    .filter((event) => event.text === "left" && !seen.has(`${event.at}:${event.by}:${event.text}`))
    .map((event) => event.by);
}

function bump(rec: RoomRecord, queueChanged = false) {
  rec.seq++;
  if (queueChanged) rec.queueSeq++;
}

export function addMember(
  rec: RoomRecord,
  m: { id: string; name: string; token: string },
  now: number
): { ok: true } | { ok: false; status: number; error: string } {
  if (rec.members.length >= rec.maxMembers) return { ok: false, status: 409, error: "This room is full" };
  const member: RoomMember = { id: m.id, name: cleanName(m.name), joinedAt: now, lastSeen: now };
  rec.members = [...rec.members, member];
  rec.tokens = { ...rec.tokens, [m.id]: m.token };
  rec.emptySince = null;
  log(rec, now, member.name, "joined");
  bump(rec);
  return { ok: true };
}

export function removeMember(rec: RoomRecord, memberId: string, now: number, reason: "left" | "removed" | "timed out") {
  const m = rec.members.find((x) => x.id === memberId);
  if (!m) return;
  rec.members = rec.members.filter((x) => x.id !== memberId);
  const tokens = { ...rec.tokens };
  delete tokens[memberId];
  rec.tokens = tokens;
  // Timeouts can be caused by a temporarily suspended browser; do not make
  // that look like an explicit departure in the activity/chat feed.
  if (reason !== "timed out") log(rec, now, m.name, reason === "left" ? "left" : "was removed");
  if (rec.hostId === memberId && rec.members.length) {
    const next = [...rec.members].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    rec.hostId = next.id;
    log(rec, now, next.name, "is now the host");
  }
  if (!rec.members.length) {
    rec.emptySince = now;
    // Room chat is ephemeral: discard it as soon as the last listener goes offline.
    rec.chat = [];
  }
  bump(rec);
}

/** Heartbeat. Returns true when the record needs writing back. */
export function touch(rec: RoomRecord, memberId: string, now: number): boolean {
  const m = rec.members.find((x) => x.id === memberId);
  if (!m) return false;
  if (now - m.lastSeen < 4000) return false;
  m.lastSeen = now;
  return true;
}

/**
 * Housekeeping on every access: drop members who vanished, advance a track
 * nobody reported finishing, and mark the room dead when it's empty or old.
 * Returns true when anything changed.
 */
export function sweep(rec: RoomRecord, now: number): boolean {
  let changed = false;
  for (const m of [...rec.members]) {
    if (now - m.lastSeen > ROOM_LIMITS.graceMs) {
      removeMember(rec, m.id, now, "timed out");
      changed = true;
    }
  }
  if (!rec.members.length && rec.emptySince && now - rec.emptySince > ROOM_LIMITS.emptyTtlMs) {
    rec.dead = true;
    changed = true;
  }
  if (now - rec.createdAt > ROOM_LIMITS.maxAgeMs) {
    rec.dead = true;
    changed = true;
  }
  const cur = currentOf(rec);
  if (rec.isPlaying && cur && cur.durationMs > 0 && expectedPosition(rec, now) >= cur.durationMs) {
    // Allow a little slack for devices still finishing the last second.
    const overrun = rec.positionMs + (now - rec.anchorMs) - cur.durationMs;
    if (overrun > 2500) {
      advance(rec, now, rec.startedBy || "Room", true);
      changed = true;
    }
  }
  return changed;
}

/* --------------------------------- queue ---------------------------------- */

function trimQueue(rec: RoomRecord) {
  const before = Math.max(0, rec.queueIndex - ROOM_LIMITS.maxHistory);
  if (before > 0) {
    rec.queue = rec.queue.slice(before);
    rec.queueIndex -= before;
  }
  const maxLen = rec.queueIndex + 1 + ROOM_LIMITS.maxUpcoming;
  if (rec.queue.length > maxLen) rec.queue = rec.queue.slice(0, maxLen);
}

function dedupe(tracks: RoomTrack[]): RoomTrack[] {
  const seen = new Set<string>();
  return tracks.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

export function loadQueue(
  rec: RoomRecord,
  rawQueue: unknown[],
  index: number,
  now: number,
  opts: { positionMs?: number; play?: boolean; by: string }
): boolean {
  const cleaned = rawQueue.slice(0, 200).map(cleanTrack);
  const target = cleaned[index] ?? null;
  const queue = dedupe(cleaned.filter((t): t is RoomTrack => !!t));
  if (!queue.length || !target) return false;
  const at = Math.max(0, queue.findIndex((t) => t.id === target.id));
  rec.queue = queue.map((t) => ({ ...t, tier: t.tier === "autoplay" ? "autoplay" : undefined }));
  rec.queueIndex = at;
  trimQueue(rec);
  const play = opts.play !== false;
  rec.positionMs = Math.max(0, Number(opts.positionMs) || 0);
  rec.isPlaying = play;
  rec.anchorMs = now + (play ? ROOM_LIMITS.startLeadMs : 0);
  rec.startedBy = opts.by;
  bump(rec, true);
  return true;
}

function startAt(rec: RoomRecord, index: number, now: number, by: string) {
  rec.queueIndex = index;
  rec.positionMs = 0;
  rec.isPlaying = true;
  rec.anchorMs = now + ROOM_LIMITS.startLeadMs;
  rec.startedBy = by;
  trimQueue(rec);
}

/** Next track if there is one; otherwise stop at the end. Returns true when it moved on. */
export function advance(rec: RoomRecord, now: number, by: string, natural = false): boolean {
  if (rec.queueIndex + 1 < rec.queue.length) {
    startAt(rec, rec.queueIndex + 1, now, natural ? rec.startedBy : by);
    if (!natural) log(rec, now, by, "skipped ahead");
    bump(rec, true);
    return true;
  }
  const cur = currentOf(rec);
  rec.isPlaying = false;
  rec.positionMs = cur?.durationMs || rec.positionMs;
  rec.anchorMs = now;
  bump(rec);
  return false;
}

export function upcomingCount(rec: Pick<RoomState, "queue" | "queueIndex">): number {
  return Math.max(0, rec.queue.length - rec.queueIndex - 1);
}

export function needsFill(rec: RoomRecord): boolean {
  return rec.autoplay && !!currentOf(rec)?.videoId && upcomingCount(rec) < 2;
}

/** Appends similar songs the room doesn't already hold. Returns how many landed. */
export function appendAutoplay(rec: RoomRecord, tracks: unknown[], now: number): number {
  rec.lastFillAt = now;
  const have = new Set(rec.queue.map((t) => t.id));
  const room = ROOM_LIMITS.maxUpcoming - upcomingCount(rec);
  const fresh = tracks
    .map(cleanTrack)
    .filter((t): t is RoomTrack => !!t && !have.has(t.id))
    .slice(0, Math.max(0, Math.min(8, room)))
    .map((t) => ({ ...t, tier: "autoplay" as const }));
  if (!fresh.length) return 0;
  rec.queue = [...rec.queue, ...fresh];
  bump(rec, true);
  return fresh.length;
}

/* -------------------------------- controls -------------------------------- */

const HOST_ONLY_FREE = new Set(["ended"]);
const HOST_ACTIONS = new Set(["setHostOnly", "setCapacity", "kick", "end"]);

export function applyControl(rec: RoomRecord, member: RoomMember, action: ControlAction, now: number): ControlResult {
  const isHost = rec.hostId === member.id;
  if (HOST_ACTIONS.has(action.type) && !isHost) return { ok: false, status: 403, error: "Only the host can do that" };
  if (rec.hostOnly && !isHost && !HOST_ONLY_FREE.has(action.type)) {
    return { ok: false, status: 403, error: "Only the host can control the music right now" };
  }
  const by = member.name;
  const cur = currentOf(rec);

  switch (action.type) {
    case "play": {
      if (!cur) return { ok: false, status: 409, error: "Nothing to play yet" };
      const pos = Number.isFinite(action.positionMs) ? Number(action.positionMs) : expectedPosition(rec, now);
      const atEnd = cur.durationMs > 0 && pos >= cur.durationMs - 500;
      rec.positionMs = atEnd ? 0 : Math.max(0, pos);
      rec.isPlaying = true;
      rec.anchorMs = now + ROOM_LIMITS.startLeadMs;
      log(rec, now, by, "pressed play");
      bump(rec);
      return { ok: true };
    }
    case "pause": {
      if (!cur) return { ok: true };
      const pos = Number.isFinite(action.positionMs) ? Number(action.positionMs) : expectedPosition(rec, now);
      rec.positionMs = Math.max(0, cur.durationMs > 0 ? Math.min(pos, cur.durationMs) : pos);
      rec.isPlaying = false;
      rec.anchorMs = now;
      log(rec, now, by, "paused");
      bump(rec);
      return { ok: true };
    }
    case "seek": {
      if (!cur) return { ok: true };
      const pos = Math.max(0, Number(action.positionMs) || 0);
      rec.positionMs = cur.durationMs > 0 ? Math.min(pos, cur.durationMs - 250) : pos;
      rec.anchorMs = now + (rec.isPlaying ? ROOM_LIMITS.startLeadMs : 0);
      bump(rec);
      return { ok: true };
    }
    case "load": {
      if (!Array.isArray(action.queue)) return { ok: false, status: 400, error: "Bad queue" };
      const ok = loadQueue(rec, action.queue, Number(action.index) || 0, now, {
        positionMs: action.positionMs,
        play: action.play,
        by,
      });
      if (!ok) return { ok: false, status: 400, error: "Nothing playable in that list" };
      const t = currentOf(rec);
      if (t) log(rec, now, by, `played ${t.title}`);
      return { ok: true, needsFill: needsFill(rec) };
    }
    case "playNow": {
      const t = cleanTrack(action.track);
      if (!t) return { ok: false, status: 400, error: "Bad track" };
      t.addedBy = by;
      if (!cur) {
        rec.queue = [t];
        startAt(rec, 0, now, by);
      } else {
        const rest = rec.queue.filter((x, i) => x.id !== t.id || i === rec.queueIndex);
        const curIdx = rest.findIndex((x) => x.id === cur.id);
        if (cur.id === t.id) {
          rec.queue = rest;
          rec.queueIndex = curIdx;
          rec.positionMs = 0;
          rec.isPlaying = true;
          rec.anchorMs = now + ROOM_LIMITS.startLeadMs;
        } else {
          rest.splice(curIdx + 1, 0, t);
          rec.queue = rest;
          startAt(rec, curIdx + 1, now, by);
        }
      }
      log(rec, now, by, `played ${t.title}`);
      bump(rec, true);
      return { ok: true, needsFill: needsFill(rec) };
    }
    case "jump": {
      const i = Math.floor(Number(action.index));
      if (!Number.isFinite(i) || i < 0 || i >= rec.queue.length) return { ok: false, status: 400, error: "Bad index" };
      startAt(rec, i, now, by);
      const t = currentOf(rec);
      if (t) log(rec, now, by, `played ${t.title}`);
      bump(rec, true);
      return { ok: true, needsFill: needsFill(rec) };
    }
    case "next": {
      if (!cur) return { ok: true };
      if (upcomingCount(rec) === 0 && rec.autoplay) return { ok: true, needsFill: true };
      advance(rec, now, by);
      return { ok: true, needsFill: needsFill(rec) };
    }
    case "prev": {
      if (!cur) return { ok: true };
      if (expectedPosition(rec, now) > 4000 || rec.queueIndex === 0) {
        rec.positionMs = 0;
        rec.anchorMs = now + (rec.isPlaying ? ROOM_LIMITS.startLeadMs : 0);
      } else {
        startAt(rec, rec.queueIndex - 1, now, by);
      }
      bump(rec, true);
      return { ok: true };
    }
    case "ended": {
      if (!cur || cur.id !== action.trackId) return { ok: true };
      // A device that is far behind the room can't finish the song for everyone.
      if (cur.durationMs > 0 && expectedPosition(rec, now) < cur.durationMs - 15_000) return { ok: true };
      if (upcomingCount(rec) === 0 && rec.autoplay) return { ok: true, needsFill: true };
      advance(rec, now, by, true);
      return { ok: true, needsFill: needsFill(rec) };
    }
    case "queueAdd": {
      const t = cleanTrack(action.track);
      if (!t) return { ok: false, status: 400, error: "Bad track" };
      t.tier = "user";
      t.addedBy = by;
      if (!cur) {
        rec.queue = [t];
        startAt(rec, 0, now, by);
        log(rec, now, by, `played ${t.title}`);
        bump(rec, true);
        return { ok: true, needsFill: needsFill(rec) };
      }
      if (cur.id === t.id) return { ok: true };
      const q = rec.queue.filter((x, i) => i <= rec.queueIndex || x.id !== t.id);
      let at = rec.queueIndex + 1;
      if (action.mode === "end") while (at < q.length && q[at].tier === "user") at++;
      if (upcomingCount({ queue: q, queueIndex: rec.queueIndex }) >= ROOM_LIMITS.maxUpcoming) {
        // Make room by dropping the furthest AutoPlay pick, if any.
        const dropAt = q.map((x) => x.tier).lastIndexOf("autoplay");
        if (dropAt > rec.queueIndex) q.splice(dropAt, 1);
        else return { ok: false, status: 409, error: "The queue is full" };
      }
      q.splice(at, 0, t);
      rec.queue = q;
      log(rec, now, by, `queued ${t.title}`);
      bump(rec, true);
      return { ok: true };
    }
    case "queueRemove": {
      const i = Math.floor(Number(action.index));
      if (!Number.isFinite(i) || i <= rec.queueIndex || i >= rec.queue.length) return { ok: true };
      rec.queue = rec.queue.filter((_, k) => k !== i);
      bump(rec, true);
      return { ok: true, needsFill: needsFill(rec) };
    }
    case "queueMove": {
      const from = Math.floor(Number(action.from));
      const to = Math.floor(Number(action.to));
      const n = rec.queue.length;
      if (![from, to].every((x) => Number.isFinite(x) && x > rec.queueIndex && x < n) || from === to) return { ok: true };
      const q = [...rec.queue];
      const [item] = q.splice(from, 1);
      q.splice(to, 0, item);
      rec.queue = q;
      bump(rec, true);
      return { ok: true };
    }
    case "queueClear": {
      rec.queue = rec.queue.filter((t, i) => i <= rec.queueIndex || t.tier !== "user");
      log(rec, now, by, "cleared the queue");
      bump(rec, true);
      return { ok: true, needsFill: needsFill(rec) };
    }
    case "setAutoplay": {
      rec.autoplay = !!action.on;
      if (!rec.autoplay) rec.queue = rec.queue.filter((t, i) => i <= rec.queueIndex || t.tier !== "autoplay");
      log(rec, now, by, rec.autoplay ? "turned AutoPlay on" : "turned AutoPlay off");
      bump(rec, true);
      return { ok: true, needsFill: needsFill(rec) };
    }
    case "setHostOnly": {
      rec.hostOnly = !!action.on;
      log(rec, now, by, rec.hostOnly ? "took over the controls" : "shared the controls");
      bump(rec);
      return { ok: true };
    }
    case "setCapacity": {
      const max = Math.floor(Number(action.max));
      if (!Number.isFinite(max)) return { ok: false, status: 400, error: "Bad size" };
      rec.maxMembers = Math.max(ROOM_LIMITS.minMembers, rec.members.length, Math.min(ROOM_LIMITS.maxMembers, max));
      bump(rec);
      return { ok: true };
    }
    case "kick": {
      if (action.memberId === member.id) return { ok: false, status: 400, error: "You can't remove yourself" };
      removeMember(rec, action.memberId, now, "removed");
      return { ok: true };
    }
    case "end": {
      rec.dead = true;
      return { ok: true };
    }
    default:
      return { ok: false, status: 400, error: "Unknown action" };
  }
}
