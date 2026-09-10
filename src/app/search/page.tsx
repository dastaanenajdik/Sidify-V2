"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Clock, Mic, Search as SearchIcon, TrendingUp, X } from "lucide-react";
import { api } from "@/lib/clientApi";
import { useSettings } from "@/store/settings";
import { playContext } from "@/lib/audioEngine";
import TrackRow from "@/components/TrackRow";
import { AlbumCard, ArtistCard } from "@/components/cards";
import type { Track } from "@/lib/types";
import { cx } from "@/lib/format";

const CATEGORY_TILES = [
  { name: "Top Hits", q: "top hits", g: "from-rose-500 to-red-700" },
  { name: "Bollywood", q: "bollywood hits", g: "from-amber-400 to-orange-600" },
  { name: "K-Pop", q: "kpop", g: "from-violet-400 to-purple-700" },
  { name: "Hip-Hop", q: "hip hop", g: "from-slate-500 to-zinc-800" },
  { name: "EDM", q: "edm festival", g: "from-cyan-400 to-blue-600" },
  { name: "Indie", q: "indie pop", g: "from-emerald-400 to-teal-700" },
  { name: "Jazz", q: "jazz classics", g: "from-yellow-400 to-amber-700" },
  { name: "Punjabi", q: "punjabi hits", g: "from-lime-400 to-green-700" },
  { name: "Rock", q: "rock anthems", g: "from-red-500 to-rose-800" },
  { name: "90s Throwback", q: "90s hits", g: "from-fuchsia-400 to-pink-700" },
  { name: "Acoustic", q: "acoustic covers", g: "from-sky-400 to-indigo-600" },
  { name: "Sad Hours", q: "sad songs", g: "from-blue-500 to-slate-700" },
];

