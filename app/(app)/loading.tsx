import { Skeleton } from "@/components/ui/skeleton";

const KPIS = ["k1", "k2", "k3", "k4"];
const ITEMS = ["i1", "i2", "i3", "i4"];

export default function Loading() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-56" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KPIS.map((id) => (
          <div key={id} className="space-y-3 rounded-lg border bg-card p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border bg-card p-6">
          <Skeleton className="h-5 w-40" />
          <ul className="divide-y">
            {ITEMS.map((id) => (
              <li key={id} className="space-y-2 py-3">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </li>
            ))}
          </ul>
        </div>
        <div className="space-y-3 rounded-lg border bg-card p-6">
          <Skeleton className="h-5 w-40" />
          <ul className="divide-y">
            {ITEMS.map((id) => (
              <li key={id} className="space-y-2 py-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
