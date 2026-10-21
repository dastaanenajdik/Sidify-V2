import { Clapperboard } from "lucide-react";
import { ButtonLink, EmptyState } from "@/components/ui";

/** Shared 404 for a movie/series slug that the provider doesn't know. */
export function MediaNotFound({ kind }: { kind: "movie" | "series" }) {
  return (
    <EmptyState
      icon={<Clapperboard size={26} />}
      className="pt-24"
      title={kind === "movie" ? "We couldn't find that film" : "We couldn't find that series"}
      desc="It may have been removed from the catalogue, or the link may be wrong."
      action={<ButtonLink href={kind === "movie" ? "/movies" : "/series"}>Browse {kind === "movie" ? "movies" : "series"}</ButtonLink>}
    />
  );
}
