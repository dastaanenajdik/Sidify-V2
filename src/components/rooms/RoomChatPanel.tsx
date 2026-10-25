"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MessageCircle, Send } from "lucide-react";
import { sendRoomChat } from "@/lib/rooms/client";
import { ROOM_LIMITS, type RoomState } from "@/lib/rooms/logic";
import { cx } from "@/lib/format";
import { IconButton } from "@/components/ui";

export default function RoomChatPanel({
  room,
  you,
  className,
  feedClassName,
  showHeader = true,
}: {
  room: RoomState;
  you: string;
  className?: string;
  feedClassName?: string;
  showHeader?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const feedRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => {
    const events = room.activity.map((event, i) => ({ kind: "activity" as const, key: `activity-${event.at}-${i}`, at: event.at, event }));
    const messages = (room.chat ?? []).map((message) => ({ kind: "chat" as const, key: `chat-${message.id}`, at: message.at, message }));
    return [...events, ...messages].sort((a, b) => a.at - b.at).slice(-60);
  }, [room.activity, room.chat]);

  // Scroll only the feed, never the page. scrollIntoView() can move the whole
  // app's page when the chat changes, especially after Enter submits a message.
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    const distanceFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    if (distanceFromBottom < 100) feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
  }, [room.seq]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    const sent = await sendRoomChat(text);
    setSending(false);
    if (sent) setDraft("");
  }

  return (
    <section aria-label="Room chat and activity" className={cx("flex min-h-0 flex-col overflow-hidden rounded-[14px] bg-raised ring-1 ring-edge", className)}>
      {showHeader && (
        <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3.5 py-3">
          <MessageCircle size={17} className="text-accent" aria-hidden="true" />
          <h2 className="flex-1 text-[14px] font-semibold">Chat &amp; activity</h2>
          <span className="text-[11px] text-fg-3">Room members only</span>
        </div>
      )}
      <div
        ref={feedRef}
        className={cx("min-h-0 space-y-2 overflow-y-auto overscroll-contain px-3.5 py-3", feedClassName)}
        aria-live="polite"
        aria-relevant="additions text"
      >
        {entries.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-fg-3">Say hello — everyone in the room will see it.</p>
        ) : (
          entries.map((entry) => {
            const time = new Date(entry.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            if (entry.kind === "activity") {
              return (
                <div key={entry.key} className="flex gap-2 text-[12px] leading-5">
                  <span className="shrink-0 text-fg-3 tabular-nums">{time}</span>
                  <p className="min-w-0 text-fg-2"><span className="font-semibold text-fg">{entry.event.by}</span> {entry.event.text}</p>
                </div>
              );
            }
            const mine = entry.message.memberId === you;
            return (
              <div key={entry.key} className={cx("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cx("max-w-[90%] rounded-[12px] px-3 py-2", mine ? "bg-accent/15" : "bg-fill")}>
                  <div className="mb-0.5 flex items-baseline gap-2">
                    <span className="truncate text-[11px] font-semibold text-fg">{mine ? "You" : entry.message.by}</span>
                    <time className="shrink-0 text-[10px] text-fg-3">{time}</time>
                  </div>
                  <p className="break-words text-[13px] leading-[1.45] text-fg">{entry.message.text}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={submit} className="flex shrink-0 items-center gap-2 border-t border-edge p-2.5">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.slice(0, ROOM_LIMITS.chatMessageLength))}
          maxLength={ROOM_LIMITS.chatMessageLength}
          placeholder="Write a message…"
          aria-label="Write a room message"
          className="field h-10 min-w-0 flex-1 !rounded-[11px] text-[13px]"
        />
        <IconButton label="Send message" type="submit" tone="fill" size={38} disabled={!draft.trim() || sending}>
          <Send size={16} />
        </IconButton>
      </form>
    </section>
  );
}
