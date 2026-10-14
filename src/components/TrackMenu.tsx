"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  Ban,
  Disc3,
  Download,
  Heart,
  Link2,
  ListEnd,
  ListPlus,
  ListStart,
  Mic2,
  Radio,
  Trash2,
  UserRound,
} from "lucide-react";
import { useUi } from "@/store/ui";
import { usePlayer, currentTrack } from "@/store/player";
import { addToQueueEnd, playNextInQueue, removeFromQueue, startRadio } from "@/lib/audioEngine";
import { downloadTrackFlow, useBlocked, useLiked } from "@/lib/library";
import { copyText } from "@/lib/clipboard";
import { useRoom } from "@/lib/rooms/client";
import { cx } from "@/lib/format";
import { Artwork } from "./ui";

/**
 * The "…" menu for a song. A popover next to the pointer on wide screens, a
 * bottom sheet on phones.
 */
export default function TrackMenu() {
  const menu = useUi((s) => s.menu);
  const close = useUi((s) => s.closeMenu);
  const router = useRouter();
  const { toggle } = useLiked();
  const { block } = useBlocked();
  const inRoom = useRoom((s) => !!s.session);
  const liked = usePlayer((s) => !!(menu && s.likedIds[menu.track.id]));
  const isCurrent = usePlayer((s) => !!menu && currentTrack(s)?.id === menu.track.id);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onScroll = () => close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onScroll);
    };
  }, [menu, close]);

  const t = menu?.track;
  const go = (href: string) => {
    close();
    usePlayer.getState().set({ fullPlayerOpen: false });
    router.push(href);
  };

  type Item = { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; hidden?: boolean };
  const groups: Item[][] = t
    ? ([
        [
          {
            icon: <ListStart size={18} />,
            label: inRoom ? "Play next in room" : "Play next",
            hidden: isCurrent,
            onClick: () => {
              playNextInQueue(t);
              if (!inRoom) useUi.getState().pushToast({ title: "Playing next", desc: t.title, kind: "ok" });
            },
          },
          {
            icon: <ListEnd size={18} />,
            label: inRoom ? "Add to room queue" : "Add to queue",
            hidden: isCurrent,
            onClick: () => {
              addToQueueEnd(t);
              if (!inRoom) useUi.getState().pushToast({ title: "Added to queue", desc: t.title, kind: "ok" });
            },
          },
          { icon: <Radio size={18} />, label: "Start radio", onClick: () => void startRadio(t) },
          {
            icon: <Trash2 size={18} />,
            label: "Remove from queue",
            hidden: menu?.queueIndex === undefined,
            onClick: () => menu?.queueIndex !== undefined && removeFromQueue(menu.queueIndex),
          },
        ],
        [
          { icon: <ListPlus size={18} />, label: "Add to playlist…", onClick: () => useUi.getState().setAddToPlaylistTrack(t) },
          {
            icon: <Heart size={18} fill={liked ? "currentColor" : "none"} />,
            label: liked ? "Remove from Liked Songs" : "Love",
            onClick: () => void toggle(t),
          },
          { icon: <Download size={18} />, label: "Download", onClick: () => void downloadTrackFlow(t) },
        ],
        [
          {
            icon: <Mic2 size={18} />,
            label: "Lyrics",
            hidden: !isCurrent,
            onClick: () => usePlayer.getState().set({ fullPlayerOpen: true, npView: "lyrics" }),
          },
          {
            icon: <UserRound size={18} />,
            label: "Go to artist",
            hidden: !t.artistId,
            onClick: () => go(`/artist/${encodeURIComponent(t.artistId!)}`),
          },
          {
            icon: <Disc3 size={18} />,
            label: "Go to album",
            hidden: !t.albumId,
            onClick: () => go(`/album/${encodeURIComponent(t.albumId!)}`),
          },
          {
            icon: <Link2 size={18} />,
            label: "Copy song link",
            hidden: !t.videoId,
            onClick: async () => {
              try {
                await copyText(`https://music.youtube.com/watch?v=${t.videoId}`);
                useUi.getState().pushToast({ title: "Link copied", desc: t.title, kind: "ok" });
              } catch {
                useUi.getState().pushToast({ title: "Couldn't copy the link", kind: "warn" });
              }
            },
          },
        ],
        [
          {
            icon: <Ban size={18} />,
            label: "Don't play this artist",
            hidden: !t.artistId,
            danger: true,
            onClick: () => t.artistId && void block({ artistId: t.artistId, name: t.artist }),
          },
        ],
      ] as Item[][]).map((g) => g.filter((i) => !i.hidden)).filter((g) => g.length)
    : [];

  // The menu only ever renders after a click, so the window is there to measure.
  const phone = typeof window !== "undefined" && window.innerWidth < 640;
  const items = groups.reduce((a, g) => a + g.length, 0);
  const estHeight = 72 + groups.length * 9 + items * 40;
  const pos =
    menu && typeof window !== "undefined"
      ? {
          left: Math.max(8, Math.min(menu.x, window.innerWidth - 264 - 8)),
          top: Math.max(8, Math.min(menu.y, window.innerHeight - estHeight - 8)),
        }
      : { left: 0, top: 0 };

  const body = t && (
    <>
      <div className="flex items-center gap-3 px-3 pt-3 pb-2.5">
        <Artwork src={t.artwork} size={44} rounded="rounded-[6px]" className="h-11 w-11" />
        <div className="min-w-0">
          <div className="truncate text-[14.5px] font-semibold">{t.title}</div>
          <div className="truncate text-[12.5px] text-fg-2">{t.artist}</div>
        </div>
      </div>
      {groups.map((g, gi) => (
        <div key={gi} className="hairline-t py-1">
          {g.map((item) => (
            <button
              key={item.label}
              type="button"
              onClick={() => {
                close();
                item.onClick();
              }}
              className={cx(
                "flex h-10 w-full items-center gap-3 px-3.5 text-left text-[14px] transition-colors hover:bg-fill-2",
                item.danger ? "text-danger" : "text-fg"
              )}
            >
              <span className={item.danger ? "" : "text-fg-2"}>{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </div>
      ))}
    </>
  );

  return (
    <AnimatePresence>
      {menu && (
        <motion.div className="fixed inset-0 z-[140]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
          <div className={cx("absolute inset-0", phone ? "bg-black/50" : "")} onClick={close} onContextMenu={(e) => (e.preventDefault(), close())} />
          {phone ? (
            <motion.div
              initial={{ y: 60 }}
              animate={{ y: 0 }}
              exit={{ y: 80 }}
              transition={{ type: "spring", damping: 32, stiffness: 380 }}
              className="menu-glass absolute inset-x-2 bottom-2 max-h-[80dvh] overflow-y-auto rounded-[20px] pb-safe"
            >
              {body}
            </motion.div>
          ) : (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.12 }}
              className="menu-glass absolute w-[264px] origin-top-left overflow-hidden rounded-[14px]"
              style={{ left: pos.left, top: pos.top }}
            >
              {body}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
