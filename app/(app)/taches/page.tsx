import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
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
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { type TaskStatus, taskStatusEnum } from "@/lib/schemas/tasks";
import { type SQL, and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { CheckSquare, Plus } from "lucide-react";
import Link from "next/link";

const SORT_FIELDS = ["title", "project", "status", "priority", "assignee", "dueDate"] as const;

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

function buildHref(params: {
  q?: string;
  status?: string;
  scope?: string;
  sort?: string | null;
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.status) sp.set("status", params.status);
  if (params.scope) sp.set("scope", params.scope);
  if (params.sort) sp.set("sort", params.sort);
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

type SearchParams = Promise<{
  q?: string;
  status?: TaskStatus | "open";
  scope?: "mine" | "all";
  sort?: string;
}>;

export default async function TasksPage({ searchParams }: { searchParams: SearchParams }) {
  const authUser = await requireUser();
  const { q, status, scope, sort } = await searchParams;
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
    conditions.push(eq(tasks.status, activeStatus));
  }

  if (query) {
    conditions.push(or(ilike(tasks.title, `%${query}%`), ilike(projects.name, `%${query}%`)));
  }

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
          <Button asChild>
            <Link href="/taches/nouveau">
              <Plus className="size-4" />
              Nouvelle tâche
            </Link>
          </Button>
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

      <form className="max-w-sm">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Rechercher par titre, projet…"
          className="h-9"
        />
        {activeStatus ? <input type="hidden" name="status" value={activeStatus} /> : null}
        {onlyMine ? <input type="hidden" name="scope" value="mine" /> : null}
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
