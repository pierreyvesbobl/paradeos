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
import { PersistViewParams } from "@/components/view-prefs/persist-view-params";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import {
  COMMERCIAL_STATUSES,
  type ProjectKind,
  type ProjectStatus,
  projectKindLabels,
  projectStatusEnum,
  projectStatusLabels,
} from "@/lib/schemas/projects";
import { cn } from "@/lib/utils";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { type SQL, and, asc, desc, ilike, inArray, or, sql } from "drizzle-orm";
import { ArrowRight, Briefcase, Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import {
  ProjColor,
  ProjEntity,
  ProjKind,
  ProjName,
  ProjPeriod,
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

const PERSISTED_KEYS = ["q", "f", "sort", "scope"] as const;

const SCOPES = ["pipeline", "active", "inactive"] as const;
type Scope = (typeof SCOPES)[number];

const SCOPE_LABELS: Record<Scope, string> = {
  pipeline: "Pipeline",
  active: "Actifs",
  inactive: "Inactifs",
};

const SCOPE_STATUSES: Record<Scope, ProjectStatus[]> = {
  pipeline: ["not_started", "to_follow_up", "awaiting_response", "won", "lost"],
  active: ["planning", "active"],
  inactive: ["on_hold", "completed", "archived"],
};

function parseScopes(raw: string | string[] | undefined): Scope[] | null {
  if (raw === undefined) return null; // pas de paramètre = tous activés (défaut)
  const flat = Array.isArray(raw) ? raw.join(",") : raw;
  const parts = flat
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as Scope[];
  const valid = parts.filter((s) => (SCOPES as readonly string[]).includes(s));
  return valid;
}

function buildScopeHref(
  current: Scope[] | null,
  toggle: Scope,
  others: { q: string; sortRaw: string | undefined; fRaw: string[] },
): string {
  const active = current === null ? [...SCOPES] : current;
  const hasIt = active.includes(toggle);
  const next = hasIt ? active.filter((s) => s !== toggle) : [...active, toggle];
  const sp = new URLSearchParams();
  if (others.q) sp.set("q", others.q);
  for (const f of others.fRaw) sp.append("f", f);
  if (others.sortRaw) sp.set("sort", others.sortRaw);
  // On encode toujours scope dès qu'on diverge du défaut (tous), pour persister.
  if (next.length !== SCOPES.length) {
    sp.set("scope", next.join(","));
  }
  const qs = sp.toString();
  return qs ? `/projets?${qs}` : "/projets";
}

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
  await applyViewPrefRedirect({
    pageKey: "projets",
    pathname: "/projets",
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
    { key: "kind", column: projects.kind, kind: "enum" as const },
    { key: "status", column: projects.status, kind: "enum" as const },
    { key: "name", column: projects.name, kind: "text" as const },
    { key: "startDate", column: projects.startDate, kind: "date" as const },
    { key: "endDate", column: projects.endDate, kind: "date" as const },
  ];
  const filterConditions = applyFilters(filters, filterColumns);

  // Scope chips : pipeline / actifs / inactifs. Default (param absent) = tous.
  // Si un param `scope` est présent : ne garde que les statuts inclus.
  const activeScopes = parseScopes(params.scope);
  const scopeStatuses: ProjectStatus[] | null =
    activeScopes === null ? null : activeScopes.flatMap((s) => SCOPE_STATUSES[s]);

  const conn = await db();

  const conditions: SQL[] = [...filterConditions];
  if (scopeStatuses !== null) {
    if (scopeStatuses.length === 0) {
      // Aucun scope coché → on force aucun résultat.
      conditions.push(sql`false`);
    } else {
      conditions.push(inArray(projects.status, scopeStatuses));
    }
  }
  if (query) {
    const like = or(ilike(projects.name, `%${query}%`), ilike(entities.name, `%${query}%`));
    if (like) conditions.push(like);
  }

  const fRaw = (
    typeof params.f === "string" ? [params.f] : Array.isArray(params.f) ? params.f : []
  ) as string[];

  function buildSortHref(next: SortState): string {
    const sp = new URLSearchParams();
    if (query) sp.set("q", query);
    for (const raw of fRaw) sp.append("f", raw);
    const s = sortToParam(next);
    if (s) sp.set("sort", s);
    if (activeScopes !== null && activeScopes.length !== SCOPES.length) {
      sp.set("scope", activeScopes.join(","));
    }
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
        description="Missions clients (delivery + pipeline commercial), produits internes et initiatives transverses."
        actions={
          <>
            <Button asChild variant="outline">
              <Link href="/projets/pipeline">
                <Sparkles className="size-4" />
                Pipeline
              </Link>
            </Button>
            <Button asChild>
              <Link href="/projets/nouveau">
                <Plus className="size-4" />
                Nouveau projet
              </Link>
            </Button>
          </>
        }
      />

      <NotionFilters
        pathname="/projets"
        filterDefs={[...FILTER_DEFS]}
        activeFilters={filters.map((f) => ({ key: f.key, op: f.op, value: f.value }))}
      />
      <PersistViewParams pageKey="projets" relevantKeys={PERSISTED_KEYS} />

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 shrink-0 text-muted-foreground text-xs uppercase tracking-wide">
          Phase
        </span>
        {SCOPES.map((scope) => {
          const enabled = activeScopes === null || activeScopes.includes(scope);
          const href = buildScopeHref(activeScopes, scope, {
            q: query,
            sortRaw,
            fRaw,
          });
          return (
            <Link
              key={scope}
              href={href}
              className={cn(
                "rounded-md border px-2.5 py-1 text-xs transition-colors",
                enabled ? "bg-foreground text-background" : "hover:bg-muted",
              )}
            >
              {SCOPE_LABELS[scope]}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form className="max-w-sm flex-1">
          <Input
            name="q"
            defaultValue={query}
            placeholder="Rechercher par nom, entité…"
            className="h-9"
          />
          {/* Conserve les filtres et le tri à la soumission de la recherche. */}
          {(typeof params.f === "string"
            ? [params.f]
            : Array.isArray(params.f)
              ? params.f
              : []
          ).map((f, i) => (
            <input key={`f-${i}-${f}`} type="hidden" name="f" value={f} />
          ))}
          {sortRaw ? <input type="hidden" name="sort" value={sortRaw} /> : null}
        </form>
        {query || filters.length > 0 ? (
          <Link
            href="/projets?q="
            className="text-muted-foreground text-sm hover:underline"
            title="Effacer la recherche et les filtres"
          >
            Réinitialiser
          </Link>
        ) : null}
      </div>

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
                    label="Période"
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
                const isCommercial = (COMMERCIAL_STATUSES as readonly string[]).includes(
                  row.status,
                );
                return (
                  <TableRow
                    key={row.id}
                    className={`group ${muted ? "text-muted-foreground opacity-60" : ""}`}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <ProjColor id={row.id} value={row.color} />
                        <ProjName id={row.id} value={row.name} className="font-medium text-sm" />
                        {isCommercial ? (
                          <Link
                            href="/projets/pipeline"
                            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-medium text-[10px] text-amber-700 uppercase tracking-wide hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
                            title="Phase commerciale — voir le pipeline"
                          >
                            <Sparkles className="size-3" />
                            Pipeline
                          </Link>
                        ) : null}
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
                      <ProjPeriod id={row.id} startValue={row.startDate} endValue={row.endDate} />
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
