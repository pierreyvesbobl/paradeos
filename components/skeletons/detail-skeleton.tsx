import { Skeleton } from "@/components/ui/skeleton";

function SectionBlock({ lines = 3 }: { lines?: number }) {
  const widths = ["w-full", "w-4/5", "w-3/5", "w-2/3", "w-1/2"];
  const rows = Array.from({ length: lines }, (_, i) => ({
    id: `l${i}`,
    width: widths[i % widths.length],
  }));
  return (
    <div className="space-y-3 rounded-lg border bg-card p-6">
      <Skeleton className="h-4 w-28" />
      <div className="space-y-2 pt-1">
        {rows.map((r) => (
          <Skeleton key={r.id} className={`h-3 ${r.width}`} />
        ))}
      </div>
    </div>
  );
}

type Props = {
  /** Layout deux colonnes (main + sidebar) ou une seule. Défaut: true. */
  withSidebar?: boolean;
};

export function DetailSkeleton({ withSidebar = true }: Props) {
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
      {withSidebar ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <SectionBlock lines={3} />
            <SectionBlock lines={4} />
            <SectionBlock lines={3} />
          </div>
          <div className="space-y-6">
            <SectionBlock lines={2} />
            <SectionBlock lines={3} />
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <SectionBlock lines={3} />
          <SectionBlock lines={4} />
          <SectionBlock lines={3} />
        </div>
      )}
    </div>
  );
}
