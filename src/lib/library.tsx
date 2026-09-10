"use client";

import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, downloadTrack, removeDownloadEverywhere, clearAllDownloads } from "./clientApi";
import { refreshBlockedFilter } from "./audioEngine";
import { usePlayer } from "@/store/player";
import { useUi } from "@/store/ui";
import { useSettings } from "@/store/settings";
import type { Artist, Track } from "./types";
import { formatBytes } from "./format";

/* ------------------------- cross-hook refresh bus ------------------------ */
const listeners = new Set<(key: string) => void>();
export function emitRefresh(key: string) {
  listeners.forEach((f) => f(key));
}
function onRefresh(f: (key: string) => void) {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
}
function useRefreshOn(key: string, fn: () => void) {
  useEffect(() => onRefresh((k) => k === key && fn()), [key, fn]);
}

/* -------------------------------- liked ---------------------------------- */
export function useLiked() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["liked"], queryFn: api.liked, staleTime: 60_000 });

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
    try {
      if (liked) await api.unlike(track.id);
      else await api.like(track);
      push({ title: liked ? "Removed from Liked Songs" : "Added to Liked Songs", kind: "ok" });
      if (!liked && useSettings.getState().autoDownloadLiked) void downloadTrackFlow(track);
      qc.invalidateQueries({ queryKey: ["liked"] });
    } catch {
      usePlayer.getState().set({ likedIds: { ...state.likedIds } });
      push({ title: "Couldn't update likes", kind: "warn" });
    }
  };

  return { ...q, toggle };
}

/* ------------------------------- downloads -------------------------------- */
export async function downloadTrackFlow(track: Track) {
  const ui = useUi.getState();
  const p = usePlayer.getState();
  if (p.downloadedIds[track.id]) {
    ui.pushToast({ title: "Already downloaded", desc: track.title, kind: "info" });
    return;
  }
  if (ui.downloadProgress[track.id] != null) return;
  ui.pushToast({ title: "Downloading…", desc: track.title, kind: "info" });
  try {
    ui.setDownloadProgress(track.id, 1);
    const size = await downloadTrack(track, useSettings.getState().downloadQuality, (pct) =>
      useUi.getState().setDownloadProgress(track.id, pct)
    );
    usePlayer.getState().set({
      downloadedIds: { ...usePlayer.getState().downloadedIds, [track.id]: true },
    });
    useUi.getState().pushToast({
      title: "Available offline",
      desc: `${track.title} · ${formatBytes(size)}`,
      kind: "ok",
    });
    emitRefresh("downloads");
  } catch {
    useUi.getState().pushToast({ title: "Download failed", desc: track.title, kind: "warn" });
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

  return {
    ...q,
    create: async (name: string) => {
      await api.createPlaylist(name);
      inv();
    },
    rename: async (id: number, name: string) => {
      await api.renamePlaylist(id, name);
      inv();
    },
    remove: async (id: number) => {
      await api.deletePlaylist(id);
      inv();
      useUi.getState().pushToast({ title: "Playlist deleted", kind: "ok" });
    },
    addTrack: async (id: number, track: Track) => {
      await api.addToPlaylist(id, track);
      inv();
      useUi.getState().pushToast({ title: "Added to playlist", kind: "ok" });
    },
    removeTrack: async (id: number, trackId: string) => {
      await api.removeFromPlaylist(id, trackId);
      inv();
    },
  };
}
