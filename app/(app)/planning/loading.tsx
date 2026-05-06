import { Skeleton } from "@/components/ui/skeleton";

const DAYS = ["d1", "d2", "d3", "d4", "d5", "d6", "d7"];

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-9" />
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-9" />
        </div>
      </div>
      <div className="rounded-lg border bg-card">
        <div className="grid grid-cols-7 gap-px border-b bg-border">
          {DAYS.map((d) => (
            <div key={d} className="space-y-2 bg-card p-3">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-5 w-8" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border">
          {DAYS.map((d) => (
            <div key={d} className="min-h-[400px] space-y-2 bg-card p-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
