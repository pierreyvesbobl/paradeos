import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { FilterRow } from "@/components/table/filter-row";
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
import {
  type ProjectKind,
  type ProjectStatus,
  projectKindEnum,
  projectKindLabels,
  projectStatusEnum,
  projectStatusLabels,
} from "@/lib/schemas/projects";
import { type SQL, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
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

const SORT_FIELDS = ["name", "kind", "status", "entity", "startDate", "updated"] as const;
type SortField = (typeof SORT_FIELDS)[number];

function orderByFor(sort: SortState): SQL[] {
  if (!sort) return [desc(projects.updatedAt), asc(projects.name)];
  const dir = sort.dir === "asc" ? asc : desc;
  switch (sort.field as SortField) {
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
    case "updated":
      return [dir(projects.updatedAt)];
    default:
      return [desc(projects.updatedAt), asc(projects.name)];
  }
}

type SearchParams = Promise<{
  q?: string;
  kind?: ProjectKind;
  status?: ProjectStatus | "all";
  sort?: string;
}>;

const DEFAULT_STATUSES: ProjectStatus[] = ["planning", "active", "on_hold"];

export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, kind, status, sort } = await searchParams;
  const query = q?.trim() ?? "";
  const activeKind = kind && projectKindEnum.options.includes(kind) ? kind : undefined;
  const activeStatus =
    status === "all"
      ? undefined
      : status && projectStatusEnum.options.includes(status)
        ? status
        : "default";
  const sortState = parseSort(sort, SORT_FIELDS);

  const conn = await db();
  const conditions = [];
  if (activeKind) conditions.push(eq(projects.kind, activeKind));
  if (activeStatus === "default") {
    conditions.push(inArray(projects.status, DEFAULT_STATUSES));
  } else if (activeStatus !== undefined) {
    conditions.push(eq(projects.status, activeStatus));
  }
  if (query)
    conditions.push(or(ilike(projects.name, `%${query}%`), ilike(entities.name, `%${query}%`)));

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
      .where(conditions.length ? sql`${sql.join(conditions, sql` and `)}` : undefined)
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

      <div className="space-y-3">
        <FilterRow
          label="Type"
          items={[
            { value: undefined, label: "Tous", active: !activeKind },
            ...projectKindEnum.options.map((k) => ({
              value: k as string,
              label: projectKindLabels[k],
              active: activeKind === k,
            })),
          ]}
          buildHref={(value) =>
            buildHref({
              kind: value as ProjectKind | undefined,
              status,
              q: query,
              sort: sortToParam(sortState),
            })
          }
        />
        <FilterRow
          label="Statut"
          items={[
            {
              value: undefined,
              label: "Actifs",
              active: activeStatus === "default",
            },
            ...projectStatusEnum.options.map((s) => ({
              value: s as string,
              label: projectStatusLabels[s],
              active: activeStatus === s,
            })),
            { value: "all", label: "Tous", active: activeStatus === undefined },
          ]}
          buildHref={(value) =>
            buildHref({
              kind: activeKind,
              status: value as ProjectStatus | "all" | undefined,
              q: query,
              sort: sortToParam(sortState),
            })
          }
        />
      </div>

      <form className="max-w-sm">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Rechercher par nom, entité…"
          className="h-9"
        />
        {activeKind ? <input type="hidden" name="kind" value={activeKind} /> : null}
        {status ? <input type="hidden" name="status" value={status} /> : null}
        {sort ? <input type="hidden" name="sort" value={sort} /> : null}
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
                    buildHref={(next) =>
                      buildHref({
                        kind: activeKind,
                        status,
                        q: query,
                        sort: sortToParam(next),
                      })
                    }
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Type"
                    field="kind"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({
                        kind: activeKind,
                        status,
                        q: query,
                        sort: sortToParam(next),
                      })
                    }
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Statut"
                    field="status"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({
                        kind: activeKind,
                        status,
                        q: query,
                        sort: sortToParam(next),
                      })
                    }
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Entité"
                    field="entity"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({
                        kind: activeKind,
                        status,
                        q: query,
                        sort: sortToParam(next),
                      })
                    }
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Début"
                    field="startDate"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({
                        kind: activeKind,
                        status,
                        q: query,
                        sort: sortToParam(next),
                      })
                    }
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

function buildHref(params: {
  kind?: ProjectKind;
  status?: ProjectStatus | "all";
  q?: string;
  sort?: string | null;
}): string {
  const sp = new URLSearchParams();
  if (params.kind) sp.set("kind", params.kind);
  if (params.status) sp.set("status", params.status);
  if (params.q) sp.set("q", params.q);
  if (params.sort) sp.set("sort", params.sort);
  const qs = sp.toString();
  return qs ? `/projets?${qs}` : "/projets";
}
