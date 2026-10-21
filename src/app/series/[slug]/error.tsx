"use client";

import { Clapperboard } from "lucide-react";
import { Button, EmptyState } from "@/components/ui";

export default function SeriesDetailError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={<Clapperboard size={26} />}
      className="pt-24"
      title="Couldn't load this series"
      desc="The catalogue provider didn't answer. Check your connection and try again."
      action={
        <Button variant="secondary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
