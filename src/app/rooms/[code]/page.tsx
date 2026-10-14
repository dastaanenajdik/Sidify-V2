"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, Crown, ListPlus, Loader2, LogOut, Minus, Plus, QrCode, Share2, UserMinus, X } from "lucide-react";
import { api } from "@/lib/clientApi";
import { addToQueueEnd, next, playTrackNow, prev, togglePlay } from "@/lib/audioEngine";
import { inviteUrl, joinRoom, leaveRoom, sendControl, useRoom } from "@/lib/rooms/client";
import { ROOM_LIMITS, currentOf, expectedPosition, normalizeCode, type RoomState } from "@/lib/rooms/logic";
import { usePlayer } from "@/store/player";
import { useSettings } from "@/store/settings";
import { useUi } from "@/store/ui";
import { copyText } from "@/lib/clipboard";
import { useNow } from "@/lib/useNow";
import { cx, formatTime, timeAgo } from "@/lib/format";
import MeshBackdrop from "@/components/MeshBackdrop";
import QueueList from "@/components/player/QueueList";
import { Artwork, Button, ButtonLink, EmptyState, IconButton, Sheet, Skeleton, Switch } from "@/components/ui";
import { BackwardGlyph, ForwardGlyph, PauseGlyph, PeopleGlyph, PlayGlyph } from "@/components/icons";
import type { Track } from "@/lib/types";

export default function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const code = normalizeCode(use(params).code);
  const session = useRoom((s) => s.session);
  const room = useRoom((s) => s.room);
  const inThisRoom = session?.code === code;

  if (inThisRoom && room) return <RoomView room={room} you={session!.memberId} />;
  if (inThisRoom && !room)
    return (
      <div className="px-4 pt-10 desk:px-8">
        <Skeleton className="h-48 rounded-[22px]" />
      </div>
    );
  return <JoinView code={code} />;
}

/* ---------------------------------- join ---------------------------------- */

interface Preview {
  code: string;
  name: string;
  hostName: string;
  memberCount: number;
  maxMembers: number;
  track: { title: string; artist: string; artwork: string } | null;
}

