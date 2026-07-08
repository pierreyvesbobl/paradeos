import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { SearchInputWithClear } from "@/components/ui/search-input";
import { PersistViewParams } from "@/components/view-prefs/persist-view-params";
import { entities } from "@/db/schema/entities";
import { projectMembers } from "@/db/schema/project-members";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import {
  COMMERCIAL_STATUSES,
  DELIVERY_STATUSES,
  type ProjectKind,
  type ProjectStatus,
} from "@/lib/schemas/projects";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { UserFocus, X } from "@phosphor-icons/react/dist/ssr";
import { asc, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { Briefcase, Plus } from "lucide-react";
import Link from "next/link";
import {
  FacetsPanel,
  type Nature,
  type Role,
  type Scope,
  type State,
} from "./facets-panel";
import { type ProjectRow, ResultsTable } from "./results-table";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PERSISTED_KEYS = ["q", "scope", "type", "entity", "role", "nature", "state"] as const;

const TYPE_KEYS: ProjectKind[] = ["client", "product", "transverse"];
const ROLE_KEYS: Role[] = ["lead", "member"];
const NATURE_KEYS: Nature[] = ["opportunity", "project"];
const STATE_KEYS: State[] = ["active", "inactive"];

/**
 * Nature : distingue les opportunités commerciales (avant/après signature)
 * des projets en delivery. Un projet client passe de nature=opportunity
 * (statut commercial) à nature=project une fois entré en delivery.
 */
const NATURE_STATUSES: Record<Nature, ProjectStatus[]> = {
  opportunity: [...COMMERCIAL_STATUSES],
  project: [...DELIVERY_STATUSES],
};

/**
 * État : actif = quelque chose à faire dessus, inactif = fermé ou en pause.
 * `won` est classé inactif : la phase commerciale est terminée ; le projet
 * bascule ensuite en delivery (planning/active) qui repassent en actif.
 */
const STATE_STATUSES: Record<State, ProjectStatus[]> = {
  active: ["not_started", "to_follow_up", "awaiting_response", "planning", "active"],
  inactive: ["won", "lost", "on_hold", "completed", "archived"],
};

function parseCsv<T extends string>(
  raw: string | string[] | undefined,
  allowed: readonly T[],
): T[] {
  if (!raw) return [];
  const flat = Array.isArray(raw) ? raw.join(",") : raw;
  const parts = flat
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as T[];
  return parts.filter((s) => (allowed as readonly string[]).includes(s));
}

function parseScope(raw: string | string[] | undefined): Scope {
  const flat = Array.isArray(raw) ? raw[0] : raw;
  return flat === "mine" ? "mine" : "all";
}

export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await applyViewPrefRedirect({
    pageKey: "projets",
    pathname: "/projets",
    searchParams: params,
    relevantKeys: PERSISTED_KEYS,
  });

  const user = await requireUser();
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const scope = parseScope(params.scope);
  const rolesFilter = parseCsv<Role>(params.role, ROLE_KEYS);
  const typesFilter = parseCsv<ProjectKind>(params.type, TYPE_KEYS);
  const naturesFilter = parseCsv<Nature>(params.nature, NATURE_KEYS);
  const statesFilter = parseCsv<State>(params.state, STATE_KEYS);
  const entitiesFilterRaw = (() => {
    const raw = params.entity;
    if (!raw) return [] as string[];
    const flat = Array.isArray(raw) ? raw.join(",") : raw;
    return flat
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  })();

  const conn = await db();

  // Fetch projects with entity + owner, joined LEFT so we don't drop
  // projects without an entity (produits internes / transverses).
  const searchCondition = query
    ? or(ilike(projects.name, `%${query}%`), ilike(entities.name, `%${query}%`))
    : undefined;

  const rows = await conn
    .select({
      id: projects.id,
      name: projects.name,
      kind: projects.kind,
      status: projects.status,
      color: projects.color,
      updatedAt: projects.updatedAt,
      entityId: entities.id,
      entityName: entities.name,
      ownerId: users.id,
      ownerName: users.fullName,
      ownerAvatarUrl: users.avatarUrl,
    })
    .from(projects)
    .leftJoin(entities, eq(projects.entityId, entities.id))
    .leftJoin(users, eq(projects.ownerId, users.id))
    .where(searchCondition)
    .orderBy(desc(projects.updatedAt), asc(projects.name));

  const projectIds = rows.map((r) => r.id);

  // Fetch members grouped by project. If we have zero projects, skip
  // the query entirely (drizzle inArray would still work but this saves
  // a round-trip).
  const memberRows = projectIds.length
    ? await conn
        .select({
          projectId: projectMembers.projectId,
          userId: users.id,
          fullName: users.fullName,
          avatarUrl: users.avatarUrl,
        })
        .from(projectMembers)
        .innerJoin(users, eq(users.id, projectMembers.userId))
        .where(inArray(projectMembers.projectId, projectIds))
    : [];

  const membersByProject = new Map<
    string,
    { id: string; fullName: string | null; avatarUrl: string | null }[]
  >();
  for (const m of memberRows) {
    const list = membersByProject.get(m.projectId) ?? [];
    list.push({ id: m.userId, fullName: m.fullName, avatarUrl: m.avatarUrl });
    membersByProject.set(m.projectId, list);
  }

  // Enrich rows with team + `mine` flag before any filtering.
  type EnrichedRow = {
    raw: (typeof rows)[number];
    lead: { id: string; name: string | null; avatarUrl: string | null } | null;
    members: { id: string; name: string | null; avatarUrl: string | null }[];
    isMine: boolean;
    isLead: boolean;
    isMember: boolean;
  };

  const enriched: EnrichedRow[] = rows.map((r) => {
    const memberList = (membersByProject.get(r.id) ?? []).map((m) => ({
      id: m.id,
      name: m.fullName,
      avatarUrl: m.avatarUrl,
    }));
    const lead = r.ownerId
      ? { id: r.ownerId, name: r.ownerName, avatarUrl: r.ownerAvatarUrl }
      : null;
    const isLead = lead?.id === user.id;
    const isMember = memberList.some((m) => m.id === user.id);
    return {
      raw: r,
      lead,
      members: memberList,
      isLead,
      isMember,
      isMine: isLead || isMember,
    };
  });

  const totalCount = enriched.length;
  const myCount = enriched.filter((e) => e.isMine).length;
  const typeCounts: Record<ProjectKind, number> = {
    client: enriched.filter((e) => e.raw.kind === "client").length,
    product: enriched.filter((e) => e.raw.kind === "product").length,
    transverse: enriched.filter((e) => e.raw.kind === "transverse").length,
  };
  const opportunityStatuses = new Set<string>(NATURE_STATUSES.opportunity);
  const projectStatusSet = new Set<string>(NATURE_STATUSES.project);
  const activeStatusSet = new Set<string>(STATE_STATUSES.active);
  const inactiveStatusSet = new Set<string>(STATE_STATUSES.inactive);
  const natureCounts: Record<Nature, number> = {
    opportunity: enriched.filter((e) => opportunityStatuses.has(e.raw.status)).length,
    project: enriched.filter((e) => projectStatusSet.has(e.raw.status)).length,
  };
  const stateCounts: Record<State, number> = {
    active: enriched.filter((e) => activeStatusSet.has(e.raw.status)).length,
    inactive: enriched.filter((e) => inactiveStatusSet.has(e.raw.status)).length,
  };

  // Entity groups (deduped, counted, sorted by count desc then name).
  const entityCounts = new Map<string, { id: string; name: string; count: number }>();
  for (const e of enriched) {
    if (!e.raw.entityId || !e.raw.entityName) continue;
    const key = e.raw.entityId;
    const current = entityCounts.get(key);
    if (current) current.count += 1;
    else entityCounts.set(key, { id: key, name: e.raw.entityName, count: 1 });
  }
  const entityGroups = Array.from(entityCounts.values()).sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, "fr"),
  );

  // Apply facet filters. Rule: AND between facet groups, OR within a group.
  const filtered = enriched.filter((e) => {
    if (scope === "mine" && !e.isMine) return false;
    if (rolesFilter.length > 0) {
      const rolesMatch =
        (rolesFilter.includes("lead") && e.isLead) ||
        (rolesFilter.includes("member") && e.isMember);
      if (!rolesMatch) return false;
    }
    if (typesFilter.length > 0 && !typesFilter.includes(e.raw.kind)) return false;
    if (entitiesFilterRaw.length > 0) {
      if (!e.raw.entityId || !entitiesFilterRaw.includes(e.raw.entityId)) return false;
    }
    if (naturesFilter.length > 0) {
      const isOpp = opportunityStatuses.has(e.raw.status);
      const isProj = projectStatusSet.has(e.raw.status);
      const natureMatch =
        (naturesFilter.includes("opportunity") && isOpp) ||
        (naturesFilter.includes("project") && isProj);
      if (!natureMatch) return false;
    }
    if (statesFilter.length > 0) {
      const isActive = activeStatusSet.has(e.raw.status);
      const isInactive = inactiveStatusSet.has(e.raw.status);
      const stateMatch =
        (statesFilter.includes("active") && isActive) ||
        (statesFilter.includes("inactive") && isInactive);
      if (!stateMatch) return false;
    }
    return true;
  });

  const tableRows: ProjectRow[] = filtered.map((e) => ({
    id: e.raw.id,
    name: e.raw.name,
    kind: e.raw.kind,
    status: e.raw.status as ProjectStatus,
    color: e.raw.color,
    entityName: e.raw.entityName,
    lead: e.lead,
    members: e.members,
    activityAt: new Date(e.raw.updatedAt),
  }));

  // Preserved params for facet toggles (so `q` survives clicks).
  const preservedParams: Record<string, string> = {};
  if (query) preservedParams.q = query;

  return (
    <div className="space-y-5">
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
      <PersistViewParams pageKey="projets" relevantKeys={PERSISTED_KEYS} />

      <div className="flex flex-wrap items-center gap-3">
        <form className="max-w-sm flex-1">
          <SearchInputWithClear
            name="q"
            defaultValue={query}
            placeholder="Rechercher par nom, entité…"
          />
          {scope !== "all" ? <input type="hidden" name="scope" value={scope} /> : null}
          {typesFilter.length > 0 ? (
            <input type="hidden" name="type" value={typesFilter.join(",")} />
          ) : null}
          {entitiesFilterRaw.length > 0 ? (
            <input type="hidden" name="entity" value={entitiesFilterRaw.join(",")} />
          ) : null}
          {rolesFilter.length > 0 ? (
            <input type="hidden" name="role" value={rolesFilter.join(",")} />
          ) : null}
          {naturesFilter.length > 0 ? (
            <input type="hidden" name="nature" value={naturesFilter.join(",")} />
          ) : null}
          {statesFilter.length > 0 ? (
            <input type="hidden" name="state" value={statesFilter.join(",")} />
          ) : null}
        </form>
      </div>

      <div className="flex items-start gap-5">
        <FacetsPanel
          pathname="/projets"
          scope={scope}
          roles={rolesFilter}
          types={typesFilter}
          entities={entitiesFilterRaw}
          natures={naturesFilter}
          states={statesFilter}
          totalCount={totalCount}
          myCount={myCount}
          typeCounts={typeCounts}
          natureCounts={natureCounts}
          stateCounts={stateCounts}
          entityGroups={entityGroups}
          preservedParams={preservedParams}
        />

        <div className="flex min-w-0 flex-1 flex-col gap-2.5">
          <ResultsBar
            scope={scope}
            listCount={filtered.length}
            clearScopeHref={buildClearScopeHref({
              query,
              types: typesFilter,
              entitiesRaw: entitiesFilterRaw,
              roles: rolesFilter,
            })}
          />

          {filtered.length === 0 ? (
            <EmptyState
              icon={Briefcase}
              title={
                query ||
                scope === "mine" ||
                typesFilter.length ||
                entitiesFilterRaw.length ||
                naturesFilter.length ||
                statesFilter.length
                  ? "Aucun projet ne correspond aux filtres."
                  : "Pas encore de projet."
              }
              action={
                query ||
                scope === "mine" ||
                typesFilter.length ||
                entitiesFilterRaw.length ||
                naturesFilter.length ||
                statesFilter.length ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href="/projets">Réinitialiser</Link>
                  </Button>
                ) : (
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
            <ResultsTable rows={tableRows} />
          )}
        </div>
      </div>
    </div>
  );
}