const HISTORY_KEY = "sidify-search-history";

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}
function pushHistory(term: string) {
  try {
    const next = [term, ...loadHistory().filter((t) => t.toLowerCase() !== term.toLowerCase())].slice(0, 8);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {}
}

const TABS = [
  { id: "all", label: "All" },
  { id: "songs", label: "Songs" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
] as const;

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const region = useSettings((s) => s.region);
  const ef = useSettings((s) => s.explicitFilter);
  const [q, setQ] = useState(params.get("q") || "");
  const [debounced, setDebounced] = useState(q);
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("all");
  const [focused, setFocused] = useState(false);
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setHistory(loadHistory());
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const pQ = params.get("q") || "";
    setQ(pQ);
    setDebounced(pQ);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      const url = q.trim() ? `/search?q=${encodeURIComponent(q.trim())}` : "/search";
      router.replace(url, { scroll: false });
    }, 300);
    return () => clearTimeout(t);
  }, [q, router]);

  const { data, isFetching } = useQuery({
    queryKey: ["search", debounced, tab, region],
    queryFn: () => api.search(debounced, tab, region, tab === "songs" ? 30 : 22),
    enabled: !!debounced.trim(),
    staleTime: 60_000,
  });

  const vis = (arr: Track[]) => (ef ? arr.filter((t) => !t.explicit) : arr);
  const songs = vis(data?.songs ?? []);
  const albums = data?.albums ?? [];
  const artists = data?.artists ?? [];

  const submit = (term: string) => {
    if (!term.trim()) return;
    pushHistory(term.trim());
    setHistory(loadHistory());
    setQ(term.trim());
    inputRef.current?.blur();
    setFocused(false);
  };

  return (
    <div className="mx-auto max-w-[1280px] px-4 pt-6 md:px-7">
      {/* search bar */}
      <div className="relative z-20 mx-auto max-w-2xl">
        <div
          className={cx(
            "glass-strong flex items-center gap-3 rounded-2xl px-4 py-3.5 transition-shadow",
            focused && "ring-1 ring-[var(--accent)]"
          )}
          style={focused ? { boxShadow: "0 0 0 4px color-mix(in srgb, var(--accent) 12%, transparent), 0 20px 60px -20px var(--glow)" } : undefined}
        >
          <SearchIcon size={19} className={cx("shrink-0", isFetching ? "accent-text animate-pulse" : "text-muted")} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 160)}
            onKeyDown={(e) => e.key === "Enter" && submit(q)}
            placeholder="Songs, artists, albums…"
            className="min-w-0 flex-1 bg-transparent text-[15.5px] font-medium outline-none placeholder:text-muted-2"
            aria-label="Search music"
          />
          {q && (
            <button aria-label="Clear" onClick={() => setQ("")} className="text-muted hover:text-[var(--text)]">
              <X size={17} />
            </button>
          )}
          <button
            aria-label="Voice search"
            onClick={() => alert("Voice search is available on the Sidify mobile app.")}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full accent-bg text-black transition-transform hover:scale-105"
            title="Voice search"
          >
            <Mic size={16} />
          </button>
        </div>

        {/* live suggestion hint */}
        {focused && q.trim() && !data && (
          <div className="glass-strong absolute top-full right-0 left-0 mt-2 rounded-2xl p-4 text-sm text-muted">
            Typing… live results appear instantly
          </div>
        )}
      </div>

      {/* tabs */}
      {debounced.trim() && (
        <div className="mt-5 flex gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cx(
                "rounded-full border px-4 py-1.5 text-[12.5px] font-semibold transition-all",
                tab === t.id ? "accent-bg border-transparent text-black" : "border-[var(--border)] text-muted hover:text-[var(--text)]"
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* empty state */}
      {!debounced.trim() && (
        <div className="mt-7">
          {history.length > 0 && (
            <div className="mb-7">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-display text-[18px] font-bold">Recent searches</h2>
                <button
                  onClick={() => {
                    localStorage.removeItem(HISTORY_KEY);
                    setHistory([]);
                  }}
                  className="text-muted text-[12px] font-semibold uppercase tracking-wider hover:accent-text"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {history.map((h) => (
                  <button
                    key={h}
                    onClick={() => submit(h)}
                    className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] text-muted transition-colors hover:text-[var(--text)]"
                  >
                    <Clock size={13} /> {h}
                  </button>
                ))}
              </div>
            </div>
          )}
          <h2 className="font-display mb-3 text-[18px] font-bold">Browse categories</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {CATEGORY_TILES.map((c) => (
              <button
                key={c.name}
                onClick={() => submit(c.q)}
                className={`relative h-[110px] overflow-hidden rounded-2xl bg-gradient-to-br ${c.g} p-4 text-left transition-transform hover:scale-[1.03] active:scale-95`}
              >
                <span className="font-display text-[16px] font-bold text-white drop-shadow">{c.name}</span>
                <span className="absolute -right-5 -bottom-6 h-20 w-20 rotate-[22deg] rounded-2xl bg-white/15" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* results */}
      {debounced.trim() && data && (
        <div className="mt-6 space-y-9">
          {(tab === "all" || tab === "songs") && songs.length > 0 && (
            <section>
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp size={16} className="accent-text" />
                <h2 className="font-display text-[18px] font-bold">Songs</h2>
              </div>
              <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2">
                {(tab === "songs" ? songs : songs.slice(0, 6)).map((_, i) => (
                  <TrackRow
                    key={songs[i].id}
                    tracks={songs}
                    index={i}
                    contextLabel={`Results for “${debounced}”`}
                  />
                ))}
              </div>
            </section>
          )}

          {(tab === "all" || tab === "artists") && artists.length > 0 && (
            <section>
              <h2 className="font-display mb-2 text-[18px] font-bold">Artists</h2>
              <div className="grid grid-cols-3 gap-1 sm:grid-cols-4 lg:grid-cols-6">
                {(tab === "artists" ? artists : artists.slice(0, 6)).map((a) => (
                  <ArtistCard key={a.id} artist={a} />
                ))}
              </div>
            </section>
          )}

          {(tab === "all" || tab === "albums") && albums.length > 0 && (
            <section>
              <h2 className="font-display mb-2 text-[18px] font-bold">Albums</h2>
              <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                {(tab === "albums" ? albums : albums.slice(0, 6)).map((a) => (
                  <AlbumCard key={a.id} album={a} />
                ))}
              </div>
            </section>
          )}

          {songs.length + albums.length + artists.length === 0 && (
            <p className="text-muted py-16 text-center text-sm">No results for “{debounced}”. Try a different search.</p>
          )}
        </div>
      )}

      {debounced.trim() && isFetching && !data && (
        <div className="mt-6 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="shimmer h-14 rounded-xl" />
          ))}
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-2xl px-4 pt-8">
          <div className="shimmer h-14 rounded-2xl" />
        </div>
      }
    >
      <SearchInner />
    </Suspense>
  );
}
