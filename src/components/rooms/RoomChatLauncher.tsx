"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { MessageCircle, X } from "lucide-react";
import RoomChatPanel from "./RoomChatPanel";
import { useRoom } from "@/lib/rooms/client";

/** An always-available room chat button, shown across the app while in a room. */
export default function RoomChatLauncher() {
  const [open, setOpen] = useState(false);
  const session = useRoom((s) => s.session);
  const room = useRoom((s) => s.room);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!session || !room || room.code !== session.code) return null;

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.section
            role="dialog"
            aria-label={`Chat in ${room.name}`}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 360, damping: 30 }}
            className="fixed inset-x-3 bottom-[calc(222px+env(safe-area-inset-bottom,0px))] z-[60] mx-auto h-[min(58dvh,560px)] max-h-[calc(100dvh-260px-env(safe-area-inset-bottom,0px))] w-auto max-w-[420px] origin-bottom-right desk:inset-x-auto desk:right-6 desk:bottom-20 desk:h-[min(70vh,600px)] desk:max-h-[calc(100dvh-110px)] desk:w-[min(calc(100vw-48px),420px)]"
          >
            <div className="bar-glass flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] shadow-[0_22px_70px_rgba(0,0,0,.38)] ring-1 ring-white/15">
              <header className="relative z-[1] flex shrink-0 items-center gap-3 border-b border-white/10 px-4 py-3.5">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand/15 text-brand">
                  <MessageCircle size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">Room chat</span>
                  <span className="block truncate text-[11px] text-fg-2">{room.name} · {room.members.length} listening</span>
                </span>
                <button
                  type="button"
                  aria-label="Close room chat"
                  onClick={() => setOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-full text-fg-2 transition-colors hover:bg-fill hover:text-fg"
                >
                  <X size={17} />
                </button>
              </header>
              <RoomChatPanel
                room={room}
                you={session.memberId}
                showHeader={false}
                className="relative z-[1] flex-1 rounded-none bg-transparent shadow-none ring-0"
                feedClassName="flex-1"
                glass={false}
              />
            </div>
          </motion.section>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        aria-label={open ? "Close room chat" : "Open room chat"}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: "spring", stiffness: 420, damping: 26 }}
        className="fixed right-4 bottom-[calc(146px+env(safe-area-inset-bottom,0px))] z-[61] inline-flex h-12 items-center gap-2 rounded-full bg-brand px-4 text-white shadow-[0_8px_28px_rgba(0,0,0,.28)] ring-1 ring-white/15 transition-colors hover:brightness-110 desk:bottom-4"
      >
        <MessageCircle size={19} />
        <span className="text-[13px] font-semibold">Chat</span>
        <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white/20 px-1 text-[10px] font-bold tabular-nums">
          {room.members.length}
        </span>
      </motion.button>
    </>
  );
}
