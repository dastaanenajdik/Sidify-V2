"use client";

import { useState } from "react";
import { Check, ListMusic, Moon, Music2, Plus, TimerOff } from "lucide-react";
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
  const { data, addTrack, create, isLoading } = usePlaylists();
  const pushToast = useUi((s) => s.pushToast);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const playlists = data?.playlists ?? [];

  const addTo = async (playlistId: number) => {
    if (!track || busy) return;
    setBusy(true);
    try {
      await addTrack(playlistId, track);
      close();
    } catch {
      pushToast({ title: "Couldn't add to playlist", desc: track.title, kind: "warn" });
    } finally {
      setBusy(false);
    }
  };

  const createAndAdd = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await create(trimmed);
      if (track) await addTrack(created.id, track);
      setName("");
      setCreating(false);
      close();
    } catch {
      pushToast({ title: "Couldn't create that playlist", desc: "Please try again", kind: "warn" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!track} onClose={close} title="Add to playlist">
      <div className="max-h-72 space-y-1 overflow-y-auto">
        {isLoading && !data && <p className="text-muted py-6 text-center text-sm">Loading your playlists…</p>}
        {!isLoading && playlists.length === 0 && !creating && (
          <p className="text-muted py-6 text-center text-sm">No playlists yet — create your first one below.</p>
        )}
        {playlists.map((p) => {
          const already = !!track && p.tracks.some((t) => t.id === track.id);
          return (
            <button
              key={p.id}
              disabled={busy}
              onClick={async () => {
                if (already) {
                  pushToast({ title: "Already in this playlist", desc: track?.title, kind: "info" });
                  close();
                  return;
                }
                await addTo(p.id);
              }}
              className="hover-panel flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left disabled:opacity-60"
            >
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-[var(--panel-strong)]">
                <ListMusic size={17} className="text-muted" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium">{p.name}</span>
                <span className="text-muted-2 text-[12px]">
                  {p.tracks.length} {p.tracks.length === 1 ? "song" : "songs"}
                </span>
              </span>
              {already && <Check size={16} className="accent-text shrink-0" />}
            </button>
          );
        })}
      </div>
      {creating ? (
        <form
          className="mt-3 flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            await createAndAdd();
          }}
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Playlist name"
            maxLength={80}
            className="glass min-w-0 flex-1 rounded-xl px-3.5 py-2.5 text-sm outline-none placeholder:text-muted-2"
          />
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-xl accent-bg px-4 text-sm font-semibold text-black disabled:opacity-60"
          >
            {busy ? "…" : "Save"}
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
      {track && (
        <p className="text-muted-2 mt-3 flex items-center gap-2 text-[12px]">
          <Music2 size={12} className="shrink-0" /> <span className="truncate">{track.title} — {track.artist}</span>
        </p>
      )}
    </Modal>
  );
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
