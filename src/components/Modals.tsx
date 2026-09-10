"use client";

import { useState } from "react";
import { Check, ListMusic, Moon, Plus, TimerOff } from "lucide-react";
import { Modal } from "./controls";
import { useUi } from "@/store/ui";
import { usePlayer } from "@/store/player";
import { usePlaylists } from "@/lib/library";
import { clearSleepTimer, setSleepTimer } from "@/lib/audioEngine";
import { cx } from "@/lib/format";

/* --------------------------- Add to playlist ----------------------------- */
export function GlobalModals() {
  return (
    <>
      <AddToPlaylistModal />
      <SleepTimerModal />
    </>
  );
}

function AddToPlaylistModal() {
  const track = useUi((s) => s.addToPlaylistTrack);
  const close = () => useUi.getState().setAddToPlaylistTrack(null);
  const { data, addTrack, create } = usePlaylists();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  return (
    <Modal open={!!track} onClose={close} title="Add to playlist">
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {data?.playlists.length === 0 && !creating && (
          <p className="text-muted py-6 text-center text-sm">No playlists yet — create your first one.</p>
        )}
        {data?.playlists.map((p) => (
          <button
            key={p.id}
            onClick={async () => {
              if (track) await addTrack(p.id, track);
              close();
            }}
            className="hover-panel flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left"
          >
            <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--panel-strong)]">
              <ListMusic size={17} className="text-muted" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[14px] font-medium">{p.name}</span>
              <span className="text-muted-2 text-[12px]">{p.tracks.length} songs</span>
            </span>
          </button>
        ))}
      </div>
      {creating ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!name.trim()) return;
            const trimmed = name.trim();
            await create(trimmed);
            const latest = await usePlaylistsRefetch();
            const target = latest?.playlists.find((p) => p.name === trimmed);
            if (track && target) await addTrack(target.id, track);
            close();
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Playlist name"
            className="glass min-w-0 flex-1 rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-2"
          />
          <button type="submit" className="rounded-xl accent-bg px-4 text-sm font-semibold text-black">
            Save
          </button>
        </form>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="hover-panel mt-2 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[14px] font-medium"
        >
          <span className="grid h-10 w-10 place-items-center rounded-lg border border-dashed border-[var(--border)]">
            <Plus size={17} className="text-muted" />
          </span>
          New playlist
        </button>
      )}
    </Modal>
  );
}

async function usePlaylistsRefetch() {
  const res = await fetch("/api/playlists");
  return (await res.json()) as { playlists: { id: number; name: string }[] };
}

/* ------------------------------ sleep timer ------------------------------- */
const SLEEP_OPTIONS = [
  { mins: 15, label: "15 minutes" },
  { mins: 30, label: "30 minutes" },
  { mins: 45, label: "45 minutes" },
  { mins: 60, label: "1 hour" },
];

function SleepTimerModal() {
  const open = useUi((s) => s.sleepMenuOpen);
  const close = () => useUi.getState().setSleepMenuOpen(false);
  const sleepMode = usePlayer((s) => s.sleepMode);
  const sleepEndsAt = usePlayer((s) => s.sleepEndsAt);
  const pushToast = useUi((s) => s.pushToast);

  return (
    <Modal open={open} onClose={close} title="Sleep timer" maxWidth={420}>
      <div className="space-y-1">
        {SLEEP_OPTIONS.map((o) => (
          <button
            key={o.mins}
            onClick={() => {
              setSleepTimer(o.mins);
              pushToast({ title: `Sleep timer set`, desc: `Playback will pause in ${o.label}`, kind: "ok" });
              close();
            }}
            className="hover-panel flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[14px]"
          >
            <span className="flex items-center gap-3">
              <Moon size={16} className="text-muted" /> {o.label}
            </span>
            {sleepMode === "timer" && sleepEndsAt && Math.round((sleepEndsAt - Date.now()) / 60000) === o.mins && (
              <Check size={16} className="accent-text" />
            )}
          </button>
        ))}
        <button
          onClick={() => {
            setSleepTimer("eot");
            pushToast({ title: "Sleep timer set", desc: "Playback pauses at end of track", kind: "ok" });
            close();
          }}
          className={cx("hover-panel flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-[14px]")}
        >
          <span className="flex items-center gap-3">
            <Moon size={16} className="text-muted" /> End of track
          </span>
          {sleepMode === "eot" && <Check size={16} className="accent-text" />}
        </button>
        {sleepMode && (
          <button
            onClick={() => {
              clearSleepTimer();
              pushToast({ title: "Sleep timer off", kind: "info" });
              close();
            }}
            className="hover-panel flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[14px] text-red-400"
          >
            <TimerOff size={16} /> Turn off timer
          </button>
        )}
      </div>
    </Modal>
  );
}
