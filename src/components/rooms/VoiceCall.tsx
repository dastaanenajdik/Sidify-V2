"use client";

import { useEffect } from "react";
import { Loader2, Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useRoom } from "@/lib/rooms/client";
import {
  acceptCall,
  cancelRinging,
  clearStaleVoicePresence,
  declineCall,
  endCall,
  markRinging,
  mountVoiceEngine,
  resetVoiceCall,
  startCall,
  toggleMic,
  useVoice,
} from "@/lib/rooms/voice";
import { decideVoicePresenceAction, type RoomState } from "@/lib/rooms/logic";
import { useUi } from "@/store/ui";
import { cx } from "@/lib/format";

/**
 * Drives the 1:1 voice call from room presence (room.voiceCall) and renders
 * the call bar under the room hero. Signaling rides the room poll, so this
 * only reacts to state — it never opens a connection of its own.
 */
export function VoiceCallController({ room, you }: { room: RoomState; you: string }) {
  const status = useVoice((s) => s.status);
  const peerId = useVoice((s) => s.peerId);
  const session = useRoom((s) => s.session);

  // Connect the room poll's signal delivery to the WebRTC engine.
  useEffect(() => mountVoiceEngine(), []);

  // Leaving the room (or being removed) tears the call down locally.
  useEffect(() => {
    if (!session) resetVoiceCall();
  }, [session]);

  useEffect(() => {
    const voiceCall = room.voiceCall ?? [];
    const action = decideVoicePresenceAction({
      status,
      peerId,
      you,
      members: room.members,
      voiceCall,
    });
    switch (action) {
      case "clear-stale":
        // Reload recovery: our seat is still listed server-side with a fresh engine.
        void clearStaleVoicePresence();
        break;
      case "ring": {
        // Incoming call: another seat's voice presence appeared while we are idle.
        const caller = room.members.find((m) => m.id !== you && voiceCall.includes(m.id));
        if (caller) markRinging(caller.id, caller.name);
        break;
      }
      case "cancel-ring":
        // They cancelled before we answered.
        cancelRinging();
        break;
      case "end-left-room":
      case "end-left-call":
        // Backstop for a missed bye: the peer's seat or voice presence vanished.
        resetVoiceCall();
        useUi.getState().pushToast({
          title: "Call ended",
          desc: action === "end-left-room" ? "The other listener left the room" : "The other listener left the call",
          kind: "info",
        });
        break;
      case "none":
        break;
    }
  }, [room.voiceCall, room.members, status, you, peerId]);

  const other = room.members.find((m) => m.id !== you) ?? null;

  return (
    <section aria-label="Voice call" className="overflow-hidden rounded-[18px] bg-raised ring-1 ring-edge">
      {status === "idle" && (
        <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand/15 text-brand">
            <Phone size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold">Voice call</p>
            <p className="truncate text-[12px] text-fg-2">
              {other ? `Talk with ${other.name} — music dips automatically while you chat` : "Waiting for someone to join the room"}
            </p>
          </div>
          <button
            type="button"
            disabled={!other}
            onClick={() => other && void startCall(other.id, other.name)}
            className="inline-flex h-10 shrink-0 items-center gap-2 rounded-full bg-[#1faf55] px-4 text-[13.5px] font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Phone size={16} /> Start call
          </button>
        </div>
      )}

      {status === "ringing" && <RingingBar />}
      {(status === "requesting" || status === "connecting") && <PendingBar connecting={status === "connecting"} />}
      {status === "live" && <LiveBar />}
    </section>
  );
}

function RingingBar() {
  const peerName = useVoice((s) => s.peerName);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
      <span className="relative grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#1faf55]/15 text-[#1faf55]">
        <Phone size={18} />
        <span className="absolute -top-0.5 -right-0.5 h-3 w-3 animate-ping rounded-full bg-[#1faf55]/70" />
        <span className="absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#1faf55]" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">{peerName ?? "Someone"} is calling…</p>
        <p className="text-[12px] text-fg-2">Your mic stays off until you accept</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => void declineCall()}
          aria-label="Decline call"
          className="grid h-11 w-11 place-items-center rounded-full bg-[#e5484d] text-white transition-transform hover:scale-105 active:scale-95"
        >
          <PhoneOff size={18} />
        </button>
        <button
          type="button"
          onClick={() => void acceptCall()}
          aria-label="Accept call"
          className="grid h-11 w-11 place-items-center rounded-full bg-[#1faf55] text-white transition-transform hover:scale-105 active:scale-95"
        >
          <Phone size={18} />
        </button>
      </div>
    </div>
  );
}

