import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { NotionFilters } from "@/components/table/notion-filters";
import { type SortState, SortableHeader, parseSort } from "@/components/table/sortable-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { opportunities } from "@/db/schema/opportunities";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import { buildSortHref, collectF } from "@/lib/filters/url-helpers";
import {
  type OpportunityStatus,
  opportunityStatusEnum,
  opportunityStatusLabels,
} from "@/lib/schemas/opportunities";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { type SQL, and, asc, desc, ilike, or, sql } from "drizzle-orm";
import { LayoutGrid, Plus, Sparkles } from "lucide-react";
import Link from "next/link";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const statusVariant: Record<
  OpportunityStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  not_started: "outline",
  to_follow_up: "secondary",
  awaiting_response: "secondary",
  won: "default",
  lost: "destructive",
};

const FILTER_DEFS = [
  {
    key: "status",
    label: "Statut",
    type: "enum" as const,
    options: opportunityStatusEnum.options.map((s) => ({
      value: s,
      label: opportunityStatusLabels[s],
    })),
  },
  { key: "title", label: "Titre", type: "text" as const },
  { key: "valueAmount", label: "Montant", type: "number" as const },
  { key: "probability", label: "Probabilité", type: "number" as const },
  { key: "followUpDate", label: "Relance", type: "date" as const },
];

const SORT_FIELDS = [
  "title",
  "entity",
  "status",
  "valueAmount",
  "probability",
  "followUpDate",
] as const;

const PERSISTED_KEYS = ["q", "f", "sort"] as const;

function orderByFor(sort: SortState): SQL[] {
  if (!sort) return [desc(opportunities.updatedAt), asc(opportunities.title)];
  const dir = sort.dir === "asc" ? asc : desc;
  switch (sort.field) {
    case "title":
      return [dir(opportunities.title)];
    case "entity":
      return [dir(entities.name), asc(opportunities.title)];
    case "status":
      return [dir(opportunities.status), asc(opportunities.title)];
    case "valueAmount":
      return [dir(opportunities.valueAmount), asc(opportunities.title)];
    case "probability":
      return [dir(opportunities.probability), asc(opportunities.title)];
    case "followUpDate":
      return [dir(opportunities.followUpDate), asc(opportunities.title)];
    default:
      return [desc(opportunities.updatedAt), asc(opportunities.title)];
  }
}

export default async function OpportunitiesListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  await applyViewPrefRedirect({
    pageKey: "opportunites/liste",
    pathname: "/opportunites/liste",
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
    { key: "status", column: opportunities.status, kind: "enum" as const },
    { key: "title", column: opportunities.title, kind: "text" as const },
    { key: "valueAmount", column: opportunities.valueAmount, kind: "number" as const },
    { key: "probability", column: opportunities.probability, kind: "number" as const },
    { key: "followUpDate", column: opportunities.followUpDate, kind: "date" as const },
  ];
  const filterConditions = applyFilters(filters, filterColumns);

  const conn = await db();
  const conditions: SQL[] = [...filterConditions];
  if (query) {
    const like = or(ilike(opportunities.title, `%${query}%`), ilike(entities.name, `%${query}%`));
    if (like) conditions.push(like);
  }

  const rows = await conn
    .select({
      id: opportunities.id,
      title: opportunities.title,
      status: opportunities.status,
      valueAmount: opportunities.valueAmount,
      probability: opportunities.probability,
      followUpDate: opportunities.followUpDate,
      entityId: entities.id,
      entityName: entities.name,
    })
    .from(opportunities)
    .leftJoin(entities, sql`${opportunities.entityId} = ${entities.id}`)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderByFor(sortState));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Opportunités — Liste"
        description="Vue tableau du pipeline."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/opportunites">
                <LayoutGrid className="size-4" />
                Vue kanban
              </Link>
            </Button>
            <Button asChild>
              <Link href="/opportunites/nouveau">
                <Plus className="size-4" />
                Nouvelle
              </Link>
            </Button>
          </>
        }
      />

      <NotionFilters
        pathname="/opportunites/liste"
        filterDefs={FILTER_DEFS}
        activeFilters={filters.map((f) => ({ key: f.key, op: f.op, value: f.value }))}
      />
      <PersistViewParams pageKey="opportunites/liste" relevantKeys={PERSISTED_KEYS} />

      <form className="max-w-sm">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Rechercher par titre, entité…"
          className="h-9"
        />
        {collectF(params).map((f, i) => (
          <input key={`f-${i}-${f}`} type="hidden" name="f" value={f} />
        ))}
        {sortRaw ? <input type="hidden" name="sort" value={sortRaw} /> : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={query ? "Aucune opportunité trouvée." : "Pas encore d'opportunité."}
          action={
            query ? null : (
              <Button asChild size="sm">
                <Link href="/opportunites/nouveau">
                  <Plus className="size-4" />
                  Nouvelle opportunité
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
                    label="Titre"
                    field="title"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/opportunites/liste", params, next)}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Entité"
                    field="entity"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/opportunites/liste", params, next)}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Statut"
                    field="status"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/opportunites/liste", params, next)}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader
                    label="Montant"
                    field="valueAmount"
                    current={sortState}
                    align="right"
                    buildHref={(next) => buildSortHref("/opportunites/liste", params, next)}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader
                    label="Proba"
                    field="probability"
                    current={sortState}
                    align="right"
                    buildHref={(next) => buildSortHref("/opportunites/liste", params, next)}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Relance"
                    field="followUpDate"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/opportunites/liste", params, next)}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <Link href={`/opportunites/${row.id}`} className="hover:underline">
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.entityId ? (
                      <Link href={`/entites/${row.entityId}`} className="text-sm hover:underline">
                        {row.entityName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[row.status]}>
                      {opportunityStatusLabels[row.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {row.valueAmount ? `${Number(row.valueAmount).toLocaleString("fr-FR")} €` : "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">
                    {row.probability != null ? `${row.probability}%` : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.followUpDate
                      ? new Date(row.followUpDate).toLocaleDateString("fr-FR")
                      : "—"}
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
