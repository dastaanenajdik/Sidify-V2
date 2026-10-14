"use client";

import { useMemo, useState } from "react";
import { Reorder, useDragControls } from "framer-motion";
import { GripVertical, Loader2, MoreHorizontal, X } from "lucide-react";
import type { Track } from "@/lib/types";
import { usePlayer, currentTrack, type QueueTier } from "@/store/player";
import { useUi } from "@/store/ui";
import { useSettings } from "@/store/settings";
import { clearUserQueue, jumpTo, moveInQueue, removeFromQueue, setAutoplay } from "@/lib/audioEngine";
import { useRoom } from "@/lib/rooms/client";
import { cx, formatTime } from "@/lib/format";
import { Artwork } from "../ui";
import { InfinityGlyph, PlayingBars } from "../icons";

type Variant = "player" | "panel";

interface Run {
  tier: QueueTier | "context";
  start: number; // absolute index of the first row
  items: Track[];
}

/**
 * The queue in its sections — Now Playing, Next in queue (what the listener
 * added), Next from <where it started>, and AutoPlay (similar music lined up
 * after all that). Rows drag to reorder within their section.
 */
export default function QueueList({ variant = "panel", className }: { variant?: Variant; className?: string }) {
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const tiers = usePlayer((s) => s.tiers);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const contextLabel = usePlayer((s) => s.contextLabel);
  const autoplayLoading = usePlayer((s) => s.autoplayLoading);
  const localAutoplay = useSettings((s) => s.autoplay);
  const room = useRoom((s) => s.room);
  const autoplay = room ? room.autoplay : localAutoplay;
  const cur = currentTrack({ queue, index });
  const onArt = variant === "player";

  const runs = useMemo(() => {
    const out: Run[] = [];
    for (let i = index + 1; i < queue.length; i++) {
      const t = queue[i];
      const tier: Run["tier"] = tiers[t.id] ?? "context";
      const last = out[out.length - 1];
      if (last && last.tier === tier) last.items.push(t);
      else out.push({ tier, start: i, items: [t] });
    }
    return out;
  }, [queue, index, tiers]);

  const hasAutoplayRun = runs.some((r) => r.tier === "autoplay");
  const from = room ? room.name : contextLabel && contextLabel !== "Single track" ? contextLabel : "";

  return (
    <div className={cx("pb-6", className)}>
      {cur && (
        <>
          <Heading onArt={onArt} title="Now Playing" />
          <Row track={cur} absIndex={index} current isPlaying={isPlaying} onArt={onArt} />
        </>
      )}

      {runs.map((run) => (
        <section key={`${run.tier}-${run.start}`}>
          {run.tier === "autoplay" ? (
            <AutoplayHeading onArt={onArt} on={autoplay} hasTracks />
          ) : (
            <Heading
              onArt={onArt}
              title={run.tier === "user" ? "Next in queue" : from ? `Next from ${from}` : "Up next"}
              trailing={
                run.tier === "user" ? (
                  <button
                    type="button"
                    onClick={() => clearUserQueue()}
                    className={cx("rounded-full px-2 py-1 text-[13px] font-semibold", onArt ? "text-white/75 hover:bg-white/10" : "text-fg-2 hover:bg-fill")}
                  >
                    Clear
                  </button>
                ) : null
              }
            />
          )}
          <Section run={run} onArt={onArt} />
        </section>
      ))}

      {!hasAutoplayRun && cur && (
        <>
          <AutoplayHeading onArt={onArt} on={autoplay} hasTracks={false} />
          {autoplay && autoplayLoading && (
            <div className={cx("flex items-center gap-2 px-2 py-3 text-[13px]", onArt ? "text-white/60" : "text-fg-2")}>
              <Loader2 size={14} className="animate-spin" /> Finding similar songs…
            </div>
          )}
        </>
      )}

      {!cur && (
        <p className={cx("px-2 py-10 text-center text-[14px]", onArt ? "text-white/60" : "text-fg-2")}>
          Nothing in the queue. Play something and it shows up here.
        </p>
      )}
    </div>
  );
}

function Heading({ title, trailing, onArt }: { title: string; trailing?: React.ReactNode; onArt: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 px-2 pt-5 pb-1.5">
      <h3 className={cx("min-w-0 truncate text-[15px] font-semibold", onArt ? "text-white/75" : "text-fg-2")}>{title}</h3>
      {trailing}
    </div>
  );
}

function AutoplayHeading({ on, hasTracks, onArt }: { on: boolean; hasTracks: boolean; onArt: boolean }) {
  return (
    <div className="flex items-center gap-3 px-2 pt-6 pb-2">
      <InfinityGlyph size={20} className={onArt ? "text-white/75" : "text-fg-2"} />
      <div className="min-w-0 flex-1">
        <div className={cx("text-[15px] font-semibold", onArt ? "text-white" : "text-fg")}>AutoPlay</div>
        <div className={cx("text-[13px] leading-snug", onArt ? "text-white/55" : "text-fg-2")}>
          {!on
            ? "Off — playback stops when the queue ends"
            : hasTracks
              ? "Similar music keeps playing after your queue"
              : "Similar music will play when your queue ends"}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="AutoPlay"
        onClick={() => setAutoplay(!on)}
        className={cx(
          "h-7 shrink-0 rounded-full px-3 text-[12px] font-bold transition-colors",
          on ? (onArt ? "bg-white text-black" : "bg-primary text-on-primary") : onArt ? "bg-white/15 text-white" : "bg-fill-2 text-fg"
        )}
      >
        {on ? "On" : "Off"}
      </button>
    </div>
  );
}

