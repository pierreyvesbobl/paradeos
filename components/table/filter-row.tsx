import Link from "next/link";

type Item = { value: string | undefined; label: string; active: boolean };

/**
 * Barre de filtres en chips, façon Notion : 1 ligne = 1 facette
 * (Type, Statut, …). Sélection unique. URL sérialisée par `buildHref`.
 */
export function FilterRow({
  label,
  items,
  buildHref,
}: {
  label: string;
  items: Item[];
  buildHref: (value: string | undefined) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </span>
      {items.map((item) => (
        <Link
          key={item.value ?? "__all__"}
          href={buildHref(item.value)}
          className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
            item.active ? "bg-foreground text-background" : "hover:bg-muted"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}
