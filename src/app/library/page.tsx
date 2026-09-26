"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Download, FileText, Heart, ListMusic, Mic2, Play, Plus, Search, SkipBack, SkipForward, Trash2 } from "lucide-react";
import { api } from "@/lib/clientApi";
import { onRefresh } from "@/lib/refreshBus";
import { useDownloads, useFollowed, useLiked, usePlaylists } from "@/lib/library";
import { playContext, seekTo } from "@/lib/audioEngine";
import { useLyricsLookup, useSmoothPosition } from "@/lib/lyricsClient";
import { usePlayer } from "@/store/player";
import LyricsView, { LyricsModeToggle, lyricsAreSynced, type LyricsMode } from "@/components/LyricsView";
import { activeLineIndex as activeLine, type LyricLine } from "@/lib/lyrics";
import { useSettings } from "@/store/settings";
import { cx, upscaleArtwork } from "@/lib/format";
import type { PlaylistRow } from "@/lib/types";
import TrackRow from "@/components/TrackRow";
import { ArtistCard } from "@/components/cards";
import { Modal } from "@/components/controls";

const TABS = [
  { id: "liked", label: "Liked Songs", icon: Heart },
  { id: "playlists", label: "Playlists", icon: ListMusic },
  { id: "artists", label: "Artists", icon: Mic2 },
  { id: "history", label: "History", icon: Clock3 },
  { id: "lyrics", label: "Lyrics Finder", icon: FileText },
] as const;

function LibraryInner() {
  const params = useSearchParams();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("liked");
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (params.get("create") === "1") {
      setTab("playlists");
      setCreateOpen(true);
    } else if (params.get("tab") === "lyrics") {
      setTab("lyrics");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-6 md:px-7">
      <h1 className="font-display mb-5 text-[30px] font-extrabold tracking-tight md:text-[36px]">Your Library</h1>

      <div className="mb-6 flex gap-2 overflow-x-auto no-scrollbar">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold transition-all",
              tab === t.id ? "accent-bg border-transparent text-black" : "border-[var(--border)] text-muted hover:text-[var(--text)]"
            )}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "liked" && <LikedTab />}
      {tab === "playlists" && <PlaylistsTab onCreate={() => setCreateOpen(true)} />}
      {tab === "artists" && <ArtistsTab />}
      {tab === "history" && <HistoryTab />}
      {tab === "lyrics" && <LyricsFinderTab />}

      <CreatePlaylistModal open={createOpen} onClose={() => setCreateOpen(false)} />
    </div>
  );
}

