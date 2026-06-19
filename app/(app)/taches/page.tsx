import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { NotionFilters } from "@/components/table/notion-filters";
import { type SortState, parseSort, sortToParam } from "@/components/table/sortable-header";
import { TaskTable } from "@/components/tasks/task-table";
import type { TaskRowData } from "@/components/tasks/task-types";
import { Button } from "@/components/ui/button";
import { SearchInputWithClear } from "@/components/ui/search-input";
import { PersistViewParams } from "@/components/view-prefs/persist-view-params";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { taskAssignees } from "@/db/schema/task-assignees";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { fetchAssigneesForTasks } from "@/lib/db/queries/task-assignees";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import { collectF } from "@/lib/filters/url-helpers";
import { type TaskStatus, taskStatusEnum } from "@/lib/schemas/tasks";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { type SQL, and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { CheckSquare, Plus } from "lucide-react";
import Link from "next/link";

const SORT_FIELDS = ["title", "project", "status", "priority", "assignee", "dueDate"] as const;

const PERSISTED_KEYS = ["q", "f", "sort", "status", "scope"] as const;

function orderByFor(sort: SortState): SQL[] {
  if (!sort) return [asc(tasks.dueDate), asc(tasks.title)];
  const dir = sort.dir === "asc" ? asc : desc;
  switch (sort.field) {
    case "title":
      return [dir(tasks.title)];
    case "project":
      return [dir(projects.name), asc(tasks.title)];
    case "status":
      return [dir(tasks.status), asc(tasks.title)];
    case "priority":
      return [dir(tasks.priority), asc(tasks.title)];
    case "assignee":
      // En multi-assigné on trie côté JS si vraiment voulu — ici on
      // dégrade en tri par titre (l'assignée n'est plus une colonne
      // scalaire). UX : la pile d'avatars n'a pas d'ordre canonique
      // évident, le sort est moins intéressant qu'avant.
      return [asc(tasks.title)];
    case "dueDate":
      return [dir(tasks.dueDate), asc(tasks.title)];
    default:
      return [asc(tasks.dueDate), asc(tasks.title)];
  }
}

function buildHref(p: {
  q?: string;
  status?: string;
  scope?: string;
  sort?: string | null;
  filters?: string[];
}): string {
  const sp = new URLSearchParams();
  if (p.q) sp.set("q", p.q);
  if (p.status) sp.set("status", p.status);
  if (p.scope) sp.set("scope", p.scope);
  if (p.filters) for (const f of p.filters) sp.append("f", f);
  if (p.sort) sp.set("sort", p.sort);
  const qs = sp.toString();
  return qs ? `/taches?${qs}` : "/taches";
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const authUser = await requireUser();
  const params = await searchParams;
  await applyViewPrefRedirect({
    pageKey: "taches",
    pathname: "/taches",
    searchParams: params,
    relevantKeys: PERSISTED_KEYS,
  });
  const q = typeof params.q === "string" ? params.q : undefined;
  const status = typeof params.status === "string" ? params.status : undefined;
  const scope = typeof params.scope === "string" ? params.scope : undefined;
  const sort = typeof params.sort === "string" ? params.sort : undefined;
  const query = q?.trim() ?? "";
  const activeStatus =
    status && (taskStatusEnum.options.includes(status as TaskStatus) || status === "open")
      ? status
      : undefined;
  const onlyMine = scope === "mine";
  const sortState = parseSort(sort, SORT_FIELDS);

  const conn = await db();
  const conditions = [];

  // "Les miennes" : EXISTS sur task_assignees pour matcher les tâches où je
  // suis dans la liste des assignés (peut être 1 parmi N).
  if (onlyMine) {
    conditions.push(
      sql`EXISTS (SELECT 1 FROM ${taskAssignees} ta WHERE ta.task_id = ${tasks.id} AND ta.user_id = ${authUser.id})`,
    );
  }

  if (activeStatus === "open") {
    conditions.push(sql`${tasks.status} not in ('done', 'cancelled')`);
  } else if (activeStatus) {
    conditions.push(eq(tasks.status, activeStatus as TaskStatus));
  }

  if (query) {
    const like = or(ilike(tasks.title, `%${query}%`), ilike(projects.name, `%${query}%`));
    if (like) conditions.push(like);
  }

  // Notion filters (filtres riches additionnels) — récupère les options
  // dynamiques avant de parser/appliquer les filtres URL. En parallèle.
  const [projectOptionsForFilter, userOptionsForFilter] = await Promise.all([
    conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .orderBy(asc(projects.name)),
    conn
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .orderBy(asc(users.fullName)),
  ]);

  const FILTER_DEFS = [
    {
      key: "status",
      label: "Statut",
      type: "enum" as const,
      options: taskStatusEnum.options.map((s) => ({ value: s, label: s })),
    },
    {
      key: "priority",
      label: "Priorité",
      type: "enum" as const,
      options: [
        { value: "low", label: "Basse" },
        { value: "medium", label: "Moyenne" },
        { value: "high", label: "Haute" },
        { value: "urgent", label: "Urgente" },
      ],
    },
    {
      key: "project",
      label: "Projet",
      type: "enum" as const,
      options: projectOptionsForFilter.map((p) => ({ value: p.id, label: p.name })),
    },
    {
      key: "assignee",
      label: "Assignée",
      type: "enum" as const,
      options: userOptionsForFilter.map((u) => ({
        value: u.id,
        label: u.fullName ?? "(sans nom)",
      })),
    },
    { key: "title", label: "Titre", type: "text" as const },
    { key: "dueDate", label: "Échéance", type: "date" as const },
  ];

  const richFilters = parseFiltersFromSearchParams(
    params,
    FILTER_DEFS.map((d) => d.key),
  );
  const richFilterColumns = [
    { key: "status", column: tasks.status, kind: "enum" as const },
    { key: "priority", column: tasks.priority, kind: "enum" as const },
    { key: "project", column: tasks.projectId, kind: "enum" as const },
    { key: "title", column: tasks.title, kind: "text" as const },
    { key: "dueDate", column: tasks.dueDate, kind: "date" as const },
  ];
  const richConditions = applyFilters(richFilters, richFilterColumns);
  conditions.push(...richConditions);
  // Le filtre "assignee" ne peut plus s'exprimer sur une colonne unique
  // (multi-assigné) — on le traduit en EXISTS sur task_assignees.
  for (const f of richFilters) {
    if (f.key !== "assignee") continue;
    const raw = Array.isArray(f.value) ? f.value : f.value == null ? [] : [f.value];
    const ids = raw.filter((v): v is string => typeof v === "string" && v.length > 0);
    if (ids.length === 0) continue;
    const positive = f.op === "is" || f.op === "in";
    const clause = sql`EXISTS (
      SELECT 1 FROM ${taskAssignees} ta
      WHERE ta.task_id = ${tasks.id}
      AND ta.user_id = ANY(ARRAY[${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )}]::uuid[])
    )`;
    conditions.push(positive ? clause : sql`NOT (${clause})`);
  }

  const [rawTasks, projectOptions, userOptions, contactOptions] = await Promise.all([
    conn
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        projectId: projects.id,
        projectName: projects.name,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...orderByFor(sortState)),
    conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .orderBy(asc(projects.name)),
    conn
      .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
      .from(users)
      .orderBy(asc(users.fullName)),
    conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        entityName: entities.name,
      })
      .from(contacts)
      .leftJoin(entities, eq(contacts.entityId, entities.id))
      .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
  ]);

  const assigneesByTask = await fetchAssigneesForTasks(
    conn,
    rawTasks.map((r) => r.id),
  );

  const contactOptionsForEditor = contactOptions.map((c) => ({
    id: c.id,
    fullName: `${c.firstName} ${c.lastName}`.trim(),
    entityName: c.entityName ?? null,
  }));

  // Pré-calcule un href par champ triable. La fonction `buildHref` ne peut
  // pas traverser la frontière server → client component, donc on sérialise
  // l'état "où aller si on clique sur cette colonne" sous forme de map.
  const sortHrefsMap = Object.fromEntries(
    SORT_FIELDS.map((field) => {
      const isActive = sortState?.field === field;
      const next = !isActive
        ? { field, dir: "asc" as const }
        : sortState?.dir === "asc"
          ? { field, dir: "desc" as const }
          : null;
      return [
        field,
        buildHref({
          q: query,
          status: activeStatus,
          filters: collectF(params),
          scope: onlyMine ? "mine" : undefined,
          sort: sortToParam(next),
        }),
      ];
    }),
  );

  const taskRows: TaskRowData[] = rawTasks.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueDate: row.dueDate,
    projectId: row.projectId,
    projectName: row.projectName,
    assignees: assigneesByTask.get(row.id) ?? [],
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Delivery"
        title="Tâches"
        description="Toutes les tâches actives, par défaut."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/taches/gantt">Gantt</Link>
            </Button>
            <Button asChild>
              <Link href="/taches/nouveau">
                <Plus className="size-4" />
                Nouvelle tâche
              </Link>
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <FilterLink href="/taches" active={!activeStatus && !onlyMine} label="Tous" />
        <FilterLink href="/taches?status=open" active={activeStatus === "open"} label="Ouvertes" />
        <FilterLink
          href="/taches?scope=mine&status=open"
          active={onlyMine && activeStatus === "open"}
          label="Les miennes"
        />
        <FilterLink href="/taches?status=done" active={activeStatus === "done"} label="Terminées" />
      </div>

      <NotionFilters
        pathname="/taches"
        filterDefs={FILTER_DEFS}
        activeFilters={richFilters.map((f) => ({ key: f.key, op: f.op, value: f.value }))}
      />
      <PersistViewParams pageKey="taches" relevantKeys={PERSISTED_KEYS} />

      <form className="max-w-sm">
        <SearchInputWithClear
          name="q"
          defaultValue={query}
          placeholder="Rechercher par titre, projet…"
        />
        {activeStatus ? <input type="hidden" name="status" value={activeStatus} /> : null}
        {onlyMine ? <input type="hidden" name="scope" value="mine" /> : null}
        {collectF(params).map((f, i) => (
          <input key={`f-${i}-${f}`} type="hidden" name="f" value={f} />
        ))}
        {sort ? <input type="hidden" name="sort" value={sort} /> : null}
      </form>

      {rawTasks.length === 0 ? (
        <EmptyState
          icon={CheckSquare}
          title={query ? "Aucune tâche trouvée." : "Aucune tâche pour ce filtre."}
          action={
            query ? null : (
              <Button asChild size="sm">
                <Link href="/taches/nouveau">
                  <Plus className="size-4" />
                  Nouvelle tâche
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <TaskTable
          rows={taskRows}
          userOptions={userOptions}
          contactOptions={contactOptionsForEditor}
          projectOptions={projectOptions}
          sort={sortState}
          sortHrefs={sortHrefsMap}
        />
      )}
    </div>
  );
}
function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
        active ? "bg-foreground text-background" : "hover:bg-muted"
      }`}
    >
      {label}
    </Link>
  );
}
