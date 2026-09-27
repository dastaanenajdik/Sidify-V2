"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  Disc3,
  Download,
  Heart,
  ListPlus,
  ListVideo,
  Mic2,
  Play,
  Plus,
  SkipForward,
} from "lucide-react";
import { useUi } from "@/store/ui";
import { usePlayer } from "@/store/player";
import { useLiked, useBlocked, downloadTrackFlow } from "@/lib/library";
import { addToQueueEnd, playNextInQueue, playTrackNow } from "@/lib/audioEngine";

const W = 252;

export default function TrackMenu() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  const router = useRouter();
  const { toggle } = useLiked();
  const { block } = useBlocked();
  const liked = usePlayer((s) => (menu ? !!s.likedIds[menu.track.id] : false));
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  useLayoutEffect(() => {
    if (!menu) return;
    const h = ref.current?.offsetHeight ?? 380;
    const x = Math.min(menu.x, window.innerWidth - W - 12);
    const y = menu.y + h > window.innerHeight ? Math.max(12, window.innerHeight - h - 12) : menu.y;
    setPos({ x, y });
  }, [menu]);

  if (!menu) return null;
  const t = menu.track;

  const items = [
    { icon: Play, label: "Play now", fn: () => playTrackNow(t) },
    { icon: SkipForward, label: "Play next", fn: () => { playNextInQueue(t); toast("Queued to play next"); } },
    { icon: ListVideo, label: "Add to queue", fn: () => { addToQueueEnd(t); toast("Added to queue"); } },
    { divider: true as const },
    {
      icon: Heart,
      label: liked ? "Remove from Liked Songs" : "Save to Liked Songs",
      accent: liked,
      fn: () => void toggle(t),
    },
    { icon: Download, label: "Download offline", fn: () => void downloadTrackFlow(t) },
    { icon: Plus, label: "Add to playlist", fn: () => useUi.getState().setAddToPlaylistTrack(t) },
    { divider: true as const },
    ...(t.albumId
      ? [{ icon: Disc3, label: "Go to album", fn: () => router.push(`/album/${t.albumId}`) }]
      : []),
    ...(t.artistId
      ? [{ icon: Mic2, label: "Go to artist", fn: () => router.push(`/artist/${t.artistId}`) }]
      : []),
    ...(t.artistId
      ? [
          {
            icon: Ban,
            label: "Don't play this artist",
            danger: true,
            fn: () => void block({ artistId: t.artistId!, name: t.artist }),
          },
        ]
      : []),
  ];

  function toast(title: string) {
    useUi.getState().pushToast({ title, kind: "ok" });
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[80]" onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }}>
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.92, y: -6 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={{ duration: 0.14 }}
          className="glass-strong absolute rounded-2xl p-1.5"
          style={{ left: pos.x, top: pos.y, width: W, boxShadow: "0 24px 60px -12px var(--shadow)" }}
        >
          <div className="mb-1 flex items-center gap-3 rounded-xl bg-[var(--panel)] p-2.5">
            <img src={t.artwork} alt="" className="h-10 w-10 rounded-lg object-cover" />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-semibold">{t.title}</div>
              <div className="text-muted truncate text-[11.5px]">{t.artist}</div>
            </div>
          </div>
          {items.map((it, i) =>
            "divider" in it && it.divider ? (
              <div key={i} className="mx-2 my-1 h-px bg-[var(--border-soft)]" />
            ) : (
              <button
                key={i}
                onClick={() => {
                  (it as { fn: () => void }).fn();
                  close();
                }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] transition-colors hover:bg-[var(--panel-strong)] ${
                  (it as { danger?: boolean }).danger
                    ? "text-red-400"
                    : (it as { accent?: boolean }).accent
                      ? "accent-text"
                      : "text-[var(--text)]"
                }`}
              >
                {(it as { icon: typeof Play }).icon && (
                  <span className="text-muted">
                    {(() => {
                      const Icon = (it as { icon: typeof Play }).icon;
                      return <Icon size={16} />;
                    })()}
                  </span>
                )}
                <span className="flex-1">{(it as { label: string }).label}</span>
                {(it as { label: string }).label === "Add to playlist" && <ListPlus size={14} className="text-muted-2" />}
              </button>
            )
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