/* --------------------------------- liked --------------------------------- */
function LikedTab() {
  const { data } = useLiked();
  const tracks = data?.tracks ?? [];
  const ef = useSettings((s) => s.explicitFilter);
  const vis = ef ? tracks.filter((t) => !t.explicit) : tracks;

  return (
    <div>
      <div className="relative mb-6 flex items-center gap-5 overflow-hidden rounded-3xl border border-[var(--border-soft)] p-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-600/35 via-transparent to-[var(--glow)]" />
        <div className="relative grid h-24 w-24 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-violet-500 to-[var(--accent)] shadow-xl md:h-28 md:w-28">
          <Heart size={40} fill="white" className="text-white drop-shadow-lg" strokeWidth={0} />
        </div>
        <div className="relative min-w-0">
          <div className="text-[11px] font-bold tracking-[0.2em] uppercase text-muted">Playlist</div>
          <h2 className="font-display text-[26px] font-extrabold md:text-[34px]">Liked Songs</h2>
          <p className="text-muted text-[13px]">{vis.length} songs</p>
        </div>
        {vis.length > 0 && (
          <button
            onClick={() => playContext(vis, 0, "Liked Songs")}
            className="relative ml-auto grid h-14 w-14 shrink-0 place-items-center rounded-full accent-bg text-black transition-transform hover:scale-105"
            style={{ boxShadow: "0 14px 34px -8px var(--glow)" }}
            aria-label="Play liked songs"
          >
            <Play size={22} fill="currentColor" strokeWidth={0} className="translate-x-[2px]" />
          </button>
        )}
      </div>
      {vis.length === 0 ? (
        <EmptyState
          icon={<Heart size={30} />}
          title="No liked songs yet"
          desc="Tap the heart on any track and it will live here, synced to your library."
        />
      ) : (
        <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2">
          {vis.map((_, i) => (
            <TrackRow key={vis[i].id} tracks={vis} index={i} contextLabel="Liked Songs" />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------- playlists -------------------------------- */
function PlaylistsTab({ onCreate }: { onCreate: () => void }) {
  const { data } = usePlaylists();
  const playlists = data?.playlists ?? [];
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <button
        onClick={onCreate}
        className="hover-panel flex aspect-square flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[var(--border)] p-4 text-muted"
      >
        <span className="grid h-12 w-12 place-items-center rounded-full bg-[var(--panel-strong)]">
          <Plus size={20} />
        </span>
        <span className="text-[13px] font-semibold">New playlist</span>
      </button>
      {playlists.map((p) => (
        <PlaylistCard key={p.id} playlist={p} />
      ))}
    </div>
  );
}

function PlaylistCard({ playlist }: { playlist: PlaylistRow }) {
  const arts = playlist.tracks.slice(0, 4).map((t) => t.artwork);
  return (
    <Link href={`/playlist/${playlist.id}`} className="hover-panel group rounded-2xl border border-transparent p-3">
      <div className="mb-3 aspect-square overflow-hidden rounded-xl">
        {arts.length >= 4 ? (
          <div className="grid h-full w-full grid-cols-2 grid-rows-2">
            {arts.map((a, i) => (
              <img key={i} src={a} alt="" loading="lazy" className="h-full w-full object-cover" />
            ))}
          </div>
        ) : arts[0] ? (
          <img src={upscaleArtwork(arts[0], 400)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (
          <div className="grid h-full w-full place-items-center bg-[var(--panel-strong)]">
            <ListMusic size={34} className="text-muted-2" />
          </div>
        )}
      </div>
      <div className="truncate text-[14.5px] font-semibold">{playlist.name}</div>
      <div className="text-muted text-[12.5px]">{playlist.tracks.length} songs</div>
    </Link>
  );
}

/* -------------------------------- artists --------------------------------- */
function ArtistsTab() {
  const { data } = useFollowed();
  const artists = data?.artists ?? [];
  return artists.length === 0 ? (
    <EmptyState
      icon={<Mic2 size={30} />}
      title="You're not following any artists"
      desc="Open an artist page and hit Follow — their releases will surface here."
      cta={{ href: "/search", label: "Find artists" }}
    />
  ) : (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
      {artists.map((a) => (
        <ArtistCard key={a.artistId} artist={a.artist} />
      ))}
    </div>
  );
}

/* -------------------------------- history --------------------------------- */
function HistoryTab() {
  const qc = useQueryClient();
  const { data, refetch } = useQuery({ queryKey: ["recent"], queryFn: api.recent });
  const tracks = data?.tracks ?? [];

  // The engine emits "recent" right after a play is recorded, so this tab is live
  // while you keep listening instead of only updating on a reload.
  useEffect(() => {
    const refresh = () => void refetch();
    return onRefresh((k) => {
      if (k === "recent" || k === "liked") refresh();
    });
  }, [refetch]);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-muted text-[13px]">Your last {tracks.length} plays — synced across sessions</p>
        {tracks.length > 0 && (
          <button
            onClick={async () => {
              await api.clearRecent();
              qc.invalidateQueries({ queryKey: ["recent"] });
            }}
            className="flex items-center gap-1.5 text-[12px] font-bold tracking-wider text-red-400 uppercase hover:opacity-80"
          >
            <Trash2 size={13} /> Clear history
          </button>
        )}
      </div>
      {tracks.length === 0 ? (
        <EmptyState icon={<Clock3 size={30} />} title="Nothing played yet" desc="Your listening history will appear here as you play tracks." />
      ) : (
        <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2">
          {tracks.map((_, i) => (
            <TrackRow key={tracks[i].id} tracks={tracks} index={i} contextLabel="History" />
          ))}
        </div>
      )}
    </div>
  );
}

/* ----------------------------- lyrics finder ------------------------------ */
/**
 * Standalone lyrics lookup: type a song (and optionally the singer), get the
 * lyrics, copy them, or watch them light up line by line against the player.
 * Same provider chain as the player panel — /api/lyrics → LRCLIB → lyrics.ovh.
 */
function LyricsFinderTab() {
  const current = usePlayer((s) => s.queue[s.index] ?? null);
  const { loading, started, lyrics, lines, source, instrumental, message, search, retry } = useLyricsLookup("", "", 0);
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [mode, setMode] = useState<LyricsMode>("static");
  const [follow, setFollow] = useState(false);
  const positionMs = useSmoothPosition();
  const syncedAvailable = lyricsAreSynced(lines);
  const effectiveMode: LyricsMode = mode === "synced" && syncedAvailable ? "synced" : "static";
  const inputRef = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setFollow(false);
    search(title.trim(), artist.trim());
  }

  // Following the player: flip to synced as soon as timed lines arrive.
  useEffect(() => {
    // Guarded no-op in the common case (the async fetch result drives this).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (follow && syncedAvailable) setMode("synced");
  }, [follow, syncedAvailable]);

  /** Load lyrics for whatever is playing right now and light them up live. */
  function followCurrentTrack() {
    if (!current) return;
    setTitle(current.title);
    setArtist(current.artist);
    setFollow(true);
    search(current.title, current.artist);
  }

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="glass relative mb-5 overflow-hidden rounded-3xl border border-[var(--border-soft)] p-5 md:p-6">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-violet-600/25 via-transparent to-[var(--glow)]" />
        <div className="relative">
          <h2 className="font-display text-[20px] font-extrabold md:text-[24px]">Lyrics Finder</h2>
          <p className="text-muted mt-1 text-[13px]">
            Song ka naam likho — lyrics yahin aa jayenge. Copy karo, ya{" "}
            <span className="accent-text font-semibold">Synced</span> view me line-by-line chalte dekho.
          </p>

          <form onSubmit={submit} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <input
              ref={inputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={500}
              aria-label="Song title"
              placeholder="Song title — e.g. Tum Hi Ho"
              className="glass min-w-0 flex-1 rounded-xl px-4 py-3 text-[14px] font-medium outline-none placeholder:text-muted-2"
            />
            <input
              value={artist}
              onChange={(event) => setArtist(event.target.value)}
              maxLength={300}
              aria-label="Singer (optional)"
              placeholder="Singer (optional)"
              className="glass rounded-xl px-4 py-3 text-[14px] font-medium outline-none placeholder:text-muted-2 sm:w-[210px]"
            />
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="flex shrink-0 items-center justify-center gap-2 rounded-xl accent-bg px-5 py-3 text-[13.5px] font-bold text-black transition-transform hover:scale-[1.02] disabled:opacity-50"
            >
              <Search size={15} /> {loading ? "Finding…" : "Find"}
            </button>
          </form>

          {current && (
            <button
              type="button"
              onClick={followCurrentTrack}
              className="text-muted hover:accent-text mt-3 flex items-center gap-1.5 text-[12px] font-semibold"
            >
              <Play size={12} /> Use the playing song — {current.title}
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="glass flex flex-col items-center gap-3 rounded-3xl px-6 py-16 text-muted" role="status" aria-live="polite">
          <div className="shimmer h-4 w-2/3 rounded-full" />
          <div className="shimmer h-4 w-1/2 rounded-full" />
          <div className="shimmer h-4 w-3/5 rounded-full" />
          <span className="mt-2 text-[13px]">Finding lyrics…</span>
        </div>
      ) : started && (lyrics?.trim() || lines.length) ? (
        <div className="glass overflow-hidden rounded-3xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-3">
            <div className="min-w-0">
              <h3 className="font-display truncate text-[16px] font-bold">{title || "Lyrics"}</h3>
              {artist && <p className="text-muted truncate text-[12px]">{artist}</p>}
            </div>
            <LyricsModeToggle mode={effectiveMode} syncedAvailable={syncedAvailable} onChange={setMode} />
          </div>

          <LyricsView
            lyrics={lyrics}
            lines={lines}
            mode={effectiveMode}
            positionMs={positionMs}
            source={source}
            className="h-[58vh] min-h-[320px]"
            listClassName="px-6"
          />

          {follow && (
            <FinderNowBar
              lines={lines}
              positionMs={positionMs}
              onSeek={(ms) => seekTo(ms)}
            />
          )}
        </div>
      ) : started && instrumental ? (
        <EmptyState icon={<FileText size={30} />} title="Instrumental track" desc="Is gaane me koi lyrics nahi hain — sirf music hai." />
      ) : started && message ? (
        <div className="glass mx-auto flex max-w-md flex-col items-center rounded-3xl px-8 py-12 text-center">
          <div className="text-muted mb-4 grid h-14 w-14 place-items-center rounded-full bg-[var(--panel-strong)]">
            <FileText size={26} />
          </div>
          <h3 className="font-display text-[17px] font-bold">{message}</h3>
          <p className="text-muted mt-2 text-[13px] leading-6">
            Spelling check karo, ya singer ka naam bhi likh ke dobara try karo.
          </p>
          <div className="mt-5 flex gap-2">
            <button onClick={retry} className="accent-text rounded-full border border-[var(--border)] px-4 py-2 text-[13px] font-semibold">
              Retry
            </button>
            <button onClick={() => inputRef.current?.focus()} className="rounded-full accent-bg px-4 py-2 text-[13px] font-bold text-black">
              Edit search
            </button>
          </div>
        </div>
      ) : (
        <EmptyState
          icon={<FileText size={30} />}
          title="Find any song's lyrics"
          desc="Naam likho aur lyrics yahin mil jayenge — copy karne ke liye, ya player ke saath sync karke padhne ke liye. Kuch bhi play kiye bina kaam karta hai."
        />
      )}
    </div>
  );
}

/** Live transport strip shown when the finder is following the playing song. */
function FinderNowBar({ lines, positionMs, onSeek }: { lines: LyricLine[]; positionMs: number; onSeek: (ms: number) => void }) {
  const isPlaying = usePlayer((s) => s.isPlaying);
  const index = lines.length && positionMs >= lines[0].startMs ? activeLine(lines, positionMs) : -1;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-3">
      <div className="min-w-0">
        <div className="text-muted-2 text-[10px] font-bold tracking-[0.18em] uppercase">
          {isPlaying ? "Following playback" : "Paused"}
        </div>
        <div className="accent-text truncate text-[13px] font-semibold">
          {index >= 0 ? lines[index].text : "Music…"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {index > 0 && (
          <button type="button" onClick={() => onSeek(lines[index - 1].startMs)} className="text-muted glass grid h-8 w-8 place-items-center rounded-full hover:text-[var(--text)]" aria-label="Previous line">
            <SkipBack size={13} />
          </button>
        )}
        {index >= 0 && index < lines.length - 1 && (
          <button type="button" onClick={() => onSeek(lines[index + 1].startMs)} className="text-muted glass grid h-8 w-8 place-items-center rounded-full hover:text-[var(--text)]" aria-label="Next line">
            <SkipForward size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- shared --------------------------------- */
function EmptyState({
  icon,
  title,
  desc,
  cta,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="glass mx-auto mt-10 flex max-w-md flex-col items-center rounded-3xl px-8 py-14 text-center">
      <div className="mb-4 grid h-16 w-16 place-items-center rounded-full bg-[var(--panel-strong)] text-muted">{icon}</div>
      <h3 className="font-display text-[18px] font-bold">{title}</h3>
      <p className="text-muted mt-2 text-[13.5px] leading-6">{desc}</p>
      {cta && (
        <Link href={cta.href} className="mt-5 rounded-full accent-bg px-5 py-2.5 text-[13px] font-bold text-black">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

function CreatePlaylistModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { create } = usePlaylists();
  const [name, setName] = useState("");
  useEffect(() => {
    if (open) setName(`My Playlist #${Math.floor(Math.random() * 90 + 10)}`);
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} title="Create playlist">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim()) return;
          await create(name.trim());
          onClose();
        }}
        className="space-y-4"
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="glass w-full rounded-xl px-4 py-3 text-[15px] font-medium outline-none placeholder:text-muted-2"
          placeholder="Name your playlist"
          maxLength={80}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-full px-4 py-2 text-[13.5px] font-semibold text-muted hover:text-[var(--text)]">
            Cancel
          </button>
          <button type="submit" className="rounded-full accent-bg px-5 py-2 text-[13.5px] font-bold text-black">
            Create
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function LibraryPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1280px] px-4 pt-8 md:px-7"><div className="shimmer h-40 rounded-3xl" /></div>}>
      <LibraryInner />
    </Suspense>
  );
}
