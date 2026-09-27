"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, downloadTrack, removeDownloadEverywhere, clearAllDownloads, saveBlobToDevice } from "./clientApi";
import { idbGet } from "./offlineDb";
import { downloadFileName } from "./downloadName";
import { emitRefresh, onRefresh } from "./refreshBus";
import { refreshBlockedFilter } from "./audioEngine";
import { usePlayer } from "@/store/player";
import { useUi } from "@/store/ui";
import { useSettings } from "@/store/settings";
import type { Artist, Track } from "./types";
import { formatBytes } from "./format";

/* ------------------------- cross-hook refresh bus ------------------------ */
export { emitRefresh };

function useRefreshOn(key: string, fn: () => void) {
  useEffect(() => onRefresh((k) => k === key && fn()), [key, fn]);
}

/* -------------------------------- liked ---------------------------------- */
export function useLiked() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["liked"], queryFn: api.liked, staleTime: 60_000 });
  useRefreshOn("liked", q.refetch);

  useEffect(() => {
    if (q.data) {
      usePlayer.getState().set({
        likedIds: Object.fromEntries(q.data.tracks.map((t) => [t.id, true])),
      });
    }
  }, [q.data]);

  const toggle = async (track: Track) => {
    const state = usePlayer.getState();
    const liked = !!state.likedIds[track.id];
    const ids = { ...state.likedIds };
    if (liked) delete ids[track.id];
    else ids[track.id] = true;
    usePlayer.getState().set({ likedIds: ids });
    const push = useUi.getState().pushToast;
    // api.like/unlike never reject: they write through to the local library store and
    // mirror to the server when it answers, so the heart always sticks.
    await (liked ? api.unlike(track.id) : api.like(track)).catch(() =>
      usePlayer.getState().set({ likedIds: state.likedIds })
    );
    if (!liked && useSettings.getState().autoDownloadLiked) void downloadTrackFlow(track, { silent: true });
    push({ title: liked ? "Removed from Liked Songs" : "Added to Liked Songs", desc: track.title, kind: "ok" });
    qc.invalidateQueries({ queryKey: ["liked"] });
    qc.invalidateQueries({ queryKey: ["home"] });
  };

  return { ...q, toggle };
}

/* ------------------------------- downloads -------------------------------- */

/**
 * Downloads run through the same resolver + `/api/stream` proxy that playback uses, so
 * whatever plays can be saved. Two destinations share one fetch:
 *  - offline cache (IndexedDB) — the track then plays instantly, even with no network
 *  - "Save to device" — the same bytes handed to the browser's download manager as a
 *    real audio file (`Title - Artist.m4a`)
 * Every download affordance in the app funnels through `downloadTrackFlow`, so this
 * single switch still gates all of them.
 */
export const DOWNLOADS_ENABLED = true;

export async function downloadTrackFlow(track: Track, opts?: { silent?: boolean; toDevice?: boolean }): Promise<void> {
  if (!DOWNLOADS_ENABLED) {
    if (!opts?.silent) {
      useUi.getState().pushToast({
        title: "Download feature is coming soon! 🚀",
        desc: track?.title,
        kind: "info",
      });
    }
    return;
  }
  if (!track?.videoId) {
    if (!opts?.silent) useUi.getState().pushToast({ title: "This track can't be downloaded", desc: track?.title, kind: "warn" });
    return;
  }

  const ui = useUi.getState();
  const p = usePlayer.getState();

  if (p.downloadedIds[track.id]) {
    if (opts?.toDevice) {
      // Already cached offline: hand the stored bytes over without another download.
      const cached = await idbGet(track.id).catch(() => null);
      if (cached) {
        saveBlobToDevice(cached, downloadFileName(track.title, track.artist, cached.type));
        ui.pushToast({ title: "Saving to device", desc: track.title, kind: "ok" });
        return;
      }
    } else {
      ui.pushToast({ title: "Already downloaded", desc: track.title, kind: "info" });
      return;
    }
  }
  if (ui.downloadProgress[track.id] != null) return;

  if (!opts?.silent) ui.pushToast({ title: opts?.toDevice ? "Preparing file…" : "Downloading…", desc: track.title, kind: "info" });
  try {
    ui.setDownloadProgress(track.id, 1);
    const size = await downloadTrack(track, useSettings.getState().downloadQuality, (pct) =>
      useUi.getState().setDownloadProgress(track.id, pct)
    );
    usePlayer.getState().set({
      downloadedIds: { ...usePlayer.getState().downloadedIds, [track.id]: true },
    });
    if (opts?.toDevice) {
      const blob = await idbGet(track.id).catch(() => null);
      if (blob) saveBlobToDevice(blob, downloadFileName(track.title, track.artist, blob.type));
      useUi.getState().pushToast({
        title: blob ? "Saved to device" : "Available offline",
        desc: `${track.title} · ${formatBytes(size)}`,
        kind: "ok",
      });
    } else {
      useUi.getState().pushToast({
        title: "Available offline",
        desc: `${track.title} · ${formatBytes(size)}`,
        kind: "ok",
      });
    }
    emitRefresh("downloads");
  } catch (err) {
    useUi.getState().pushToast({
      title: "Download failed",
      desc: (err as Error)?.message ? `${track.title} · ${(err as Error).message}` : track.title,
      kind: "warn",
    });
  } finally {
    useUi.getState().setDownloadProgress(track.id, null);
  }
}

