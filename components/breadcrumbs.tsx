import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import Link from "next/link";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

type Props = {
  items: BreadcrumbItem[];
  className?: string;
};

/**
 * Fil d'Ariane. Le dernier item est la page courante (pas de lien),
 * les précédents sont cliquables. À placer dans `eyebrow` du PageHeader.
 */
export function Breadcrumbs({ items, className }: Props) {
  return (
    <nav
      aria-label="Fil d'Ariane"
      className={cn(
        "flex flex-wrap items-center gap-1 text-muted-foreground text-xs uppercase tracking-wider",
        className,
      )}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1;
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: items are stable per render
          <span key={i} className="inline-flex items-center gap-1">
            {item.href && !isLast ? (
              <Link href={item.href} className="hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ) : (
              <span className={isLast ? "text-foreground" : undefined}>{item.label}</span>
            )}
            {!isLast ? <ChevronRight className="size-3 opacity-50" aria-hidden="true" /> : null}
          </span>
        );
      })}
    </nav>
  );
}
