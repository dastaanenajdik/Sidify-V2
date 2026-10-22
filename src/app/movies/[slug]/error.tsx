"use client";

import { Clapperboard } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";
import { SOMETHING_WENT_WRONG } from "@/lib/media/userError";

/**
 * A provider outage is not a 404 — offer a retry instead. Shared by /movies/[slug] and
 * /series/[slug]; the underlying error is never rendered.
 */
export default function MovieDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={<Clapperboard size={26} />}
      className="pt-24"
      title={SOMETHING_WENT_WRONG}
      action={
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
