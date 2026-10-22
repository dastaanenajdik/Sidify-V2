"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Clock, Play, X } from "lucide-react";
import { api } from "@/lib/clientApi";
import { useSettings } from "@/store/settings";
import { playContext } from "@/lib/audioEngine";
import { MOODS } from "@/lib/explore";
import TrackRow from "@/components/TrackRow";
import { AlbumCard, ArtistCard, MoodCard } from "@/components/cards";
import { PosterCard } from "@/components/media/PosterCard";
import { MediaSearchList } from "@/components/media/MediaSearchList";
import { useMediaSearch } from "@/lib/media/hooks";
import type { MediaTitle } from "@/lib/media/types";
import { Artwork, Chips, EmptyState, SectionHeader, Shelf, Skeleton } from "@/components/ui";
import { SearchGlyph } from "@/components/icons";
import type { Album, Artist, Track } from "@/lib/types";
import { cx } from "@/lib/format";
import { useMounted } from "@/lib/useMounted";

const HISTORY_KEY = "sidify-search-history";

function loadHistory(): string[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
  } catch {
    return [];
  }
}
function saveHistory(list: string[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 10)));
  } catch {
    /* ignore */
  }
}
function pushHistory(term: string) {
  const clean = term.trim();
  if (!clean) return;
  saveHistory([clean, ...loadHistory().filter((t) => t.toLowerCase() !== clean.toLowerCase())]);
}

