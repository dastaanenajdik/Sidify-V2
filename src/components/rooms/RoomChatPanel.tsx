"use client";

import { useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, LoaderCircle, MessageCircle, Send, Smile } from "lucide-react";
import { sendRoomChat, useRoom } from "@/lib/rooms/client";
import { ROOM_LIMITS, type RoomChatMessage, type RoomState } from "@/lib/rooms/logic";
import { cx } from "@/lib/format";
import { IconButton } from "@/components/ui";

function createMessageId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (digit) => {
    const random = Math.random() * 16 | 0;
    return (digit === "x" ? random : (random & 0x3) | 0x8).toString(16);
  });
}

const ROOM_EMOJIS = [
  "😀", "😂", "🥹", "😍", "😎", "🤔", "😭",
  "🙌", "👏", "🫶", "❤️", "🔥", "✨", "🎵",
  "🎧", "🎤", "🎉", "💯", "👍", "👎", "🤘",
];

export default function RoomChatPanel({
  room,
  you,
  className,
  feedClassName,
  showHeader = true,
  glass = true,
}: {
  room: RoomState;
  you: string;
  className?: string;
  feedClassName?: string;
  showHeader?: boolean;
  glass?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [pendingMessage, setPendingMessage] = useState<RoomChatMessage | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const caretRef = useRef({ start: 0, end: 0 });
  const feedRef = useRef<HTMLDivElement>(null);
  const initialScrollDone = useRef(false);
  const entries = useMemo(() => {
    const events = room.activity.map((event, i) => ({ kind: "activity" as const, key: `activity-${event.at}-${i}`, at: event.at, event }));
    const storedMessages = room.chat ?? [];
    const messages = storedMessages.map((message) => ({ kind: "chat" as const, key: `chat-${message.id}`, at: message.at, message, delivery: "sent" as const }));
    const pending = pendingMessage && !storedMessages.some((message) => message.id === pendingMessage.id)
      ? [{ kind: "chat" as const, key: `chat-${pendingMessage.id}`, at: pendingMessage.at, message: pendingMessage, delivery: "sending" as const }]
      : [];
    return [...events, ...messages, ...pending].sort((a, b) => a.at - b.at).slice(-60);
  }, [room.activity, room.chat, pendingMessage]);

  // Scroll only the feed, never the page. scrollIntoView() can move the whole
  // app's page when the chat changes, especially after Enter submits a message.
  useLayoutEffect(() => {
    const feed = feedRef.current;
    if (!feed) return;
    if (!initialScrollDone.current) {
      // Opening the panel (or refreshing) should always start at the newest message.
      feed.scrollTop = feed.scrollHeight;
      initialScrollDone.current = true;
      return;
    }
    const distanceFromBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    if (distanceFromBottom < 100) feed.scrollTo({ top: feed.scrollHeight, behavior: "smooth" });
  }, [room.seq, pendingMessage?.id]);

  function insertEmoji(emoji: string) {
    const start = inputRef.current?.selectionStart ?? caretRef.current.start;
    const end = inputRef.current?.selectionEnd ?? caretRef.current.end;
    const next = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`;
    if (next.length > ROOM_LIMITS.chatMessageLength) return;
    setDraft(next);
    setEmojiOpen(false);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const caret = start + emoji.length;
      input.setSelectionRange(caret, caret);
      caretRef.current = { start: caret, end: caret };
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmojiOpen(false);
    const text = draft.trim();
    if (!text || sending) return;
    const id = createMessageId();
    setPendingMessage({ id, at: Date.now(), memberId: you, by: "", text });
    setDraft("");
    setSending(true);
    const sent = await sendRoomChat(text, id);
    const acknowledged = (useRoom.getState().room?.chat ?? []).some((message) => message.id === id);
    setSending(false);
    setPendingMessage((current) => current?.id === id ? null : current);
    if (!sent && !acknowledged) setDraft((current) => current || text);
  }

  return (
    <section aria-label="Room chat and activity" className={cx(
      "relative flex min-h-0 flex-col overflow-hidden rounded-[18px] text-fg",
      glass ? "bar-glass shadow-[0_18px_55px_rgba(0,0,0,.24)] ring-1 ring-edge" : "bg-transparent shadow-none ring-0",
      className
    )}>
      {showHeader && (
        <div className="relative z-[1] flex shrink-0 items-center gap-2 border-b border-edge px-3.5 py-3">
          <MessageCircle size={17} className="text-accent" aria-hidden="true" />
          <h2 className="flex-1 text-[14px] font-semibold">Chat &amp; activity</h2>
          <span className="text-[11px] text-fg-2">Room members only</span>
        </div>
      )}
      <div
        ref={feedRef}
        className={cx("relative z-[1] min-h-0 space-y-2 overflow-y-auto overscroll-contain px-3.5 py-3 text-fg", feedClassName)}
        aria-live="polite"
        aria-relevant="additions text"
      >
        {entries.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-fg-2">Say hello — everyone in the room will see it.</p>
        ) : (
          entries.map((entry) => {
            const time = new Date(entry.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
            if (entry.kind === "activity") {
              return (
                <div key={entry.key} className="flex gap-2 text-[12px] leading-5">
                  <span className="shrink-0 text-fg-2 tabular-nums">{time}</span>
                  <p className="min-w-0 text-fg-2"><span className="font-semibold text-fg">{entry.event.by}</span> {entry.event.text}</p>
                </div>
              );
            }
            const mine = entry.message.memberId === you;
            return (
              <div key={entry.key} className={cx("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cx(
                  "max-w-[90%] rounded-[14px] px-3 py-2 backdrop-blur-md ring-1",
                  mine ? "bg-accent/15 ring-accent/15" : "bg-fill ring-edge"
                )}>
                  <div className="mb-0.5 flex items-baseline gap-2">
                    <span className="truncate text-[11px] font-semibold text-fg">{mine ? "You" : entry.message.by}</span>
                    <time className="shrink-0 text-[10px] text-fg-2">{time}</time>
                    {entry.delivery === "sending" ? (
                      <span className="inline-flex shrink-0 items-center gap-1 text-[10px] text-fg-2"><LoaderCircle size={11} className="animate-spin" /> Sending…</span>
                    ) : mine ? (
                      <Check size={12} className="shrink-0 text-playing" aria-label="Sent" />
                    ) : null}
                  </div>
                  <p className="break-words text-[13px] leading-[1.45] text-fg">{entry.message.text}</p>
                </div>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={submit} className="relative z-[1] flex shrink-0 items-center gap-2 border-t border-edge p-2.5">
        {emojiOpen && (
          <div
            role="dialog"
            aria-label="Choose an emoji"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setEmojiOpen(false);
              }
            }}
            className="menu-glass absolute right-2 bottom-[calc(100%+10px)] z-30 w-[232px] rounded-[18px] p-2.5"
          >
            <p className="mb-2 px-1 text-[11px] font-semibold tracking-wide text-fg-2">Emoji</p>
            <div className="grid grid-cols-7 gap-1" role="group" aria-label="Emoji choices">
              {ROOM_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  aria-label={`Insert ${emoji}`}
                  onClick={() => insertEmoji(emoji)}
                  className="grid h-7 w-7 place-items-center rounded-[9px] text-[18px] transition-colors hover:bg-fill-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-fg"
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        )}
        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value.slice(0, ROOM_LIMITS.chatMessageLength));
            caretRef.current = { start: event.target.selectionStart ?? 0, end: event.target.selectionEnd ?? 0 };
          }}
          onSelect={(event) => {
            caretRef.current = { start: event.currentTarget.selectionStart ?? 0, end: event.currentTarget.selectionEnd ?? 0 };
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault();
          }}
          maxLength={ROOM_LIMITS.chatMessageLength}
          placeholder="Write a message…"
          aria-label="Write a room message"
          className="field h-10 min-w-0 flex-1 !rounded-full !bg-fill backdrop-blur-md text-[13px]"
        />
        <IconButton
          label={emojiOpen ? "Close emoji picker" : "Choose an emoji"}
          type="button"
          tone="glass"
          size={38}
          active={emojiOpen}
          aria-expanded={emojiOpen}
          aria-haspopup="dialog"
          onClick={() => setEmojiOpen((open) => !open)}
        >
          <Smile size={18} />
        </IconButton>
        <IconButton label={sending ? "Sending message" : "Send message"} type="submit" tone="glass" size={38} disabled={!draft.trim() || sending}>
          {sending ? <LoaderCircle size={17} className="animate-spin" /> : <Send size={16} />}
        </IconButton>
      </form>
    </section>
  );
}
