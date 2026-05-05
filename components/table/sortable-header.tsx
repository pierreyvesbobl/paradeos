import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import Link from "next/link";

export type SortDir = "asc" | "desc";
export type SortState = { field: string; dir: SortDir } | null;

/**
 * Sérialise → "field:asc" / "field:desc" / null. Utiliser dans `?sort=…`.
 */
export function sortToParam(sort: SortState): string | null {
  return sort ? `${sort.field}:${sort.dir}` : null;
}

/**
 * Parse "field:asc" → SortState. Retourne null si invalide.
 * `allowed` borne les champs autorisés pour éviter d'injecter n'importe quoi.
 */
export function parseSort(raw: string | undefined, allowed: readonly string[]): SortState {
  if (!raw) return null;
  const [field, dir] = raw.split(":");
  if (!field || !allowed.includes(field)) return null;
  if (dir !== "asc" && dir !== "desc") return null;
  return { field, dir };
}

type Props = {
  label: string;
  field: string;
  current: SortState;
  buildHref: (next: SortState) => string;
  align?: "left" | "right";
};

/**
 * En-tête de colonne cliquable façon Notion : 3 états (none → asc → desc → none).
 * Le `buildHref` est responsable de réécrire l'URL avec le param sort approprié.
 */
export function SortableHeader({ label, field, current, buildHref, align = "left" }: Props) {
  const isActive = current?.field === field;
  const nextState: SortState = !isActive
    ? { field, dir: "asc" }
    : current?.dir === "asc"
      ? { field, dir: "desc" }
      : null;

  return (
    <Link
      href={buildHref(nextState)}
      className={`inline-flex items-center gap-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring ${
        align === "right" ? "flex-row-reverse" : ""
      } ${isActive ? "text-foreground" : "text-muted-foreground"}`}
    >
      <span>{label}</span>
      {!isActive ? (
        <ArrowUpDown className="size-3 opacity-50" />
      ) : current?.dir === "asc" ? (
        <ArrowUp className="size-3" />
      ) : (
        <ArrowDown className="size-3" />
      )}
    </Link>
  );
}
