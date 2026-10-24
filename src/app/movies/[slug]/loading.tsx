import { Skeleton } from "@/components/ui";

export default function MediaDetailLoading() {
  return (
    <div className="fade-up pb-12" aria-busy="true" aria-label="Loading title details">
      <div className="relative h-[400px] sm:h-[440px] desk:h-[470px] w-full overflow-hidden bg-raised">
        <Skeleton className="h-full w-full rounded-none" />
      </div>
      <div className="mx-auto max-w-[1280px] space-y-6 px-4 pt-6 desk:px-8">
        <div className="space-y-3">
          <Skeleton className="h-9 w-2/3 max-w-[420px] rounded-[10px]" />
          <Skeleton className="h-4 w-1/2 max-w-[280px] rounded-[6px]" />
          <Skeleton className="h-16 w-full max-w-[640px] rounded-[10px]" />
        </div>
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-11 w-36 rounded-full" />
          <Skeleton className="h-11 w-36 rounded-full" />
          <Skeleton className="h-11 w-11 rounded-full" />
        </div>
        <div className="space-y-3 pt-4">
          <Skeleton className="h-6 w-40 rounded-[8px]" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-[14px]" />
          ))}
        </div>
      </div>
    </div>
  );
}
