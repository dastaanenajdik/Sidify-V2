"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Track } from "@/lib/types";
import { Check, Download, ListMusic, Plus, Share2, Volume2 } from "lucide-react";
import { useUi } from "@/store/ui";
import { usePlayer, currentTrack } from "@/store/player";
import { usePlaylists } from "@/lib/library";
import { engineStats } from "@/lib/audioEngine";
import { tapToSync, useRoom } from "@/lib/rooms/client";
import { cx, formatBytes } from "@/lib/format";
import { extractPalette, dim, tune, proxiedArt } from "@/lib/palette";
import { S_PATH } from "./Logo";
import { Artwork, Button, Sheet } from "./ui";
import { EqBlock, SleepBlock } from "./player/PlaybackSheet";

/* -------------------------------------------------------------------------- */
/*  Add to playlist / new playlist                                             */
/* -------------------------------------------------------------------------- */

function AddToPlaylistSheet() {
  const track = useUi((s) => s.addToPlaylistTrack);
  const close = () => useUi.getState().setAddToPlaylistTrack(null);
  const { data, addTrack } = usePlaylists();
  const playlists = data?.playlists ?? [];
  return (
    <Sheet open={!!track} onClose={close} title="Add to playlist" subtitle={track ? `${track.title} · ${track.artist}` : undefined}>
      <button
        type="button"
        onClick={() => {
          const t = track;
          close();
          useUi.getState().setCreatePlaylistOpen(true, t);
        }}
        className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-fill"
      >
        <span className="grid h-12 w-12 place-items-center rounded-[8px] bg-fill-2">
          <Plus size={20} />
        </span>
        <span className="text-[15px] font-semibold">New playlist</span>
      </button>
      {playlists.map((p) => {
        const has = !!track && p.tracks.some((t) => t.id === track.id);
        return (
          <button
            key={p.id}
            type="button"
            disabled={has}
            onClick={async () => {
              if (!track) return;
              await addTrack(p.id, track);
              close();
            }}
            className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2 text-left hover:bg-fill disabled:opacity-60"
          >
            {p.tracks[0] ? (
              <Artwork src={p.tracks[0].artwork} size={48} rounded="rounded-[8px]" className="h-12 w-12" />
            ) : (
              <span className="grid h-12 w-12 place-items-center rounded-[8px] bg-fill-2 text-fg-2">
                <ListMusic size={20} />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px]">{p.name}</span>
              <span className="block text-[13px] text-fg-2">
                {p.tracks.length} song{p.tracks.length === 1 ? "" : "s"}
              </span>
            </span>
            {has && <Check size={18} className="text-fg-2" />}
          </button>
        );
      })}
    </Sheet>
  );
}

function CreatePlaylistSheet() {
  const open = useUi((s) => s.createPlaylistOpen);
  const seed = useUi((s) => s.createPlaylistSeed);
  const close = () => useUi.getState().setCreatePlaylistOpen(false);
  return (
    <Sheet open={open} onClose={close} title="New playlist" width={400}>
      <CreatePlaylistForm key={seed?.id ?? "new"} seed={seed} close={close} />
    </Sheet>
  );
}

function CreatePlaylistForm({ seed, close }: { seed: Track | null; close: () => void }) {
  const { create, addTrack } = usePlaylists();
  const [name, setName] = useState(seed ? `${seed.artist} mix` : "");
  const [busy, setBusy] = useState(false);
  return (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const p = await create(name.trim() || "New playlist");
            if (seed) await addTrack(p.id, seed);
            close();
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-4"
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Playlist name"
          maxLength={80}
          aria-label="Playlist name"
          className="field h-11 w-full text-[16px]"
        />
        {seed && <p className="text-[13px] text-fg-2">“{seed.title}” will be added to it.</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            Create
          </Button>
        </div>
      </form>
  );
}

function SleepSheet() {
  const open = useUi((s) => s.sleepMenuOpen);
  return (
    <Sheet open={open} onClose={() => useUi.getState().setSleepMenuOpen(false)} title="Sleep timer" width={420}>
      <SleepBlock />
    </Sheet>
  );
}

function EqSheet() {
  const open = usePlayer((s) => s.eqOpen);
  return (
    <Sheet open={open} onClose={() => usePlayer.getState().set({ eqOpen: false })} title="Equalizer" width={460}>
      <EqBlock />
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*  Stats for nerds                                                            */
/* -------------------------------------------------------------------------- */

interface Probe {
  itag?: number;
  mime_type?: string;
  content_length?: number;
  bitrate?: number;
  success?: boolean;
}

function StatsSheet() {
  const open = useUi((s) => s.statsOpen);
  const track = usePlayer((s) => currentTrack(s));
  const [, tick] = useState(0);
  const probeQ = useQuery({
    queryKey: ["stream-probe", track?.videoId],
    queryFn: async (): Promise<Probe> => {
      try {
        const r = await fetch(`/api/stream?video_id=${track!.videoId}`);
        return (await r.json()) as Probe;
      } catch {
        return { success: false };
      }
    },
    enabled: open && !!track?.videoId,
    staleTime: 10 * 60_000,
  });
  const probe = probeQ.data ?? null;
  const room = useRoom((s) => s.room);
  const rtt = useRoom((s) => s.rttMs);
  const offset = useRoom((s) => s.offsetMs);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [open]);

  const st = open ? engineStats() : null;
  const p = usePlayer.getState();
  const rows: [string, string][] = st
    ? [
        ["Engine", st.mode === "iframe" ? "Sidify player" : st.mode === "native" ? "Sidify audio" : "Idle"],
        ["Video ID", track?.videoId ?? "—"],
        ["Format", probe?.mime_type ? `${probe.mime_type}${probe.itag ? ` · itag ${probe.itag}` : ""}` : probe?.success === false ? "Unavailable" : "…"],
        ["Bitrate", probe?.bitrate ? `${Math.round(probe.bitrate / 1000)} kbps` : "—"],
        ["Stream size", probe?.content_length ? formatBytes(probe.content_length) : "—"],
        ["Sample rate", st.sampleRate ? `${st.sampleRate} Hz` : "—"],
        ["Audio context", `${st.contextState}${st.baseLatency ? ` · ${(st.baseLatency * 1000).toFixed(1)} ms` : ""}`],
        ["Buffer ahead", st.mode === "native" ? `${st.bufferedAhead.toFixed(1)} s` : "—"],
        ["Ready / network", st.mode === "native" ? `${st.readyState} / ${st.networkState}` : `player state ${st.iframeState}`],
        ["Deck", `${st.deck === 0 ? "A" : "B"}${st.crossfading ? " (crossfading)" : ""}`],
        ["Speed / gain", `${p.speed}× · ${st.gain !== null ? st.gain.toFixed(2) : "—"}`],
        ...(room
          ? ([
              ["Room", `${room.code} · seq ${room.seq}`],
              ["Round trip", rtt !== null ? `${rtt} ms` : "—"],
              ["Clock offset", `${Math.round(offset)} ms`],
            ] as [string, string][])
          : []),
      ]
    : [];

  return (
    <Sheet open={open} onClose={() => useUi.getState().setStatsOpen(false)} title="Stats for nerds" width={460}>
      <dl className="overflow-hidden rounded-[12px] bg-fill font-mono text-[12.5px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-4 px-3.5 py-2 [&+&]:shadow-[inset_0_0.5px_0_var(--hairline)]">
            <dt className="shrink-0 text-fg-2">{k}</dt>
            <dd className="min-w-0 truncate text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </Sheet>
  );
}

/* -------------------------------------------------------------------------- */
/*  Lyrics share card                                                          */
/* -------------------------------------------------------------------------- */

async function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

async function renderCard(canvas: HTMLCanvasElement, title: string, artist: string, artwork: string, lines: string[]) {
  const W = 1080;
  const H = 1350;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const palette = (await extractPalette(artwork)).map(tune);
  // mesh
  ctx.fillStyle = dim(palette[0], 0.14);
  ctx.fillRect(0, 0, W, H);
  const anchors: [number, number][] = [
    [0.2, 0.25],
    [0.8, 0.2],
    [0.75, 0.8],
    [0.25, 0.75],
  ];
  ctx.filter = "blur(80px)";
  palette.forEach((c, i) => {
    const [ax, ay] = anchors[i];
    const g = ctx.createRadialGradient(ax * W, ay * H, 0, ax * W, ay * H, W * 0.75);
    g.addColorStop(0, `${c}dd`);
    g.addColorStop(1, `${c}00`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });
  ctx.filter = "none";
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.fillRect(0, 0, W, H);

  const pad = 96;
  const img = artwork ? await loadImage(proxiedArt(artwork, 300)) : null;
  const artSize = 150;
  if (img) {
    ctx.save();
    const r = 18;
    ctx.beginPath();
    ctx.roundRect(pad, pad, artSize, artSize, r);
    ctx.clip();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, pad, pad, artSize, artSize);
    ctx.restore();
  }
  const font = '-apple-system, "SF Pro Display", Inter, "Segoe UI", Roboto, sans-serif';
  ctx.fillStyle = "#fff";
  ctx.font = `700 44px ${font}`;
  ctx.fillText(title.slice(0, 40), pad + artSize + 36, pad + 66);
  ctx.fillStyle = "rgba(255,255,255,.7)";
  ctx.font = `500 36px ${font}`;
  ctx.fillText(artist.slice(0, 44), pad + artSize + 36, pad + 116);

  ctx.fillStyle = "#fff";
  ctx.font = `800 70px ${font}`;
  let y = pad + artSize + 150;
  for (const l of lines) {
    for (const row of wrap(ctx, l, W - pad * 2)) {
      if (y > H - 220) break;
      ctx.fillText(row, pad, y);
      y += 88;
    }
    y += 24;
  }

  // brand
  const s = 58;
  const bx = pad;
  const by = H - pad - s;
  const grad = ctx.createLinearGradient(0, by, 0, by + s);
  grad.addColorStop(0, "#ff5b6e");
  grad.addColorStop(1, "#fa233b");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(bx, by, s, s, s * 0.225);
  ctx.fill();
  ctx.save();
  ctx.translate(bx, by);
  ctx.scale(s / 24, s / 24);
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.75;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke(new Path2D(S_PATH));
  ctx.restore();
  ctx.fillStyle = "#fff";
  ctx.font = `700 38px ${font}`;
  ctx.fillText("Sidify", bx + s + 20, by + 42);
}

function LyricsShareSheet() {
  const share = useUi((s) => s.lyricsShare);
  const close = () => useUi.getState().setLyricsShare(null);
  return (
    <Sheet open={!!share} onClose={close} title="Share lyrics" width={440}>
      {share && <ShareCard key={`${share.track.id}:${share.lines.join("|")}`} share={share} />}
    </Sheet>
  );
}

function ShareCard({ share }: { share: { track: Track; lines: string[] } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const text = useMemo(() => `${share.lines.join("\n")}\n\n— ${share.track.title}, ${share.track.artist}`, [share]);

  useEffect(() => {
    if (!ref.current) return;
    let alive = true;
    void renderCard(ref.current, share.track.title, share.track.artist, share.track.artwork, share.lines).then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, [share]);

  const blob = async () =>
    new Promise<Blob | null>((resolve) => (ref.current ? ref.current.toBlob((b) => resolve(b), "image/png") : resolve(null)));
  const save = (b: Blob) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(b);
    a.download = "sidify-lyrics.png";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  return (
    <>
      <div className="overflow-hidden rounded-[14px] bg-black/40">
        <canvas ref={ref} className={cx("block h-auto w-full transition-opacity", ready ? "opacity-100" : "opacity-30")} />
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          className="flex-1"
          disabled={!ready}
          onClick={async () => {
            const b = await blob();
            if (!b) return;
            const file = new File([b], "sidify-lyrics.png", { type: "image/png" });
            const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
            if (nav.share && nav.canShare?.({ files: [file] })) {
              try {
                await nav.share({ files: [file], text });
                return;
              } catch {
                /* cancelled — fall back to saving */
              }
            }
            save(b);
          }}
        >
          <Share2 size={16} /> Share image
        </Button>
        <Button
          variant="secondary"
          disabled={!ready}
          onClick={async () => {
            const b = await blob();
            if (b) save(b);
          }}
        >
          <Download size={16} /> Save
        </Button>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*  Listen Together: autoplay blocked                                          */
/* -------------------------------------------------------------------------- */

function TapToSync() {
  const needsTap = useRoom((s) => s.needsTap);
  const inRoom = useRoom((s) => !!s.session);
  if (!needsTap || !inRoom) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[130] flex justify-center px-3 pt-safe">
      <button
        type="button"
        onClick={tapToSync}
        className="pointer-events-auto flex items-center gap-2.5 rounded-full bg-brand px-5 py-3 text-[14px] font-bold text-white shadow-[0_12px_40px_-8px_rgba(250,45,72,.6)]"
      >
        <Volume2 size={17} /> Tap to sync with the room
      </button>
    </div>
  );
}

export function GlobalModals() {
  return (
    <>
      <AddToPlaylistSheet />
      <CreatePlaylistSheet />
      <SleepSheet />
      <EqSheet />
      <StatsSheet />
      <LyricsShareSheet />
      <TapToSync />
    </>
  );
}

