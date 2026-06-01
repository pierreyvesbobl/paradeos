import { cn } from "@/lib/utils";

/**
 * `bg-muted` (--muted: 96% L en light) est trop proche du `--background` (100%
 * en light, 7% en dark) pour rester perceptible, surtout en plein cycle
 * d'animate-pulse (opacity 0.5). On utilise `muted-foreground/15` pour un
 * contraste lisible sur les deux thèmes tout en restant subtil.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("animate-pulse rounded-md bg-muted-foreground/15", className)} {...props} />
  );
}