function Section({ run, onArt }: { run: Run; onArt: boolean }) {
  const ids = useMemo(() => run.items.map((t) => t.id), [run.items]);
  // Only set while a row is being dragged; otherwise the queue's own order rules.
  const [dragOrder, setDragOrder] = useState<string[] | null>(null);
  const order = dragOrder && dragOrder.length === ids.length && dragOrder.every((id) => ids.includes(id)) ? dragOrder : ids;
  const byId = useMemo(() => new Map(run.items.map((t) => [t.id, t])), [run.items]);

  const commit = (id: string) => {
    const to = run.start + order.indexOf(id);
    const from = usePlayer.getState().queue.findIndex((t) => t.id === id);
    setDragOrder(null);
    if (from >= 0 && to >= 0 && from !== to) moveInQueue(from, to);
  };

  return (
    <Reorder.Group axis="y" values={order} onReorder={setDragOrder} as="div">
      {order.map((id) => {
        const t = byId.get(id);
        if (!t) return null;
        return <DraggableRow key={id} id={id} track={t} absIndex={run.start + ids.indexOf(id)} onArt={onArt} onDrop={() => commit(id)} />;
      })}
    </Reorder.Group>
  );
}

function DraggableRow({
  id,
  track,
  absIndex,
  onArt,
  onDrop,
}: {
  id: string;
  track: Track;
  absIndex: number;
  onArt: boolean;
  onDrop: () => void;
}) {
  const controls = useDragControls();
  return (
    <Reorder.Item
      value={id}
      as="div"
      dragListener={false}
      dragControls={controls}
      onDragEnd={onDrop}
      whileDrag={{ scale: 1.02, zIndex: 10 }}
      className="relative"
    >
      <Row
        track={track}
        absIndex={absIndex}
        onArt={onArt}
        handle={
          <span
            onPointerDown={(e) => controls.start(e)}
            className={cx("grid h-8 w-6 shrink-0 cursor-grab touch-none place-items-center active:cursor-grabbing", onArt ? "text-white/40" : "text-fg-3")}
            aria-label="Drag to reorder"
          >
            <GripVertical size={16} />
          </span>
        }
      />
    </Reorder.Item>
  );
}

function Row({
  track,
  absIndex,
  current,
  isPlaying,
  onArt,
  handle,
}: {
  track: Track;
  absIndex: number;
  current?: boolean;
  isPlaying?: boolean;
  onArt: boolean;
  handle?: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "group/q flex h-[58px] items-center gap-3 rounded-[10px] px-2 transition-colors",
        onArt ? "hover:bg-white/8" : "hover:bg-fill",
        current && (onArt ? "bg-white/10" : "bg-fill")
      )}
      onContextMenu={(e) => {
        e.preventDefault();
        useUi.getState().openMenu({ track, x: e.clientX, y: e.clientY, queueIndex: current ? undefined : absIndex });
      }}
    >
      <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => !current && jumpTo(absIndex)}>
        <span className="relative shrink-0">
          <Artwork src={track.artwork} size={44} rounded="rounded-[6px]" className="h-11 w-11" />
          {current && (
            <span className="absolute inset-0 grid place-items-center rounded-[6px] bg-black/45 text-white">
              <PlayingBars paused={!isPlaying} size={12} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate text-[15px] leading-snug", onArt ? "text-white" : "text-fg")}>{track.title}</span>
          <span className={cx("block truncate text-[13px] leading-snug", onArt ? "text-white/55" : "text-fg-2")}>{track.artist}</span>
        </span>
      </button>
      <span className={cx("hidden w-10 shrink-0 text-right text-[12px] tabular-nums sm:block", onArt ? "text-white/45" : "text-fg-3")}>
        {track.durationMs ? formatTime(track.durationMs) : ""}
      </span>
      {!current && (
        <button
          type="button"
          aria-label="Remove from queue"
          onClick={() => removeFromQueue(absIndex)}
          className={cx(
            "grid h-8 w-8 shrink-0 place-items-center rounded-full opacity-100 transition-opacity desk:opacity-0 desk:group-hover/q:opacity-100",
            onArt ? "text-white/60 hover:bg-white/10 hover:text-white" : "text-fg-2 hover:bg-fill-2 hover:text-fg"
          )}
        >
          <X size={15} />
        </button>
      )}
      {current && (
        <button
          type="button"
          aria-label="More"
          onClick={(e) => useUi.getState().openMenu({ track, x: e.clientX, y: e.clientY })}
          className={cx("grid h-8 w-8 shrink-0 place-items-center rounded-full", onArt ? "text-white/70 hover:bg-white/10" : "text-fg-2 hover:bg-fill-2")}
        >
          <MoreHorizontal size={16} />
        </button>
      )}
      {handle}
    </div>
  );
}
