import { Skeleton } from "@/components/ui/skeleton";

type Props = {
  /** Nombre de lignes à afficher. Défaut: 8. */
  rows?: number;
  /** Affiche le bouton d'action dans le header. Défaut: true. */
  withAction?: boolean;
};

export function TableSkeleton({ rows = 8, withAction = true }: Props) {
  const rowIds = Array.from({ length: rows }, (_, i) => `r${i}`);
  const headerCells = ["h1", "h2", "h3", "h4"];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-72" />
        </div>
        {withAction ? <Skeleton className="h-9 w-36" /> : null}
      </div>
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-9 w-72" />
      <div className="rounded-lg border bg-card">
        <div className="grid grid-cols-4 gap-4 border-b p-3">
          {headerCells.map((id) => (
            <Skeleton key={id} className="h-4 w-3/4" />
          ))}
        </div>
        <div className="divide-y">
          {rowIds.map((id) => (
            <div key={id} className="grid grid-cols-4 gap-4 p-3">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-4 w-1/2" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
