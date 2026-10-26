/**
 * "Is there actually sound?" — the rules behind the exclusive player's audio
 * watchdog.
 *
 * A browser can happily report `playing` while decoding video and no audio at
 * all. That is the classic "audio cuts out / video plays silently" report, and
 * it happens when:
 *
 *   - the manifest's default audio adaptation set is Dolby (EC-3/AC-3) and the
 *     platform cannot decode it,
 *   - the default audio track is a language the user did not pick,
 *   - a separate audio SourceBuffer failed while the video one recovered.
 *
 * Chromium exposes live decoder counters (`webkitAudioDecodedByteCount`,
 * `webkitVideoDecodedByteCount`). When they are available this module turns
 * them into a verdict, and the player reacts with a small, ordered recovery:
 * try another audio track → reload at the same position → stop and explain.
 *
 * Firefox/Safari do not expose those counters; there the verdict is `unknown`
 * and the player never pretends to know — it keeps playing and leaves the
 * audio-track picker in the user's hands.
 *
 * Pure functions only: no DOM, no imports. Covered by `tests/audioHealth.test.cjs`.
 */

export type AudioHealth = "ok" | "silent" | "pending" | "unknown";

export interface AudioSample {
  /** Seconds of playback observed since the sample window opened. */
  progress: number;
  /** Decoded audio bytes inside the window (delta, not a lifetime counter). */
  audioBytes?: number | null;
  /** Decoded video bytes inside the window. */
  videoBytes?: number | null;
  /** Rendered video frames inside the window. */
  frames?: number | null;
}

export interface AudioVerdictOptions {
  /** Playback time before a verdict may be reached. */
  minProgress?: number;
  /** Playback time a silent stream must sustain before it is called silent. */
  silentAfter?: number;
}

function isCount(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Classify one sample window.
 *
 * `ok`      audio bytes are being decoded.
 * `silent`  video is decoding but audio is not, long enough to be a real fault.
 * `pending` too early, or there is audio but not enough evidence yet.
 * `unknown` the browser does not expose decoder counters — never guess.
 */
export function audioHealthVerdict(sample: AudioSample, options: AudioVerdictOptions = {}): AudioHealth {
  const minProgress = options.minProgress ?? 0.9;
  const silentAfter = options.silentAfter ?? 2.5;
  const progress = Number.isFinite(sample.progress) ? Math.max(0, sample.progress) : 0;

  if (isCount(sample.audioBytes) && sample.audioBytes > 0) return "ok";
  if (!isCount(sample.audioBytes)) return "unknown";
  if (progress < minProgress) return "pending";

  const videoMoving = (isCount(sample.frames) && sample.frames > 0) || (isCount(sample.videoBytes) && sample.videoBytes > 0);
  if (progress >= silentAfter && videoMoving) return "silent";
  return "pending";
}

export type AudioRecoveryAction = "switch-track" | "reload" | "give-up";

/**
 * The ordered recovery for a silent stream.
 *
 * A different audio track fixes the common case (the default is a codec this
 * browser cannot decode). Reloading the same source fixes a dead audio
 * SourceBuffer. After both, the player stops guessing and tells the user,
 * offering the external-player hand-off instead.
 */
export function nextAudioRecovery(attempt: number): AudioRecoveryAction {
  if (!Number.isFinite(attempt) || attempt <= 0) return "switch-track";
  if (attempt === 1) return "reload";
  return "give-up";
}

/** A human label for an audio track, used by the picker and the warning copy. */
export function describeAudioTrack(track: {
  label?: string | null;
  language?: string | null;
  codec?: string | null;
  channelsCount?: number | null;
}): string {
  const parts: string[] = [];
  const label = track.label?.trim();
  const language = track.language?.trim();
  if (label) parts.push(label);
  else if (language && language !== "und") parts.push(language.toUpperCase());
  else parts.push("Default audio");

  const channels = track.channelsCount;
  if (channels === 1) parts.push("Mono");
  else if (channels === 2) parts.push("Stereo");
  else if (channels === 6) parts.push("5.1");
  else if (channels === 8) parts.push("7.1");
  else if (typeof channels === "number" && channels > 0) parts.push(`${channels}ch`);

  const codec = track.codec?.trim();
  if (codec) parts.push(codec.toUpperCase());
  return parts.join(" · ");
}

/**
 * The sentence shown under the player when audio needs attention.
 *
 * Deliberately explains *why* rather than saying "error": the usual cause is a
 * surround codec this browser cannot decode, and the fix is one tap away.
 */
export function audioDiagnosis(health: AudioHealth, audioTrackCount = 0): string | null {
  if (health === "ok") return null;
  if (health === "silent") {
    return audioTrackCount > 1
      ? "Picture is playing but this audio track is silent in your browser. Try another audio track below — surround (Dolby) tracks are the usual cause."
      : "Picture is playing but this browser is not decoding the audio track. Open the title page and use Download or an external player if the sound stays off.";
  }
  if (health === "unknown" && audioTrackCount === 0) {
    return "This stream exposes no separate audio track. If you hear nothing, open the title page for other qualities.";
  }
  return null;
}
