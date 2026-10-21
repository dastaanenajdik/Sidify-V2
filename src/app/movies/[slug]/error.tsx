"use client";

import { Clapperboard } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

/** A provider outage is not a 404 — offer a retry instead. */
export default function MovieDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={<Clapperboard size={26} />}
      className="pt-24"
      title="Couldn't load this film"
      desc="The catalogue provider didn't answer. Check your connection and try again."
      action={
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
