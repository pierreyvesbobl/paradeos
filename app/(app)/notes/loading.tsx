import { Skeleton } from "@/components/ui/skeleton";

const CARDS = ["n1", "n2", "n3", "n4", "n5"];

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-7 w-72" />
      </div>
      <Skeleton className="h-24 w-full" />
      <ul className="space-y-3">
        {CARDS.map((id) => (
          <li key={id} className="space-y-3 rounded-lg border bg-card p-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="ml-auto h-3 w-20" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-3/4" />
          </li>
        ))}
      </ul>
    </div>
  );
}
