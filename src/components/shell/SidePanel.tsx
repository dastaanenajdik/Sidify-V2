"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useUi } from "@/store/ui";
import { usePlayer, currentTrack } from "@/store/player";
import { useSettings } from "@/store/settings";
import MeshBackdrop from "../MeshBackdrop";
import LyricsPane from "../player/LyricsPane";
import QueueList from "../player/QueueList";
import { IconButton } from "../ui";

/**
 * The column beside the page on desktop (Apple Music's right-hand sidebar):
 * lyrics or the queue, while the page stays usable next to it.
 */
export default function SidePanel() {
  const panel = useUi((s) => s.sidePanel);
  const track = usePlayer((s) => currentTrack(s));
  const dynamic = useSettings((s) => s.dynamicColor);

  return (
    <AnimatePresence initial={false}>
      {panel && (
        <motion.aside
          key="side"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 360, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.26, ease: [0.4, 0, 0.2, 1] }}
          className="relative hidden h-full shrink-0 overflow-hidden shadow-[inset_0.5px_0_0_var(--hairline)] desk:block"
          aria-label={panel === "lyrics" ? "Lyrics" : "Queue"}
        >
          <div className="absolute inset-y-0 left-0 flex w-[360px] flex-col">
            {panel === "lyrics" && track && dynamic ? (
              <div className="absolute inset-0 opacity-90">
                <MeshBackdrop artwork={track.artwork} driftKey={track.id} blur={48} />
              </div>
            ) : (
              <div className="chrome-glass absolute inset-0" />
            )}
            <div className="relative flex h-[46px] shrink-0 items-center pr-2 pl-[18px]">
              <span className={panel === "lyrics" && dynamic ? "flex-1 text-[15px] font-semibold text-white" : "flex-1 text-[15px] font-semibold"}>
                {panel === "lyrics" ? "Lyrics" : "Queue"}
              </span>
              <IconButton
                label="Close"
                size={28}
                onClick={() => useUi.getState().setSidePanel(null)}
                className={panel === "lyrics" && dynamic ? "text-white/70 hover:bg-white/10" : "text-fg-2"}
              >
                <X size={16} />
              </IconButton>
            </div>
            <div className="relative flex min-h-0 flex-1 flex-col px-[14px] pb-[14px]">
              {panel === "lyrics" ? (
                track ? (
                  <LyricsPane key={track.id} track={track} variant={dynamic ? "player" : "panel"} dense className="min-h-0 flex-1 px-1" />
                ) : (
                  <p className="px-2 py-10 text-center text-[14px] text-fg-2">Play a song to see its lyrics here.</p>
                )
              ) : (
                <div className="no-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto">
                  <QueueList variant="panel" />
                </div>
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
