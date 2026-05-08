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
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
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
      return [dir(users.fullName), asc(tasks.title)];
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
import { TaskAssigneeEditor } from "./inline-editors/assignee-editor";
import { TaskDueDateEditor } from "./inline-editors/due-date-editor";
import { TaskPriorityEditor } from "./inline-editors/priority-editor";
import { TaskProjectEditor } from "./inline-editors/project-editor";
import { TaskRowActions } from "./inline-editors/row-actions";
import { TaskStatusEditor } from "./inline-editors/status-editor";
import { QuickAddTask } from "./quick-add-task";
import { TaskToggle } from "./task-toggle";

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

  if (onlyMine) conditions.push(eq(tasks.assigneeId, authUser.id));

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
  // dynamiques avant de parser/appliquer les filtres URL.
  const projectOptionsForFilter = await (await db())
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .orderBy(asc(projects.name));
  const userOptionsForFilter = await (await db())
    .select({ id: users.id, fullName: users.fullName })
    .from(users)
    .orderBy(asc(users.fullName));

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
    { key: "assignee", column: tasks.assigneeId, kind: "enum" as const },
    { key: "title", column: tasks.title, kind: "text" as const },
    { key: "dueDate", column: tasks.dueDate, kind: "date" as const },
  ];
  const richConditions = applyFilters(richFilters, richFilterColumns);
  conditions.push(...richConditions);

  const [rows, projectOptions, userOptions] = await Promise.all([
    conn
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        projectId: projects.id,
        projectName: projects.name,
        assigneeId: users.id,
        assigneeName: users.fullName,
        assigneeAvatarUrl: users.avatarUrl,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .leftJoin(users, eq(tasks.assigneeId, users.id))
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
  ]);

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
        <Input
          name="q"
          defaultValue={query}
          placeholder="Rechercher par titre, projet…"
          className="h-9"
        />
        {activeStatus ? <input type="hidden" name="status" value={activeStatus} /> : null}
        {onlyMine ? <input type="hidden" name="scope" value="mine" /> : null}
        {collectF(params).map((f, i) => (
          <input key={`f-${i}-${f}`} type="hidden" name="f" value={f} />
        ))}
        {sort ? <input type="hidden" name="sort" value={sort} /> : null}
      </form>

      <QuickAddTask placeholder="+ Ajouter une tâche… (Entrée pour valider)" />

      {rows.length === 0 ? (
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
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>
                  <SortableHeader
                    label="Tâche"
                    field="title"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({
                        q: query,
                        status: activeStatus,
                        filters: collectF(params),
                        scope: onlyMine ? "mine" : undefined,
                        sort: sortToParam(next),
                      })
                    }
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Projet"
                    field="project"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({
                        q: query,
                        status: activeStatus,
                        filters: collectF(params),
                        scope: onlyMine ? "mine" : undefined,
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
                        q: query,
                        status: activeStatus,
                        filters: collectF(params),
                        scope: onlyMine ? "mine" : undefined,
                        sort: sortToParam(next),
                      })
                    }
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Priorité"
                    field="priority"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({
                        q: query,
                        status: activeStatus,
                        filters: collectF(params),
                        scope: onlyMine ? "mine" : undefined,
                        sort: sortToParam(next),
                      })
                    }
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Assignée"
                    field="assignee"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({
                        q: query,
                        status: activeStatus,
                        filters: collectF(params),
                        scope: onlyMine ? "mine" : undefined,
                        sort: sortToParam(next),
                      })
                    }
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Échéance"
                    field="dueDate"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({
                        q: query,
                        status: activeStatus,
                        filters: collectF(params),
                        scope: onlyMine ? "mine" : undefined,
                        sort: sortToParam(next),
                      })
                    }
                  />
                </TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <TaskToggle id={row.id} done={row.status === "done"} />
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/taches/${row.id}`}
                      className={`hover:underline ${row.status === "done" ? "text-muted-foreground line-through" : ""}`}
                    >
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <TaskProjectEditor
                      id={row.id}
                      value={
                        row.projectId ? { id: row.projectId, name: row.projectName ?? "" } : null
                      }
                      options={projectOptions}
                    />
                  </TableCell>
                  <TableCell>
                    <TaskStatusEditor id={row.id} value={row.status} />
                  </TableCell>
                  <TableCell>
                    <TaskPriorityEditor id={row.id} value={row.priority} />
                  </TableCell>
                  <TableCell>
                    <TaskAssigneeEditor
                      id={row.id}
                      value={
                        row.assigneeId
                          ? {
                              id: row.assigneeId,
                              fullName: row.assigneeName,
                              avatarUrl: row.assigneeAvatarUrl,
                            }
                          : null
                      }
                      options={userOptions}
                    />
                  </TableCell>
                  <TableCell>
                    <TaskDueDateEditor id={row.id} value={row.dueDate} />
                  </TableCell>
                  <TableCell>
                    <TaskRowActions id={row.id} title={row.title} />
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
