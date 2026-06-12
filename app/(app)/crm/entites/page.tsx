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
import { PersistViewParams } from "@/components/view-prefs/persist-view-params";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import { buildSortHref, collectF } from "@/lib/filters/url-helpers";
import { entityKindEnum, entityKindLabels } from "@/lib/schemas/entities";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { type SQL, and, asc, desc, ilike, or } from "drizzle-orm";
import { ArrowRight, Building2, Plus } from "lucide-react";
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
              <Plus className="size-4" />
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

      <form className="max-w-sm">
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

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={query ? "Aucune entité trouvée." : "Pas encore d'entité."}
          description={query ? undefined : "Crée la première pour commencer."}
          action={
            query ? null : (
              <Button asChild size="sm">
                <Link href="/entites/nouveau">
                  <Plus className="size-4" />
                  Nouvelle entité
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortableHeader
                    label="Nom"
                    field="name"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/entites", params, next)}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Type"
                    field="kind"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/entites", params, next)}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Site web"
                    field="website"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/entites", params, next)}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <EntName id={row.id} value={row.name} className="font-medium text-sm" />
                      <Link
                        href={`/entites/${row.id}`}
                        aria-label="Ouvrir la fiche"
                        className="ml-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      >
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>
                    <EntKind id={row.id} value={row.kind} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <EntWebsite id={row.id} value={row.website} />
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