function ResultsBar({
  scope,
  listCount,
  clearScopeHref,
}: {
  scope: Scope;
  listCount: number;
  clearScopeHref: string;
}) {
  return (
    <div className="flex min-h-[26px] items-center gap-2.5">
      {scope === "mine" ? (
        <Link
          href={clearScopeHref}
          className="inline-flex items-center gap-1.5 rounded-md py-1 pr-1.5 pl-2.5 text-[11px] transition-colors hover:opacity-90"
          style={{
            background: "var(--ds-primary-50)",
            color: "var(--ds-primary-900)",
          }}
        >
          <UserFocus size={13} weight="duotone" color="var(--ds-primary-700)" />
          Mes projets
          <span
            className="ml-0.5 inline-flex size-4 items-center justify-center rounded-sm hover:bg-[var(--ds-primary-100)]"
            aria-label="Retirer le filtre Mes projets"
          >
            <X size={10} weight="bold" color="var(--ds-primary-700)" />
          </span>
        </Link>
      ) : null}
      <span className="text-[12px]" style={{ color: "var(--ds-text-tertiary)" }}>
        <b style={{ color: "var(--ds-text-muted)", fontWeight: 600 }}>{listCount}</b> projet
        {listCount > 1 ? "s" : ""}
      </span>
      <span
        className="ml-auto inline-flex items-center gap-1.5 text-[13px]"
        style={{ color: "var(--ds-text-muted)" }}
      >
        <ArrowsSort />
        Activité
      </span>
    </div>
  );
}

function ArrowsSort() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M4 3v10m0 0l-2-2m2 2l2-2M12 13V3m0 0l-2 2m2-2l2 2"
        stroke="var(--ds-text-tertiary)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function buildClearScopeHref({
  query,
  types,
  entitiesRaw,
  roles,
}: {
  query: string;
  types: ProjectKind[];
  entitiesRaw: string[];
  roles: Role[];
}): string {
  const sp = new URLSearchParams();
  if (query) sp.set("q", query);
  if (types.length > 0) sp.set("type", types.join(","));
  if (entitiesRaw.length > 0) sp.set("entity", entitiesRaw.join(","));
  // Rôles ne s'appliquent que dans le scope "mine" ; on les efface avec scope.
  void roles;
  const qs = sp.toString();
  return qs ? `/projets?${qs}` : "/projets";
}