export function useDownloads() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["downloads"], queryFn: api.downloads, staleTime: 30_000 });
  useRefreshOn("downloads", q.refetch);

  useEffect(() => {
    if (q.data) {
      usePlayer.getState().set({
        downloadedIds: Object.fromEntries(q.data.downloads.map((d) => [d.trackId, true])),
      });
    }
  }, [q.data]);

  const remove = useMutation({
    mutationFn: async (trackId: string) => removeDownloadEverywhere(trackId),
    onSuccess: (_d, trackId) => {
      const ids = { ...usePlayer.getState().downloadedIds };
      delete ids[trackId];
      usePlayer.getState().set({ downloadedIds: ids });
      qc.invalidateQueries({ queryKey: ["downloads"] });
      useUi.getState().pushToast({ title: "Download removed", kind: "ok" });
    },
  });

  const clear = useMutation({
    mutationFn: clearAllDownloads,
    onSuccess: () => {
      usePlayer.getState().set({ downloadedIds: {} });
      qc.invalidateQueries({ queryKey: ["downloads"] });
      useUi.getState().pushToast({ title: "All downloads cleared", kind: "ok" });
    },
  });

  return { ...q, remove: remove.mutateAsync, clear: clear.mutateAsync };
}

/* ------------------------------- blocked ---------------------------------- */
export function useBlocked() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["blocked"], queryFn: api.blocked, staleTime: 60_000 });

  useEffect(() => {
    if (q.data) {
      (window as unknown as { __sidifyBlocked: Set<string> }).__sidifyBlocked = new Set(
        q.data.artists.map((a) => a.artistId)
      );
      refreshBlockedFilter();
    }
  }, [q.data]);

  const block = useMutation({
    mutationFn: ({ artistId, name }: { artistId: string; name: string }) => api.block(artistId, name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["blocked"] });
      useUi.getState().pushToast({ title: "Artist blocked", desc: "Their music will be hidden", kind: "ok" });
    },
  });
  const unblock = useMutation({
    mutationFn: (id: string) => api.unblock(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["blocked"] }),
  });

  return { ...q, block: block.mutateAsync, unblock: unblock.mutateAsync };
}

/* ------------------------------- followed --------------------------------- */
export function useFollowed() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["followed"], queryFn: api.followed, staleTime: 60_000 });
  const m = useMutation({
    mutationFn: async ({ artist, follow }: { artist: Artist; follow: boolean }) =>
      follow ? api.follow(artist) : api.unfollow(artist.id),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ["followed"] });
      useUi.getState().pushToast({
        title: v.follow ? `Following ${v.artist.name}` : `Unfollowed ${v.artist.name}`,
        kind: "ok",
      });
    },
  });
  return { ...q, toggle: (artist: Artist, follow: boolean) => m.mutateAsync({ artist, follow }) };
}

/* ------------------------------- playlists -------------------------------- */
export function usePlaylists() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["playlists"], queryFn: api.playlists, staleTime: 30_000 });
  const inv = () => qc.invalidateQueries({ queryKey: ["playlists"] });

  const invBoth = () => {
    inv();
    qc.invalidateQueries({ queryKey: ["playlist"] });
  };

  return {
    ...q,
    create: async (name: string) => {
      const res = await api.createPlaylist(name);
      invBoth();
      useUi.getState().pushToast({ title: "Playlist created", desc: res.playlist.name, kind: "ok" });
      return res.playlist;
    },
    rename: async (id: number, name: string) => {
      await api.renamePlaylist(id, name);
      invBoth();
      useUi.getState().pushToast({ title: "Playlist renamed", kind: "ok" });
    },
    remove: async (id: number) => {
      await api.deletePlaylist(id);
      invBoth();
      useUi.getState().pushToast({ title: "Playlist deleted", kind: "ok" });
    },
    addTrack: async (id: number, track: Track) => {
      await api.addToPlaylist(id, track);
      invBoth();
      const where = q.data?.playlists.find((p) => p.id === id)?.name;
      useUi.getState().pushToast({ title: where ? `Added to ${where}` : "Added to playlist", desc: track.title, kind: "ok" });
    },
    removeTrack: async (id: number, trackId: string) => {
      await api.removeFromPlaylist(id, trackId);
      invBoth();
    },
  };
}