function PendingBar({ connecting }: { connecting: boolean }) {
  const peerName = useVoice((s) => s.peerName);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-fill text-fg-2">
        <Loader2 size={18} className="animate-spin" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] font-semibold">{connecting ? `Connecting with ${peerName ?? ""}…` : `Ringing ${peerName ?? ""}…`}</p>
        <p className="text-[12px] text-fg-2">{connecting ? "Exchanging secure audio" : "Free peer-to-peer voice · no call charges"}</p>
      </div>
      <button
        type="button"
        onClick={() => void endCall()}
        aria-label="Cancel call"
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#e5484d] text-white transition-transform hover:scale-105 active:scale-95"
      >
        <PhoneOff size={18} />
      </button>
    </div>
  );
}

function LiveBar() {
  const peerName = useVoice((s) => s.peerName);
  const micOn = useVoice((s) => s.micOn);
  const speaking = useVoice((s) => s.speaking);
  const peerSpeaking = useVoice((s) => s.peerSpeaking);
  const reconnecting = useVoice((s) => s.reconnecting);
  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3.5">
      <span className={cx(
        "relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-white transition-colors",
        peerSpeaking ? "bg-[#1faf55]" : "bg-fill-3"
      )}>
        <Phone size={17} />
        {peerSpeaking && <span className="absolute inset-0 animate-ping rounded-full bg-[#1faf55]/50" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-[14px] font-semibold">
          <span className="h-2 w-2 shrink-0 rounded-full bg-[#1faf55]" />
          <span className="truncate">{peerName ?? "Voice call"}</span>
          {reconnecting && <span className="shrink-0 text-[11px] font-medium text-[#e5a148]">Reconnecting…</span>}
        </p>
        <p className="truncate text-[12px] text-fg-2">
          {speaking ? "Speaking · music lowered" : peerSpeaking ? `${peerName ?? "They"} is speaking` : "Connected · HD voice · music lowered"}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => toggleMic()}
          aria-label={micOn ? "Mute microphone" : "Unmute microphone"}
          aria-pressed={!micOn}
          className={cx(
            "grid h-11 w-11 place-items-center rounded-full transition-transform hover:scale-105 active:scale-95",
            micOn ? "bg-fill text-fg hover:bg-fill-2" : "bg-[#e5484d] text-white"
          )}
        >
          {micOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button
          type="button"
          onClick={() => void endCall()}
          aria-label="End call"
          className="grid h-11 w-11 place-items-center rounded-full bg-[#e5484d] text-white transition-transform hover:scale-105 active:scale-95"
        >
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}

/** Small phone glyph with a talking pulse, used in the room's People list. */
export function VoicePresenceBadge({ memberId }: { memberId: string }) {
  const room = useRoom((s) => s.room);
  const session = useRoom((s) => s.session);
  const status = useVoice((s) => s.status);
  const peerId = useVoice((s) => s.peerId);
  const speaking = useVoice((s) => s.speaking);
  const peerSpeaking = useVoice((s) => s.peerSpeaking);
  if (!room || !(room.voiceCall ?? []).includes(memberId)) return null;
  const isMe = session?.memberId === memberId;
  const talking = isMe ? speaking : memberId === peerId && status === "live" && peerSpeaking;
  return (
    <span
      aria-label={talking ? "Speaking now" : "In voice call"}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold",
        talking ? "bg-[#1faf55]/15 text-[#1faf55]" : "bg-fill text-fg-2"
      )}
    >
      <span className={cx("h-1.5 w-1.5 rounded-full", talking ? "animate-pulse bg-[#1faf55]" : "bg-fg-2")} />
      <Phone size={11} />
      Voice
    </span>
  );
}
