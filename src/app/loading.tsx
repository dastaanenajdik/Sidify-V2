import { Skeleton } from "@/components/ui";

export default function AppLoading() {
  return (
    <div className="fade-up space-y-6 px-4 pt-4 desk:px-8 desk:pt-8" aria-busy="true">
      <Skeleton className="h-9 w-48 rounded-[10px]" />
      <div className="flex gap-3.5 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square w-[148px] shrink-0 rounded-[12px] desk:w-[168px]" />
        ))}
      </div>
      <div className="space-y-2.5 pt-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-[54px] w-full rounded-[8px]" />
        ))}
      </div>
    </div>
  );
}
