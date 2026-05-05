import type { SortState } from "@/components/table/sortable-header";
import { sortToParam } from "@/components/table/sortable-header";

type RawParams = Record<string, string | string[] | undefined>;

/**
 * Construit un href en préservant les filtres `?f=...` et la recherche
 * `?q=...` existants, et en ré-écrivant la clé `?sort=...`. Utilisé par
 * les `SortableHeader` des pages migrées au pattern NotionFilters +
 * tri par colonne.
 */
export function buildSortHref(pathname: string, params: RawParams, next: SortState): string {
  const sp = new URLSearchParams();
  if (typeof params.q === "string" && params.q) sp.set("q", params.q);
  for (const raw of collectF(params)) sp.append("f", raw);
  // Préserver d'autres params spécifiques (entité picker, scope, etc.)
  // n'est pas généralisable ici — chaque page le fait au cas par cas.
  const s = sortToParam(next);
  if (s) sp.set("sort", s);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function collectF(params: RawParams): string[] {
  const v = params.f;
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  return [];
}
