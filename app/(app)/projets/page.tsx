import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { NotionFilters } from "@/components/table/notion-filters";
import {
  type SortState,
  SortableHeader,
  parseSort,
  sortToParam,
} from "@/components/table/sortable-header";
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
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import {
  type ProjectKind,
  type ProjectStatus,
  projectKindLabels,
  projectStatusEnum,
  projectStatusLabels,
} from "@/lib/schemas/projects";
import { type SQL, and, asc, desc, ilike, or, sql } from "drizzle-orm";
import { ArrowRight, Briefcase, Plus } from "lucide-react";
import Link from "next/link";
import {
  ProjColor,
  ProjDate,
  ProjEntity,
  ProjKind,
  ProjName,
  ProjStatus,
} from "./[id]/inline-fields";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const FILTER_DEFS = [
  {
    key: "kind",
    label: "Type",
    type: "enum" as const,
    options: (Object.keys(projectKindLabels) as ProjectKind[]).map((k) => ({
      value: k,
      label: projectKindLabels[k],
    })),
  },
  {
    key: "status",
    label: "Statut",
    type: "enum" as const,
    options: projectStatusEnum.options.map((s) => ({
      value: s,
      label: projectStatusLabels[s as ProjectStatus],
    })),
  },
  { key: "name", label: "Nom", type: "text" as const },
  { key: "startDate", label: "Date de début", type: "date" as const },
  { key: "endDate", label: "Date de fin", type: "date" as const },
] as const;

const SORT_FIELDS = ["name", "kind", "status", "entity", "startDate"] as const;

function orderByFor(sort: SortState): SQL[] {
  if (!sort) return [desc(projects.updatedAt), asc(projects.name)];
  const dir = sort.dir === "asc" ? asc : desc;
  switch (sort.field) {
    case "name":
      return [dir(projects.name)];
    case "kind":
      return [dir(projects.kind), asc(projects.name)];
    case "status":
      return [dir(projects.status), asc(projects.name)];
    case "entity":
      return [dir(entities.name), asc(projects.name)];
    case "startDate":
      return [dir(projects.startDate), asc(projects.name)];
    default:
      return [desc(projects.updatedAt), asc(projects.name)];
  }
}

export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const sortRaw = typeof params.sort === "string" ? params.sort : undefined;
  const sortState = parseSort(sortRaw, SORT_FIELDS);

  const filters = parseFiltersFromSearchParams(
    params,
    FILTER_DEFS.map((d) => d.key),
  );

  const filterColumns = [
    { key: "kind", column: projects.kind, kind: "enum" as const },
    { key: "status", column: projects.status, kind: "enum" as const },
    { key: "name", column: projects.name, kind: "text" as const },
    { key: "startDate", column: projects.startDate, kind: "date" as const },
    { key: "endDate", column: projects.endDate, kind: "date" as const },
  ];
  const filterConditions = applyFilters(filters, filterColumns);

  const conn = await db();

  const conditions: SQL[] = [...filterConditions];
  if (query) {
    const like = or(ilike(projects.name, `%${query}%`), ilike(entities.name, `%${query}%`));
    if (like) conditions.push(like);
  }

  function buildSortHref(next: SortState): string {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    for (const raw of (typeof params.f === "string"
      ? [params.f]
      : Array.isArray(params.f)
        ? params.f
        : []) as string[]) {
      sp.append("f", raw);
    }
    const s = sortToParam(next);
    if (s) sp.set("sort", s);
    const qs = sp.toString();
    return qs ? `/projets?${qs}` : "/projets";
  }

  const [rows, entityList] = await Promise.all([
    conn
      .select({
        id: projects.id,
        name: projects.name,
        kind: projects.kind,
        status: projects.status,
        icon: projects.icon,
        color: projects.color,
        startDate: projects.startDate,
        endDate: projects.endDate,
        entityId: entities.id,
        entityName: entities.name,
      })
      .from(projects)
      .leftJoin(entities, sql`${projects.entityId} = ${entities.id}`)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...orderByFor(sortState)),
    conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .orderBy(asc(entities.name)),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Delivery"
        title="Projets"
        description="Missions clients, produits internes et initiatives transverses."
        actions={
          <Button asChild>
            <Link href="/projets/nouveau">
              <Plus className="size-4" />
              Nouveau projet
            </Link>
          </Button>
        }
      />

      <NotionFilters
        pathname="/projets"
        filterDefs={[...FILTER_DEFS]}
        activeFilters={filters.map((f) => ({ key: f.key, op: f.op, value: f.value }))}
      />

      <form className="max-w-sm">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Rechercher par nom, entité…"
          className="h-9"
        />
        {/* Conserve les filtres et le tri à la soumission de la recherche. */}
        {(typeof params.f === "string" ? [params.f] : Array.isArray(params.f) ? params.f : []).map(
          (f, i) => (
            <input key={`f-${i}-${f}`} type="hidden" name="f" value={f} />
          ),
        )}
        {sortRaw ? <input type="hidden" name="sort" value={sortRaw} /> : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Briefcase}
          title={query ? "Aucun projet trouvé." : "Pas encore de projet."}
          action={
            query ? null : (
              <Button asChild size="sm">
                <Link href="/projets/nouveau">
                  <Plus className="size-4" />
                  Nouveau projet
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
                    label="Projet"
                    field="name"
                    current={sortState}
                    buildHref={buildSortHref}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Type"
                    field="kind"
                    current={sortState}
                    buildHref={buildSortHref}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Statut"
                    field="status"
                    current={sortState}
                    buildHref={buildSortHref}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Entité"
                    field="entity"
                    current={sortState}
                    buildHref={buildSortHref}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Début"
                    field="startDate"
                    current={sortState}
                    buildHref={buildSortHref}
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const muted = row.status === "on_hold" || row.status === "archived";
                return (
                  <TableRow
                    key={row.id}
                    className={`group ${muted ? "text-muted-foreground opacity-60" : ""}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ProjColor id={row.id} value={row.color} />
                        <ProjName id={row.id} value={row.name} className="font-medium text-sm" />
                        <Link
                          href={`/projets/${row.id}`}
                          aria-label="Ouvrir la fiche"
                          className="ml-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                        >
                          <ArrowRight className="size-3.5" />
                        </Link>
                      </div>
                    </TableCell>
                    <TableCell>
                      <ProjKind id={row.id} value={row.kind} />
                    </TableCell>
                    <TableCell>
                      <ProjStatus id={row.id} value={row.status} />
                    </TableCell>
                    <TableCell>
                      <ProjEntity
                        id={row.id}
                        value={
                          row.entityId ? { id: row.entityId, name: row.entityName ?? "" } : null
                        }
                        options={entityList}
                      />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
                        <ProjDate id={row.id} field="startDate" value={row.startDate} />
                        <span aria-hidden="true">→</span>
                        <ProjDate id={row.id} field="endDate" value={row.endDate} />
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
