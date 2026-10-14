"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { createRoom, joinRoom, leaveRoom, useRoomSummary } from "@/lib/rooms/client";
import { normalizeCode, CODE_LENGTH, ROOM_LIMITS } from "@/lib/rooms/logic";
import { usePlayer, currentTrack } from "@/store/player";
import { useSettings } from "@/store/settings";
import { Artwork, Button, Switch } from "@/components/ui";
import { PeopleGlyph } from "@/components/icons";

export default function RoomsPage() {
  const router = useRouter();
  const room = useRoomSummary();
  const playing = usePlayer((s) => currentTrack(s));
  const profileName = useSettings((s) => s.profileName);
  const [hostOnly, setHostOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");
  // Until the listener types here, the field follows the saved name — the
  // first-visit gate may save it after this page has mounted.
  const [typedName, setTypedName] = useState<string | null>(null);
  const name = typedName ?? (profileName === "Siddharth" ? "" : profileName);
  const setName = (v: string) => setTypedName(v);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setCreating(true);
    const c = await createRoom({ name, hostOnly });
    setCreating(false);
    if (c) router.push(`/rooms/${c}`);
  };

  const join = async () => {
    const c = normalizeCode(code);
    if (c.length !== CODE_LENGTH) {
      setError("Codes are six letters or digits");
      return;
    }
    setJoining(true);
    setError(null);
    const res = await joinRoom(c, name);
    setJoining(false);
    if (res.ok) router.push(`/rooms/${c}`);
    else setError(res.error ?? "Couldn't join that room");
  };

  return (
    <div className="fade-up mx-auto max-w-[880px] px-4 pt-6 desk:px-8 desk:pt-10">
      <div className="mb-8 flex flex-col items-center text-center">
        <span className="mb-4 grid h-20 w-20 place-items-center rounded-full bg-brand text-white shadow-[0_18px_50px_-12px_rgba(250,45,72,.6)]">
          <PeopleGlyph size={40} />
        </span>
        <h1 className="t-display desk:t-headline">Listen Together</h1>
        <p className="mt-2 max-w-[440px] text-[15px] text-fg-2">Share a code and play the same music, in time — on phones, laptops, anywhere.</p>
      </div>

      {room.inRoom && room.room && (
        <div className="mb-6 flex items-center gap-4 rounded-[18px] bg-brand/12 p-4 ring-1 ring-brand/30">
          <span className="live-dot h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">You&apos;re in {room.room.name}</div>
            <div className="text-[13px] text-fg-2">
              Code {room.code} · {room.count} listening
            </div>
          </div>
          <Button size="sm" onClick={() => router.push(`/rooms/${room.code}`)}>
            Open
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void leaveRoom()}>
            Leave
          </Button>
        </div>
      )}

      <div className="grid gap-4 desk:grid-cols-2">
        <section className="flex flex-col rounded-[18px] bg-raised p-5 ring-1 ring-edge">
          <h2 className="t-title">Start a room</h2>
          <p className="mt-1 text-[14px] text-fg-2">Get a code to share with friends.</p>
          {playing && (
            <div className="mt-4 flex items-center gap-3 rounded-[12px] bg-fill p-2.5">
              <Artwork src={playing.artwork} size={40} rounded="rounded-[6px]" className="h-10 w-10" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] font-medium">{playing.title}</div>
                <div className="text-[12px] text-fg-2">carries into the room</div>
              </div>
            </div>
          )}
          <label className="mt-4 flex items-center gap-3">
            <span className="min-w-0 flex-1">
              <span className="block text-[15px]">Only I control the music</span>
              <span className="block text-[12.5px] text-fg-2">Others listen; you can share the controls later.</span>
            </span>
            <Switch checked={hostOnly} onChange={setHostOnly} label="Only I control the music" />
          </label>
          <div className="mt-auto pt-5">
            <Button size="lg" className="w-full" onClick={() => void start()} disabled={creating}>
              {creating ? <Loader2 size={18} className="animate-spin" /> : <PeopleGlyph size={18} />} Start a room
            </Button>
            <p className="mt-2.5 text-[12px] leading-relaxed text-fg-2">
              You get a six-character code. Anyone who has it can join — up to {ROOM_LIMITS.defaultMembers} people including you (you can raise it to{" "}
              {ROOM_LIMITS.maxMembers}).
            </p>
          </div>
        </section>

        <section className="flex flex-col rounded-[18px] bg-raised p-5 ring-1 ring-edge">
          <h2 className="t-title">Join a room</h2>
          <p className="mt-1 text-[14px] text-fg-2">Enter the code a friend shared.</p>
          <form
            className="mt-4 flex flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <input
              value={code}
              onChange={(e) => {
                setError(null);
                setCode(normalizeCode(e.target.value));
              }}
              placeholder="ABC123"
              aria-label="Room code"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              className="field h-14 w-full text-center font-mono text-[26px] font-bold tracking-[0.42em] uppercase placeholder:tracking-[0.42em] placeholder:text-fg-3"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              aria-label="Your name"
              maxLength={24}
              className="field mt-2.5 h-11 w-full text-[15px]"
            />
            {error && <p className="mt-2 text-[13px] font-medium text-danger">{error}</p>}
            <div className="mt-auto pt-5">
              <Button size="lg" variant="secondary" className="w-full" type="submit" disabled={joining || code.length !== CODE_LENGTH}>
                {joining ? <Loader2 size={18} className="animate-spin" /> : <ArrowRight size={18} />} Join
              </Button>
              <p className="mt-2.5 text-[12px] leading-relaxed text-fg-2">Read it out or send it. O and I aren&apos;t used, so an “oh” is always a zero.</p>
            </div>
          </form>
        </section>
      </div>

      <section className="mt-10 grid gap-4 sm:grid-cols-3">
        {[
          ["Same song, same second", "Everyone's player follows one clock, so the beat drops together."],
          ["Anyone can DJ", "Queue songs, skip and pause from any device — or keep the controls to yourself."],
          ["Never runs dry", "When the queue ends, AutoPlay keeps similar music coming for the whole room."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-[16px] bg-fill p-4">
            <div className="text-[15px] font-semibold">{t}</div>
            <div className="mt-1 text-[13px] leading-relaxed text-fg-2">{d}</div>
          </div>
        ))}
      </section>

      <p className="mt-8 text-center text-[12.5px] text-fg-3">
        Rooms close on their own when everyone has left. <Link href="/settings#together" className="underline">Room settings</Link>
      </p>
    </div>
  );
}
