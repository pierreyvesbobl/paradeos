import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { NotionFilters } from "@/components/table/notion-filters";
import { type SortState, SortableHeader, parseSort } from "@/components/table/sortable-header";
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
import { meetings } from "@/db/schema/meetings";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import { buildSortHref, collectF } from "@/lib/filters/url-helpers";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { type SQL, and, asc, desc, ilike, sql } from "drizzle-orm";
import { Mic, Plus } from "lucide-react";
import Link from "next/link";

const STATUS_LABEL = {
  ingested: "À extraire",
  extracted: "À valider",
  reviewed: "Validé",
  archived: "Archivé",
} as const;

const STATUS_BADGE = {
  ingested: "border-amber-300 bg-amber-50 text-amber-700",
  extracted: "border-indigo-300 bg-indigo-50 text-indigo-700",
  reviewed: "border-emerald-300 bg-emerald-50 text-emerald-700",
  archived: "border-slate-300 bg-slate-50 text-slate-500",
} as const;

const STATUS_VALUES = ["ingested", "extracted", "reviewed", "archived"] as const;

const FILTER_DEFS = [
  {
    key: "status",
    label: "Statut",
    type: "enum" as const,
    options: STATUS_VALUES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
  },
  { key: "title", label: "Titre", type: "text" as const },
  { key: "occurredAt", label: "Date du meeting", type: "date" as const },
];

const SORT_FIELDS = ["title", "occurredAt", "status", "pending"] as const;

const PERSISTED_KEYS = ["q", "f", "sort"] as const;

function orderByFor(sort: SortState): SQL[] {
  if (!sort) return [desc(meetings.occurredAt), desc(meetings.createdAt)];
  const dir = sort.dir === "asc" ? asc : desc;
  switch (sort.field) {
    case "title":
      return [dir(meetings.title)];
    case "occurredAt":
      return [dir(meetings.occurredAt), desc(meetings.createdAt)];
    case "status":
      return [dir(meetings.status), desc(meetings.occurredAt)];
    case "pending":
      return [
        dir(sql`(
          select count(*) from meeting_proposals
          where meeting_proposals.meeting_id = meetings.id
            and meeting_proposals.status = 'pending'
        )`),
        desc(meetings.occurredAt),
      ];
    default:
      return [desc(meetings.occurredAt), desc(meetings.createdAt)];
  }
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function MeetingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await applyViewPrefRedirect({
    pageKey: "meetings",
    pathname: "/meetings",
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
    { key: "status", column: meetings.status, kind: "enum" as const },
    { key: "title", column: meetings.title, kind: "text" as const },
    { key: "occurredAt", column: meetings.occurredAt, kind: "date" as const },
  ];
  const filterConditions = applyFilters(filters, filterColumns);

  const conn = await db();
  const conditions: SQL[] = [...filterConditions];
  if (query) conditions.push(ilike(meetings.title, `%${query}%`));

  const rows = await conn
    .select({
      id: meetings.id,
      title: meetings.title,
      occurredAt: meetings.occurredAt,
      createdAt: meetings.createdAt,
      status: meetings.status,
      pendingCount: sql<number>`(
        select count(*) from meeting_proposals
        where meeting_proposals.meeting_id = meetings.id
          and meeting_proposals.status = 'pending'
      )`.as("pending_count"),
    })
    .from(meetings)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderByFor(sortState));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Knowledge"
        title="Meetings"
        description="Importe un transcript, génère un résumé et extrais tâches / contacts / opportunités à valider."
        actions={
          <Button asChild>
            <Link href="/meetings/nouveau">
              <Plus className="size-4" />
              Importer un transcript
            </Link>
          </Button>
        }
      />

      <NotionFilters
        pathname="/meetings"
        filterDefs={FILTER_DEFS}
        activeFilters={filters.map((f) => ({ key: f.key, op: f.op, value: f.value }))}
      />
      <PersistViewParams pageKey="meetings" relevantKeys={PERSISTED_KEYS} />

      <form className="max-w-sm">
        <Input name="q" defaultValue={query} placeholder="Rechercher par titre…" className="h-9" />
        {collectF(params).map((f, i) => (
          <input key={`f-${i}-${f}`} type="hidden" name="f" value={f} />
        ))}
        {sortRaw ? <input type="hidden" name="sort" value={sortRaw} /> : null}
      </form>

      {rows.length === 0 ? (
        (() => {
          const hasFilter = Boolean(query) || filters.length > 0;
          return (
            <EmptyState
              icon={Mic}
              title={hasFilter ? "Aucun meeting trouvé." : "Pas encore de meeting."}
              description={
                hasFilter
                  ? "Réinitialise les filtres ou ajuste la recherche."
                  : "Colle ou téléverse un transcript pour démarrer."
              }
              action={
                hasFilter ? (
                  <Link href="/meetings" className="text-muted-foreground text-sm hover:underline">
                    Réinitialiser les filtres
                  </Link>
                ) : (
                  <Button asChild size="sm">
                    <Link href="/meetings/nouveau">
                      <Plus className="size-4" />
                      Importer un transcript
                    </Link>
                  </Button>
                )
              }
            />
          );
        })()
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
                    buildHref={(next) => buildSortHref("/meetings", params, next)}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Date"
                    field="occurredAt"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/meetings", params, next)}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Statut"
                    field="status"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/meetings", params, next)}
                  />
                </TableHead>
                <TableHead className="text-right">
                  <SortableHeader
                    label="À valider"
                    field="pending"
                    current={sortState}
                    align="right"
                    buildHref={(next) => buildSortHref("/meetings", params, next)}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="group">
                  <TableCell className="font-medium">
                    <Link href={`/meetings/${row.id}`} className="hover:underline">
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.occurredAt ? new Date(row.occurredAt).toLocaleDateString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[row.status]}`}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {Number(row.pendingCount) > 0 ? (
                      <span className="font-medium">{Number(row.pendingCount)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
