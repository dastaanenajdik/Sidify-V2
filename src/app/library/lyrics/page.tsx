"use client";

import { useState } from "react";
import { Play, Search } from "lucide-react";
import type { Track } from "@/lib/types";
import { usePlayer, currentTrack } from "@/store/player";
import LyricsPane from "@/components/player/LyricsPane";
import { Button, EmptyState, PageTitle } from "@/components/ui";
import { LyricsGlyph } from "@/components/icons";

/** Find the words to any song — no need to play it first. */
export default function LyricsFinderPage() {
  const playing = usePlayer((s) => currentTrack(s));
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [target, setTarget] = useState<Track | null>(null);

  const find = (t: string, a: string) => {
    if (!t.trim()) return;
    setTarget({ id: `finder:${t.trim().toLowerCase()}|${a.trim().toLowerCase()}`, title: t.trim(), artist: a.trim(), artwork: "", previewUrl: "", durationMs: 0 });
  };

  const following = !!target && !!playing && target.id === playing.id;

  return (
    <div className="fade-up">
      <PageTitle>Lyrics</PageTitle>
      <div className="px-4 desk:px-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            find(title, artist);
          }}
          className="flex max-w-[760px] flex-col gap-2 sm:flex-row"
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Song title" aria-label="Song title" maxLength={200} className="field h-11 min-w-0 flex-1 text-[15px]" />
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="Singer (optional)" aria-label="Singer" maxLength={200} className="field h-11 text-[15px] sm:w-[220px]" />
          <Button type="submit" size="lg" className="h-11" disabled={!title.trim()}>
            <Search size={16} /> Find
          </Button>
        </form>
        {playing && (
          <button
            type="button"
            onClick={() => {
              setTitle(playing.title);
              setArtist(playing.artist);
              setTarget(playing);
            }}
            className="mt-3 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-playing hover:opacity-80"
          >
            <Play size={13} fill="currentColor" /> Use the playing song — {playing.title}
          </button>
        )}
      </div>

      {target ? (
        <div className="mx-4 mt-6 flex h-[64vh] min-h-[360px] max-w-[760px] flex-col rounded-[18px] bg-raised p-5 ring-1 ring-edge desk:mx-8">
          <div className="mb-2">
            <div className="truncate text-[17px] font-semibold">{target.title}</div>
            <div className="truncate text-[13.5px] text-fg-2">
              {target.artist || "Any singer"}
              {following ? " · following playback" : ""}
            </div>
          </div>
          <LyricsPane key={target.id} track={target} variant="page" allowSynced={following} className="min-h-0 flex-1" />
        </div>
      ) : (
        <EmptyState
          icon={<LyricsGlyph size={28} />}
          title="Find any song's lyrics"
          desc="Type a song name — copy the words, or follow along line by line with the song that's playing."
        />
      )}
    </div>
  );
}
