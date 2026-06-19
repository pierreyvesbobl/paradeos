import { EntKind, EntName, EntWebsite } from "@/app/(app)/entites/[id]/inline-fields";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { NotionFilters } from "@/components/table/notion-filters";
import { type SortState, SortableHeader, parseSort } from "@/components/table/sortable-header";
import { Button } from "@/components/ui/button";
import { SearchInputWithClear } from "@/components/ui/search-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { HashedAvatar } from "@/components/user/hashed-avatar";
import { PersistViewParams } from "@/components/view-prefs/persist-view-params";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import { buildSortHref, collectF } from "@/lib/filters/url-helpers";
import { entityKindEnum, entityKindLabels } from "@/lib/schemas/entities";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { ArrowRight, Buildings, Globe, Plus } from "@phosphor-icons/react/dist/ssr";
import { type SQL, and, asc, desc, ilike, or } from "drizzle-orm";
import Link from "next/link";
import { CrmTabs } from "../crm-tabs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTER_DEFS = [
  {
    key: "kind",
    label: "Type",
    type: "enum" as const,
    options: entityKindEnum.options.map((k) => ({ value: k, label: entityKindLabels[k] })),
  },
  { key: "name", label: "Nom", type: "text" as const },
  { key: "website", label: "Site web", type: "text" as const },
];

const SORT_FIELDS = ["name", "kind", "website", "created"] as const;

const PERSISTED_KEYS = ["q", "f", "sort"] as const;

function orderByFor(sort: SortState): SQL[] {
  if (!sort) return [asc(entities.name)];
  const dir = sort.dir === "asc" ? asc : desc;
  switch (sort.field) {
    case "name":
      return [dir(entities.name)];
    case "kind":
      return [dir(entities.kind), asc(entities.name)];
    case "website":
      return [dir(entities.website), asc(entities.name)];
    case "created":
      return [dir(entities.createdAt)];
    default:
      return [asc(entities.name)];
  }
}

export default async function CrmEntitesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await applyViewPrefRedirect({
    pageKey: "entites",
    pathname: "/crm/entites",
    searchParams: params,
    relevantKeys: PERSISTED_KEYS,
  });
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const sortRaw = typeof params.sort === "string" ? params.sort : undefined;
  const sortState = parseSort(sortRaw, SORT_FIELDS);

  const filters = parseFiltersFromSearchParams(
    params,
    FILTER_DEFS.map((d) => d.key),
  );
  const filterColumns = [
    { key: "kind", column: entities.kind, kind: "enum" as const },
    { key: "name", column: entities.name, kind: "text" as const },
    { key: "website", column: entities.website, kind: "text" as const },
  ];
  const filterConditions = applyFilters(filters, filterColumns);

  const conn = await db();
  const conditions: SQL[] = [...filterConditions];
  if (query) {
    const like = or(ilike(entities.name, `%${query}%`), ilike(entities.website, `%${query}%`));
    if (like) conditions.push(like);
  }

  const rows = await conn
    .select({
      id: entities.id,
      name: entities.name,
      kind: entities.kind,
      website: entities.website,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderByFor(sortState));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
        title="Entités"
        description="Sociétés clientes, prospects, partenaires et fournisseurs."
        actions={
          <Button asChild>
            <Link href="/entites/nouveau">
              <Plus size={14} weight="bold" />
              Nouvelle entité
            </Link>
          </Button>
        }
      />

      <CrmTabs current="entites" />

      <NotionFilters
        pathname="/crm/entites"
        filterDefs={FILTER_DEFS}
        activeFilters={filters.map((f) => ({ key: f.key, op: f.op, value: f.value }))}
      />
      <PersistViewParams pageKey="entites" relevantKeys={PERSISTED_KEYS} />

      <div className="flex items-center gap-3">
        <form className="max-w-sm flex-1">
          <SearchInputWithClear
            name="q"
            defaultValue={query}
            placeholder="Rechercher par nom, site web…"
          />
          {collectF(params).map((f, i) => (
            <input key={`f-${i}-${f}`} type="hidden" name="f" value={f} />
          ))}
          {sortRaw ? <input type="hidden" name="sort" value={sortRaw} /> : null}
        </form>
        <span className="ml-auto text-[var(--ds-text-tertiary)] text-sm">
          {rows.length} entité{rows.length > 1 ? "s" : ""}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Buildings}
          title={query ? "Aucune entité trouvée." : "Pas encore d'entité."}
          description={query ? undefined : "Crée la première pour commencer."}
          action={
            query ? null : (
              <Button asChild size="sm">
                <Link href="/entites/nouveau">
                  <Plus size={14} weight="bold" />
                  Nouvelle entité
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div>
          <Table>
            <TableHeader>
              <TableRow className="border-border/70 border-b">
                <TableHead className="h-9 px-3 font-semibold text-[11px] text-[var(--ds-text-tertiary)] uppercase tracking-wider">
                  <SortableHeader
                    label="Nom"
                    field="name"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/entites", params, next)}
                  />
                </TableHead>
                <TableHead className="h-9 w-[200px] px-3 font-semibold text-[11px] text-[var(--ds-text-tertiary)] uppercase tracking-wider">
                  <SortableHeader
                    label="Type"
                    field="kind"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/entites", params, next)}
                  />
                </TableHead>
                <TableHead className="h-9 w-[290px] px-3 font-semibold text-[11px] text-[var(--ds-text-tertiary)] uppercase tracking-wider">
                  <SortableHeader
                    label="Site web"
                    field="website"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/entites", params, next)}
                  />
                </TableHead>
                <TableHead className="h-9 w-10 px-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.id}
                  className="group border-border/70 border-b transition-colors hover:bg-[var(--ds-bg-hover)]"
                >
                  <TableCell className="min-h-[58px] px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <HashedAvatar name={row.name} seed={row.id} size="md" title={row.name} />
                      <EntName id={row.id} value={row.name} className="font-medium text-sm" />
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-sm">
                    <div className="inline-flex items-center gap-2 text-muted-foreground">
                      <Buildings
                        size={14}
                        weight="duotone"
                        className="flex-none text-[var(--ds-text-tertiary)]"
                      />
                      <EntKind id={row.id} value={row.kind} />
                    </div>
                  </TableCell>
                  <TableCell className="px-3 py-2.5 text-sm">
                    <div className="inline-flex max-w-full items-center gap-2 text-muted-foreground">
                      {row.website ? (
                        <Globe
                          size={14}
                          weight="duotone"
                          className="flex-none text-[var(--ds-text-tertiary)]"
                        />
                      ) : null}
                      <EntWebsite id={row.id} value={row.website} placeholder="" />
                    </div>
                  </TableCell>
                  <TableCell className="px-2 py-2.5 text-right">
                    <Link
                      href={`/entites/${row.id}`}
                      aria-label="Ouvrir la fiche"
                      className="inline-flex size-7 items-center justify-center rounded-md text-[var(--ds-text-tertiary)] opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                    >
                      <ArrowRight size={15} weight="bold" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