function JoinView({ code }: { code: string }) {
  const router = useRouter();
  const profileName = useSettings((s) => s.profileName);
  const [name, setName] = useState(profileName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preview = useQuery({
    queryKey: ["room-preview", code],
    queryFn: async () => {
      const res = await fetch(`/api/rooms/${code}`, { cache: "no-store" });
      const data = (await res.json()) as { preview?: Preview; error?: string };
      if (!res.ok || !data.preview) throw new Error(data.error || "This room has ended");
      return data.preview;
    },
    retry: false,
    refetchInterval: 5000,
  });

  if (preview.isError) {
    return (
      <EmptyState
        icon={<PeopleGlyph size={28} />}
        title="This room has ended"
        desc={`There's no live room with the code ${code}. Check it, or start your own.`}
        action={<ButtonLink href="/rooms">Listen Together</ButtonLink>}
        className="pt-20"
      />
    );
  }
  const p = preview.data;
  return (
    <div className="fade-up mx-auto max-w-[460px] px-4 pt-10 desk:pt-16">
      <div className="relative overflow-hidden rounded-[22px] text-white ring-1 ring-edge">
        <MeshBackdrop artwork={p?.track?.artwork} blur={50} />
        <div className="relative flex flex-col items-center p-7 text-center">
          <span className="mb-3 grid h-16 w-16 place-items-center rounded-full bg-white/15 backdrop-blur-xl">
            <PeopleGlyph size={30} />
          </span>
          <div className="text-[12px] font-semibold tracking-[0.1em] text-white/70 uppercase">You&apos;re invited</div>
          <h1 className="mt-1 text-[26px] font-extrabold tracking-[-0.5px]">{p ? p.name : <Skeleton className="mx-auto h-7 w-48 rounded" />}</h1>
          {p && (
            <p className="mt-1 text-[14px] text-white/70">
              {p.memberCount} of {p.maxMembers} listening · code <span className="font-mono font-bold tracking-wider">{p.code}</span>
            </p>
          )}
          {p?.track && (
            <div className="mt-5 flex w-full items-center gap-3 rounded-[14px] bg-black/25 p-2.5 text-left backdrop-blur-xl">
              <Artwork src={p.track.artwork} size={44} rounded="rounded-[8px]" className="h-11 w-11" />
              <div className="min-w-0">
                <div className="truncate text-[14px] font-semibold">{p.track.title}</div>
                <div className="truncate text-[12.5px] text-white/65">{p.track.artist}</div>
              </div>
            </div>
          )}
        </div>
      </div>
      <form
        className="mt-5 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          const res = await joinRoom(code, name);
          setBusy(false);
          if (!res.ok) setError(res.error ?? "Couldn't join");
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Your name" aria-label="Your name" className="field h-12 w-full text-[16px]" />
        {error && <p className="text-[13px] font-medium text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={busy || !p || p.memberCount >= p.maxMembers}>
          {busy ? <Loader2 size={18} className="animate-spin" /> : <PeopleGlyph size={18} />}
          {p && p.memberCount >= p.maxMembers ? "Room is full" : "Join the room"}
        </Button>
        <Button variant="ghost" className="w-full" onClick={() => router.push("/rooms")}>
          Not now
        </Button>
      </form>
    </div>
  );
}

/* ---------------------------------- room ---------------------------------- */

function RoomView({ room, you }: { room: RoomState; you: string }) {
  const router = useRouter();
  const status = useRoom((s) => s.status);
  const rtt = useRoom((s) => s.rttMs);
  const offset = useRoom((s) => s.offsetMs);
  const presence = useRoom((s) => s.presence);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const isHost = room.hostId === you;
  const canControl = !room.hostOnly || isHost;
  const cur = currentOf(room);
  const now = useNow(500);
  const pos = expectedPosition(room, now + offset);
  const [qrOpen, setQrOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const url = inviteUrl(room.code);

  const share = async () => {
    const text = `Listen with me on Sidify — room ${room.code}`;
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    if (nav.share) {
      try {
        await nav.share({ title: "Sidify · Listen Together", text, url });
        return;
      } catch {
        /* fall back to copy */
      }
    }
    await copyText(`${text}\n${url}`);
    useUi.getState().pushToast({ title: "Invite copied", desc: url, kind: "ok" });
  };

  return (
    <div className="fade-up pb-6">
      {/* hero */}
      <div className="relative mx-4 mt-4 overflow-hidden rounded-[22px] text-white ring-1 ring-edge desk:mx-8 desk:mt-7">
        <MeshBackdrop artwork={cur?.artwork} driftKey={cur?.id} blur={56} />
        <div className="relative grid gap-6 p-5 desk:grid-cols-[1fr_auto] desk:p-7">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[12px] font-semibold tracking-[0.08em] text-white/75 uppercase">
              <span className={cx("h-2 w-2 rounded-full", status === "live" ? "live-dot bg-white" : "bg-white/40")} />
              {status === "live" ? `In sync${rtt !== null ? ` · ${rtt} ms` : ""}` : status === "reconnecting" ? "Reconnecting…" : "Connecting…"}
            </div>
            <h1 className="mt-1.5 truncate text-[28px] leading-tight font-extrabold tracking-[-0.6px] desk:text-[36px]">{room.name}</h1>
            <p className="mt-1 text-[14px] text-white/70">
              Listening · {room.members.length} of {room.maxMembers}
              {room.hostOnly ? " · host controls the music" : " · anyone can control the music"}
            </p>

            {cur ? (
              <div className="mt-5 flex items-center gap-4">
                <button type="button" onClick={() => usePlayer.getState().set({ fullPlayerOpen: true })} className="shrink-0" aria-label="Open Now Playing">
                  <Artwork src={cur.artwork} size={84} rounded="rounded-[10px]" className="h-[84px] w-[84px] shadow-xl" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[18px] font-bold">{cur.title}</div>
                  <div className="truncate text-[14px] text-white/70">
                    {cur.artist}
                    {room.startedBy ? ` · picked by ${room.startedBy}` : ""}
                  </div>
                  <div className="mt-2.5 h-[3px] overflow-hidden rounded-full bg-white/20">
                    <div className="h-full rounded-full bg-white/85" style={{ width: `${cur.durationMs ? Math.min(100, (pos / cur.durationMs) * 100) : 0}%` }} />
                  </div>
                  <div className="mt-1 flex justify-between text-[11.5px] text-white/60 tabular-nums">
                    <span>{formatTime(pos)}</span>
                    <span>-{formatTime(Math.max(0, cur.durationMs - pos))}</span>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-5 rounded-[14px] bg-black/20 p-4 text-[14px] text-white/80">Nothing playing yet — search below and pick the first song for everyone.</p>
            )}

            {cur && (
              <div className="mt-4 flex items-center gap-2">
                <IconButton label="Previous" tone="art" size={42} disabled={!canControl} onClick={() => void prev()}>
                  <BackwardGlyph size={20} />
                </IconButton>
                <IconButton label={room.isPlaying ? "Pause" : "Play"} tone="art" size={50} disabled={!canControl} onClick={() => void togglePlay()} className="!bg-white !text-black">
                  {room.isPlaying || isPlaying ? <PauseGlyph size={24} /> : <PlayGlyph size={24} />}
                </IconButton>
                <IconButton label="Next" tone="art" size={42} disabled={!canControl} onClick={() => void next(true)}>
                  <ForwardGlyph size={20} />
                </IconButton>
              </div>
            )}
          </div>

          {/* invite */}
          <div className="flex flex-col items-start gap-3 desk:items-end">
            <div className="text-[11px] font-semibold tracking-[0.1em] text-white/65 uppercase">Room code</div>
            <button
              type="button"
              onClick={async () => {
                await copyText(room.code);
                useUi.getState().pushToast({ title: "Code copied", desc: room.code, kind: "ok" });
              }}
              className="rounded-[14px] bg-black/25 px-4 py-2 font-mono text-[30px] font-bold tracking-[0.25em] backdrop-blur-xl hover:bg-black/35"
              title="Copy code"
            >
              {room.code}
            </button>
            <div className="flex gap-2">
              <Button size="sm" className="!bg-white !text-black" onClick={() => void share()}>
                <Share2 size={14} /> Invite
              </Button>
              <Button
                size="sm"
                className="!bg-white/15 !text-white"
                onClick={async () => {
                  await copyText(url);
                  useUi.getState().pushToast({ title: "Link copied", desc: url, kind: "ok" });
                }}
              >
                <Copy size={14} /> Link
              </Button>
              <Button size="sm" className="!bg-white/15 !text-white" onClick={() => setQrOpen(true)}>
                <QrCode size={14} /> QR
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 px-4 desk:grid-cols-[minmax(0,1fr)_340px] desk:px-8">
        <div className="min-w-0 space-y-6">
          {canControl ? (
            <AddSongs />
          ) : (
            <p className="rounded-[14px] bg-fill p-4 text-[14px] text-fg-2">The host is controlling the music. Sit back — you&apos;re hearing exactly what they hear.</p>
          )}
          <section>
            <h2 className="t-section mb-1 px-1">Up next</h2>
            <div className="-mx-1">
              <QueueList variant="panel" />
            </div>
          </section>
        </div>

        <div className="space-y-6">
          <section>
            <h2 className="t-section mb-2 px-1">People</h2>
            <div className="overflow-hidden rounded-[14px] bg-raised ring-1 ring-edge">
              {room.members.map((m) => {
                const ago = presence[m.id] ?? 0;
                const away = ago > ROOM_LIMITS.awayMs;
                return (
                  <div key={m.id} className="flex items-center gap-3 px-3.5 py-2.5 [&+&]:shadow-[inset_0_0.5px_0_var(--hairline)]">
                    <span
                      className={cx(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-full text-[14px] font-bold text-white",
                        away ? "bg-fill-3" : "bg-gradient-to-br from-[#ff5b6e] to-[#a0142a]"
                      )}
                    >
                      {m.name.charAt(0).toUpperCase()}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-[14.5px]">
                        <span className="truncate">{m.name}</span>
                        {m.id === you && <span className="rounded-full bg-fill-2 px-1.5 py-[1px] text-[10px] font-bold text-fg-2">You</span>}
                        {m.id === room.hostId && <Crown size={13} className="shrink-0 text-[#f5c451]" aria-label="Host" />}
                      </div>
                      <div className="text-[12px] text-fg-2">{away ? "Away — their spot is held" : m.id === room.hostId ? "Host" : `Joined ${timeAgo(m.joinedAt)}`}</div>
                    </div>
                    {isHost && m.id !== you && (
                      <IconButton label={`Remove ${m.name}`} size={30} className="text-fg-2" onClick={() => void sendControl({ type: "kick", memberId: m.id })}>
                        <UserMinus size={15} />
                      </IconButton>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="mt-2 px-1 text-[12px] text-fg-2">
              A room holds {room.maxMembers} people. {room.hostOnly ? "Only the host controls the music." : "Anyone in it can control the music."}
            </p>
          </section>

          <section>
            <h2 className="t-section mb-2 px-1">Room</h2>
            <div className="overflow-hidden rounded-[14px] bg-raised ring-1 ring-edge [&>*+*]:shadow-[inset_0_0.5px_0_var(--hairline)]">
              <label className="flex items-center gap-3 px-3.5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px]">AutoPlay</span>
                  <span className="block text-[12px] text-fg-2">Keep similar songs coming when the queue ends</span>
                </span>
                <Switch checked={room.autoplay} disabled={!canControl} onChange={(v) => void sendControl({ type: "setAutoplay", on: v })} label="AutoPlay" />
              </label>
              {isHost && (
                <>
                  <label className="flex items-center gap-3 px-3.5 py-3">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px]">Only I control the music</span>
                      <span className="block text-[12px] text-fg-2">Others can still listen and see the queue</span>
                    </span>
                    <Switch checked={room.hostOnly} onChange={(v) => void sendControl({ type: "setHostOnly", on: v })} label="Host-only control" />
                  </label>
                  <div className="flex items-center gap-3 px-3.5 py-3">
                    <span className="min-w-0 flex-1 text-[14.5px]">Room size</span>
                    <IconButton
                      label="Smaller"
                      tone="fill"
                      size={30}
                      disabled={room.maxMembers <= Math.max(ROOM_LIMITS.minMembers, room.members.length)}
                      onClick={() => void sendControl({ type: "setCapacity", max: room.maxMembers - 1 })}
                    >
                      <Minus size={14} />
                    </IconButton>
                    <span className="w-6 text-center text-[15px] font-semibold tabular-nums">{room.maxMembers}</span>
                    <IconButton
                      label="Bigger"
                      tone="fill"
                      size={30}
                      disabled={room.maxMembers >= ROOM_LIMITS.maxMembers}
                      onClick={() => void sendControl({ type: "setCapacity", max: room.maxMembers + 1 })}
                    >
                      <Plus size={14} />
                    </IconButton>
                  </div>
                </>
              )}
              <button
                type="button"
                onClick={async () => {
                  await leaveRoom();
                  router.push("/rooms");
                }}
                className="flex w-full items-center gap-3 px-3.5 py-3 text-left hover:bg-fill"
              >
                <LogOut size={17} className="text-fg-2" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[14.5px]">Leave the room</span>
                  <span className="block text-[12px] text-fg-2">The others carry on listening</span>
                </span>
              </button>
              {isHost && (
                <button type="button" onClick={() => setConfirmEnd(true)} className="flex w-full items-center gap-3 px-3.5 py-3 text-left text-danger hover:bg-fill">
                  <X size={17} />
                  <span className="text-[14.5px]">End the room for everyone</span>
                </button>
              )}
            </div>
          </section>

          <Activity room={room} />
        </div>
      </div>

      <Sheet open={qrOpen} onClose={() => setQrOpen(false)} title="Scan to join" subtitle={`Room ${room.code}`} width={380}>
        <RoomQr url={url} />
        <p className="mt-3 text-center text-[12.5px] break-all text-fg-2">{url}</p>
      </Sheet>
      <Sheet open={confirmEnd} onClose={() => setConfirmEnd(false)} title="End the room?" subtitle="Everyone will be let go. Their music keeps playing on their own devices." width={400}>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => setConfirmEnd(false)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              setConfirmEnd(false);
              await sendControl({ type: "end" });
              router.push("/rooms");
            }}
          >
            End room
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

function Activity({ room }: { room: RoomState }) {
  const items = [...room.activity].reverse().slice(0, 12);
  if (!items.length) return null;
  return (
    <section>
      <h2 className="t-section mb-2 px-1">Activity</h2>
      <ul className="space-y-1.5 px-1">
        {items.map((a, i) => (
          <li key={`${a.at}-${i}`} className="flex gap-2 text-[13px]">
            <span className="shrink-0 text-fg-3 tabular-nums">{new Date(a.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}</span>
            <span className="min-w-0 text-fg-2">
              <span className="font-semibold text-fg">{a.by}</span> {a.text}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoomQr({ url }: { url: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode").then((QR) =>
      QR.toDataURL(url, { margin: 1, width: 520, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }).then((d) => alive && setSrc(d))
    );
    return () => {
      alive = false;
    };
  }, [url]);
  return (
    <div className="mx-auto aspect-square w-full max-w-[280px] overflow-hidden rounded-[16px] bg-white p-3">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="QR code to join the room" className="h-full w-full" />
      ) : (
        <Skeleton className="h-full w-full rounded-[8px]" />
      )}
    </div>
  );
}

function AddSongs() {
  const region = useSettings((s) => s.region);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [added, setAdded] = useState<Record<string, boolean>>({});
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);
  const { data, isFetching } = useQuery({
    queryKey: ["room-search", term, region],
    queryFn: () => api.search(term, "songs", region, 12),
    enabled: !!term,
    staleTime: 60_000,
  });
  const results = useMemo(() => data?.songs ?? [], [data]);
  const add = (t: Track) => {
    addToQueueEnd(t);
    setAdded((a) => ({ ...a, [t.id]: true }));
  };
  return (
    <section>
      <h2 className="t-section mb-2 px-1">Add songs</h2>
      <div className="relative">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search songs to add for everyone"
          aria-label="Search songs to add"
          className="field h-11 w-full pr-10 text-[15px]"
        />
        {isFetching && <Loader2 size={16} className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-fg-2" />}
      </div>
      {term && results.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-[14px] bg-raised ring-1 ring-edge">
          {results.map((t) => (
            <div key={t.id} className="flex items-center gap-3 px-3 py-2 [&+&]:shadow-[inset_0_0.5px_0_var(--hairline)]">
              <Artwork src={t.artwork} size={44} rounded="rounded-[6px]" className="h-11 w-11" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[14.5px]">{t.title}</div>
                <div className="truncate text-[12.5px] text-fg-2">{t.artist}</div>
              </div>
              <IconButton label="Play now for everyone" size={34} className="text-fg-2" onClick={() => playTrackNow(t)}>
                <PlayGlyph size={16} />
              </IconButton>
              <IconButton label={added[t.id] ? "Added" : "Add to the room queue"} tone="fill" size={34} onClick={() => add(t)} disabled={added[t.id]}>
                {added[t.id] ? <Check size={16} /> : <ListPlus size={16} />}
              </IconButton>
            </div>
          ))}
        </div>
      )}
      {term && !isFetching && results.length === 0 && <p className="mt-3 px-1 text-[13px] text-fg-2">No songs found for “{term}”.</p>}
    </section>
  );
}
