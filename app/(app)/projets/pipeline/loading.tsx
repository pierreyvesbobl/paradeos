import { Skeleton } from "@/components/ui/skeleton";

const COLUMNS = ["c1", "c2", "c3", "c4", "c5"];
const CARDS = ["a", "b", "c"];

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-9 w-36" />
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {COLUMNS.map((col) => (
          <div key={col} className="space-y-3 rounded-lg border bg-card p-3">
            <Skeleton className="h-4 w-2/3" />
            {CARDS.map((c) => (
              <Skeleton key={c} className="h-20" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