type Tab = "all" | "songs" | "albums" | "artists" | "media";
const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "Top results" },
  { id: "songs", label: "Songs" },
  { id: "albums", label: "Albums" },
  { id: "artists", label: "Artists" },
  { id: "media", label: "Movies & series" },
];

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();
  const region = useSettings((s) => s.region);
  const ef = useSettings((s) => s.explicitFilter);
  const initial = params.get("q") ?? "";
  const [q, setQ] = useState(initial);
  const [debounced, setDebounced] = useState(initial);
  const [tab, setTab] = useState<Tab>("all");
  const mounted = useMounted();
  const [historyState, setHistory] = useState<string[] | null>(null);
  const history = historyState ?? (mounted ? loadHistory() : []);
  const inputRef = useRef<HTMLInputElement>(null);
  /**
   * The query we last wrote into the URL ourselves. Keeping the raw value in the
   * URL and ignoring our own echo keeps typed spaces intact (the debounced echo
   * used to come back trimmed and wipe the space just typed).
   */
  const pushedRef = useRef<string>(initial);
  /** True between a keystroke and the moment its URL update has been written. */
  const editingRef = useRef(false);
  const term = useMemo(() => debounced.trim(), [debounced]);

  useEffect(() => {
    if (window.innerWidth < 980) inputRef.current?.focus();
  }, []);

  // Adopt queries that come from elsewhere (sidebar field, links, back/forward).
  useEffect(() => {
    const pQ = params.get("q") ?? "";
    const mine = pushedRef.current;
    const isEcho = pQ === mine || (pQ.length <= mine.length && pQ.trim() === mine.trim());
    if (isEcho || editingRef.current) return;
    pushedRef.current = pQ;
    setQ(pQ);
    setDebounced(pQ);
  }, [params]);

  // Debounced URL sync from the in-page field.
  useEffect(() => {
    if (!editingRef.current) return;
    const t = setTimeout(() => {
      setDebounced(q);
      pushedRef.current = q;
      router.replace(q ? `/search?q=${encodeURIComponent(q)}` : "/search", { scroll: false });
      editingRef.current = false;
    }, 320);
    return () => clearTimeout(t);
  }, [q, router]);

  // Remember a search once its results have been looked at for a moment.
  useEffect(() => {
    if (!term) return;
    const t = setTimeout(() => {
      pushHistory(term);
      setHistory(loadHistory());
    }, 2500);
    return () => clearTimeout(t);
  }, [term]);

  const musicTab = tab === "media" ? "all" : tab;
  const { data, isFetching, isError } = useQuery({
    queryKey: ["search", term, musicTab, region],
    queryFn: () => api.search(term, musicTab, region, musicTab === "songs" ? 30 : 24),
    enabled: !!term && tab !== "media",
    staleTime: 60_000,
  });

  // Movies & series come from their own catalogue, searched alongside the music. The
  // "Top results" tab shows both together (songs first, films under them); there is also a
  // tab with nothing but posters.
  const media = useMediaSearch(term, tab === "all" || tab === "media", 24);
  const mediaItems = media.data?.items ?? [];
  const mediaLoading = media.isLoading && term.length > 1;
  const songs = (data?.songs ?? []).filter((t) => !ef || !t.explicit);
  const albums = data?.albums ?? [];
  const artists = data?.artists ?? [];
  const label = `Results for “${term}”`;

  const submit = (value: string) => {
    const clean = value.trim();
    if (!clean) return;
    pushHistory(clean);
    setHistory(loadHistory());
    setQ(clean);
    setDebounced(clean);
    pushedRef.current = clean;
    editingRef.current = false;
    router.replace(`/search?q=${encodeURIComponent(clean)}`, { scroll: false });
    inputRef.current?.blur();
  };

  return (
    <div className="fade-up">
      <div className="px-4 pt-2 desk:px-8 desk:pt-7">
        <h1 className="t-display truncate desk:t-headline">
          {term ? (
            <>
              <span className="desk:hidden">Search</span>
              <span className="hidden desk:inline">{term}</span>
            </>
          ) : (
            "Search"
          )}
        </h1>
      </div>

      {/* phone field (desktop uses the sidebar's) */}
      <div className="sticky top-0 z-10 bg-bg/80 px-4 pt-3 pb-3 backdrop-blur-xl desk:hidden">
        <div className="relative">
          <SearchGlyph size={16} className={cx("pointer-events-none absolute top-1/2 left-3 -translate-y-1/2", isFetching ? "text-fg" : "text-fg-2")} />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => {
              editingRef.current = true;
              setQ(e.target.value);
            }}
            onKeyDown={(e) => e.key === "Enter" && submit(q)}
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="Artists, songs, lyrics and more"
            aria-label="Search music"
            className="field h-10 w-full rounded-[10px] pr-9 pl-9 text-[16px]"
          />
          {q && (
            <button
              type="button"
              aria-label="Clear"
              onClick={() => {
                editingRef.current = true;
                setQ("");
                inputRef.current?.focus();
              }}
              className="absolute top-1/2 right-2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full bg-fill-3 text-fg-2"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {term ? (
        <>
          <Chips className="mt-1 mb-5 px-4 desk:mt-3 desk:px-8" value={tab} options={TABS} onChange={setTab} />
          {tab === "media" ? (
            mediaLoading ? (
              <PosterGridSkeleton />
            ) : mediaItems.length === 0 ? (
              <EmptyState
                icon={<SearchGlyph size={26} />}
                title={media.isError ? "Something went wrong" : `No movies or series for “${term}”`}
                desc={media.isError ? "Try again in a moment." : "Check the spelling, or try fewer words."}
              />
            ) : (
              <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {mediaItems.map((item) => (
                  <PosterCard key={`${item.kind}-${item.id}`} title={item} className="!w-auto" />
                ))}
              </div>
            )
          ) : isFetching && !data ? (
            <ResultsSkeleton />
          ) : isError && tab !== "all" ? (
            <EmptyState title="Search isn't responding" desc="Check your connection and try again." />
          ) : songs.length + albums.length + artists.length === 0 && mediaItems.length === 0 && (tab !== "all" || !mediaLoading) ? (
            <EmptyState
              icon={<SearchGlyph size={26} />}
              title={isError ? "Search isn't responding" : `No results for “${term}”`}
              desc={isError ? "Check your connection and try again." : "Check the spelling, or try fewer words."}
            />
          ) : tab === "all" ? (
            <AllResults
              songs={songs}
              albums={albums}
              artists={artists}
              label={label}
              media={mediaItems}
              mediaLoading={mediaLoading}
              musicError={isError}
              onSeeAllMedia={() => setTab("media")}
            />
          ) : tab === "songs" ? (
            <div className="px-2 desk:px-6">
              {songs.map((t, i) => (
                <TrackRow key={t.id} tracks={songs} index={i} contextLabel={label} />
              ))}
            </div>
          ) : tab === "albums" ? (
            <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {albums.map((a) => (
                <AlbumCard key={a.id} album={a} className="!w-auto" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
              {artists.map((a) => (
                <ArtistCard key={a.id} artist={a} className="!w-auto" />
              ))}
            </div>
          )}
        </>
      ) : (
        <Browse
          history={history}
          onPick={submit}
          onRemove={(h) => {
            const next = history.filter((x) => x !== h);
            saveHistory(next);
            setHistory(next);
          }}
          onClear={() => {
            saveHistory([]);
            setHistory([]);
          }}
        />
      )}
    </div>
  );
}

function AllResults({
  songs,
  albums,
  artists,
  label,
  media,
  mediaLoading,
  musicError,
  onSeeAllMedia,
}: {
  songs: Track[];
  albums: Album[];
  artists: Artist[];
  label: string;
  media: MediaTitle[];
  mediaLoading: boolean;
  musicError: boolean;
  onSeeAllMedia: () => void;
}) {
  const top =
    artists[0] && (!songs[0] || songs[0].artist.toLowerCase() === artists[0].name.toLowerCase())
      ? { kind: "artist" as const, artist: artists[0] }
      : songs[0]
        ? { kind: "song" as const, track: songs[0] }
        : null;
  // Movies & series live in this same block — songs above, posters below — at every width,
  // so one search answers both without hunting for another tab or a side column.
  const showMedia = mediaLoading || media.length > 0;
  const twoUp = Boolean(top) && (songs.length > 0 || showMedia);

  return (
    <div className="space-y-9">
      {(top || songs.length > 0 || showMedia) && (
        <div className={cx("grid grid-cols-1 gap-6 px-4 desk:px-8", twoUp && "2xl:grid-cols-[minmax(300px,420px)_1fr]")}>
          {top && (
            <section>
              <h2 className="t-section mb-3">Top result</h2>
              {top.kind === "artist" ? (
                <Link
                  href={`/artist/${encodeURIComponent(top.artist.id)}`}
                  className="group flex items-center gap-5 rounded-[18px] bg-raised p-5 ring-1 ring-edge transition-colors hover:bg-raised-2"
                >
                  <Artwork src={top.artist.artwork} size={110} round className="h-[110px] w-[110px] shrink-0" />
                  <div className="min-w-0">
                    <div className="truncate text-[24px] font-bold tracking-[-0.4px]">{top.artist.name}</div>
                    <div className="text-[14px] text-fg-2">Artist</div>
                  </div>
                </Link>
              ) : (
                <div className="group relative flex items-center gap-5 rounded-[18px] bg-raised p-5 ring-1 ring-edge">
                  <Artwork
                    src={top.track.artwork}
                    size={110}
                    rounded="rounded-[10px]"
                    className="h-[110px] w-[110px] shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-[22px] leading-tight font-bold tracking-[-0.4px]">
                      {top.track.title}
                    </div>
                    <div className="mt-1 truncate text-[14px] text-fg-2">Song · {top.track.artist}</div>
                  </div>
                  <button
                    type="button"
                    aria-label={`Play ${top.track.title}`}
                    onClick={() => playContext(songs, 0, label)}
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-transform hover:scale-105"
                  >
                    <Play size={20} fill="currentColor" className="ml-0.5" />
                  </button>
                </div>
              )}
            </section>
          )}

          {(songs.length > 0 || showMedia) && (
            <section className="min-w-0" aria-label="Songs and movies & series">
              {songs.length > 0 && (
                <>
                  <h2 className="t-section mb-1.5">Songs</h2>
                  <div className="-mx-2">
                    {songs.slice(0, 5).map((t, i) => (
                      <TrackRow key={t.id} tracks={songs} index={i} contextLabel={label} />
                    ))}
                  </div>
                </>
              )}
              {showMedia && (
                <div className={cx(songs.length > 0 && "mt-5")}>
                  <MediaSearchList
                    items={media}
                    loading={mediaLoading}
                    onSeeAll={media.length > 0 ? onSeeAllMedia : undefined}
                    limit={8}
                    columns={2}
                  />
                </div>
              )}
            </section>
          )}
        </div>
      )}

      {artists.length > 0 && (
        <section>
          <SectionHeader title="Artists" />
          <Shelf>
            {artists.slice(0, 12).map((a) => (
              <ArtistCard key={a.id} artist={a} />
            ))}
          </Shelf>
        </section>
      )}

      {albums.length > 0 && (
        <section>
          <SectionHeader title="Albums" />
          <Shelf>
            {albums.slice(0, 14).map((a) => (
              <AlbumCard key={a.id} album={a} />
            ))}
          </Shelf>
        </section>
      )}

      {!top && songs.length + artists.length + albums.length === 0 && !showMedia && (
        <p className="px-4 text-[14px] text-fg-2 desk:px-8">
          {musicError ? "Music search isn't responding right now." : "No songs, albums or artists match this search."}
        </p>
      )}
    </div>
  );
}

function Browse({
  history,
  onPick,
  onRemove,
  onClear,
}: {
  history: string[];
  onPick: (q: string) => void;
  onRemove: (q: string) => void;
  onClear: () => void;
}) {
  const covers = useQuery({ queryKey: ["explore"], queryFn: api.explore, staleTime: 6 * 60 * 60_000 });
  return (
    <div className="mt-2 space-y-9">
      {history.length > 0 && (
        <section className="px-4 desk:px-8">
          <div className="mb-1 flex items-center justify-between">
            <h2 className="t-section">Recently searched</h2>
            <button type="button" onClick={onClear} className="text-[14px] font-semibold text-playing hover:opacity-80">
              Clear
            </button>
          </div>
          <div className="max-w-[640px]">
            {history.map((h) => (
              <div key={h} className="group flex h-12 items-center gap-3 shadow-[inset_0_-0.5px_0_var(--hairline)]">
                <Clock size={17} className="shrink-0 text-fg-2" />
                <button type="button" onClick={() => onPick(h)} className="min-w-0 flex-1 truncate text-left text-[15px]">
                  {h}
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${h}`}
                  onClick={() => onRemove(h)}
                  className="grid h-8 w-8 place-items-center rounded-full text-fg-2 hover:bg-fill hover:text-fg"
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
      <section>
        <SectionHeader title="Browse categories" />
        <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 2xl:grid-cols-5">
          {MOODS.map((m) => (
            <MoodCard key={m.slug} title={m.title} color={m.color} artwork={covers.data?.covers[m.slug]} href={`/explore/${m.slug}`} />
          ))}
        </div>
      </section>
    </div>
  );
}

function PosterGridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-x-3.5 gap-y-6 px-4 sm:grid-cols-3 desk:px-8 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i}>
          <Skeleton className="aspect-[2/3] w-full rounded-[10px]" />
          <Skeleton className="mt-2 h-3.5 w-3/4 rounded" />
        </div>
      ))}
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div className="space-y-2 px-4 desk:px-8">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="h-[52px] w-[52px] shrink-0 rounded-[6px]" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-2/5 rounded" />
            <Skeleton className="h-3 w-1/4 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="px-4 pt-4 desk:px-8">
          <Skeleton className="h-10 w-full rounded-[10px]" />
        </div>
      }
    >
      <SearchInner />
    </Suspense>
  );
}
