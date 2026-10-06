import {
  ArrowBendDownRight,
  Briefcase,
  CalendarBlank,
  CheckSquare,
} from "@phosphor-icons/react/dist/ssr";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import Link from "next/link";
import { AvatarStack, type StackedAssignee } from "@/components/tasks/avatar-stack";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { taskAssignees } from "@/db/schema/task-assignees";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { DemoBlur, EntityName, ProjectName } from "@/lib/demo/components";
import {
  FALLBACK_STATUS,
  projectTint,
  SectionHeader,
  STATUS_PILL,
  shortDateFmt,
  todayIso,
} from "./shared";

const ACTIVE_STATUSES = ["planning", "active", "to_follow_up", "awaiting_response"] as const;

export function ProjectsSectionHeader({ total }: { total?: number }) {
  return (
    <SectionHeader
      icon={<Briefcase weight="duotone" className="size-4.5 text-primary-500" />}
      title="Mes projets en cours"
      right={
        <Link href="/projets" className="text-primary-700 text-sm hover:underline">
          Tout voir{total !== undefined ? ` (${total})` : ""}
        </Link>
      }
    />
  );
}

export async function ProjectsSection() {
  await requireUser();
  const conn = await db();
  const today = todayIso();

  const [activeProjects, [activeProjectsTotalRow]] = await Promise.all([
    // projets en cours (4 plus récents)
    conn
      .select({
        id: projects.id,
        name: projects.name,
        color: projects.color,
        status: projects.status,
        entityId: entities.id,
        entityName: entities.name,
        updatedAt: projects.updatedAt,
      })
      .from(projects)
      .leftJoin(entities, eq(projects.entityId, entities.id))
      .where(inArray(projects.status, [...ACTIVE_STATUSES]))
      .orderBy(desc(projects.updatedAt))
      .limit(4),
    // total projets en cours
    conn
      .select({ count: sql<number>`count(*)::int` })
      .from(projects)
      .where(inArray(projects.status, [...ACTIVE_STATUSES])),
  ]);

  // Dépend des ids de la première vague.
  const projIds = activeProjects.map((p) => p.id);
  const [projTaskCounts, nextStepCandidates, teamRows] =
    projIds.length > 0
      ? await Promise.all([
          conn
            .select({
              projectId: tasks.projectId,
              total: sql<number>`count(*)::int`,
              done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
              open: sql<number>`count(*) filter (where ${tasks.status} not in ('done', 'cancelled'))::int`,
            })
            .from(tasks)
            .where(inArray(tasks.projectId, projIds))
            .groupBy(tasks.projectId),
          conn
            .select({
              projectId: tasks.projectId,
              title: tasks.title,
              dueDate: tasks.dueDate,
              createdAt: tasks.createdAt,
            })
            .from(tasks)
            .where(
              and(
                inArray(tasks.projectId, projIds),
                sql`${tasks.status} not in ('done', 'cancelled')`,
              ),
            )
            .orderBy(asc(tasks.dueDate), asc(tasks.createdAt)),
          conn
            .select({
              projectId: tasks.projectId,
              userId: users.id,
              userName: users.fullName,
              userAvatarUrl: users.avatarUrl,
            })
            .from(taskAssignees)
            .innerJoin(tasks, eq(taskAssignees.taskId, tasks.id))
            .innerJoin(users, eq(taskAssignees.userId, users.id))
            .where(
              and(
                inArray(tasks.projectId, projIds),
                sql`${tasks.status} not in ('done', 'cancelled')`,
                eq(taskAssignees.kind, "user"),
              ),
            ),
        ])
      : [[], [], []];

  // counts done/open par projet
  const countsMap = new Map(
    projTaskCounts.filter((r) => r.projectId != null).map((r) => [r.projectId as string, r]),
  );

  // "next step" : prochaine tâche ouverte par projet (asc due_date, asc createdAt)
  const nextStepMap = new Map<string, { title: string; dueDate: string | null }>();
  for (const row of nextStepCandidates) {
    if (!row.projectId || nextStepMap.has(row.projectId)) continue;
    nextStepMap.set(row.projectId, { title: row.title, dueDate: row.dueDate });
  }

  // team par projet : users distincts assignés à des tâches ouvertes du projet
  const teamMap = new Map<string, StackedAssignee[]>();
  for (const r of teamRows) {
    if (!r.projectId) continue;
    const list = teamMap.get(r.projectId) ?? [];
    if (!list.some((a) => a.kind === "user" && a.id === r.userId)) {
      list.push({
        kind: "user",
        id: r.userId,
        fullName: r.userName,
        avatarUrl: r.userAvatarUrl,
      });
    }
    teamMap.set(r.projectId, list);
  }

  return (
    <section>
      <ProjectsSectionHeader total={activeProjectsTotalRow?.count ?? 0} />
      <div className="flex flex-col gap-2.5">
        {activeProjects.length === 0 ? (
          <div className="rounded-lg border border-ds-border bg-ds-app p-5 text-ds-text-tertiary text-sm">
            Aucun projet actif pour l'instant.
          </div>
        ) : (
          activeProjects.map((p) => {
            const counts = countsMap.get(p.id);
            const total = counts?.total ?? 0;
            const done = counts?.done ?? 0;
            const open = counts?.open ?? 0;
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const next = nextStepMap.get(p.id);
            const team = teamMap.get(p.id) ?? [];
            const tint = projectTint({ id: p.id, color: p.color });
            const status = STATUS_PILL[p.status] ?? FALLBACK_STATUS;
            const dueOverdue = !!next?.dueDate && next.dueDate < today;
            return (
              <Link
                key={p.id}
                href={`/projets/${p.id}`}
                className="projcard block rounded-[10px] border border-ds-border bg-ds-app p-4 transition-shadow hover:border-ds-border-strong hover:shadow-[0_1px_3px_rgba(15,15,15,0.08),0_6px_16px_rgba(15,15,15,0.05)]"
              >
                <div className="mb-2 flex items-center gap-2.5">
                  <span
                    className="size-[11px] flex-none rounded-full"
                    style={{ background: tint }}
                  />
                  <ProjectName
                    project={p}
                    className="min-w-0 flex-1 truncate font-medium text-ds-text text-sm"
                  />
                  <span
                    className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-medium text-[11px]"
                    style={{ background: status.bg, color: status.text }}
                  >
                    <span className="size-[6px] rounded-full" style={{ background: status.dot }} />
                    {status.label}
                  </span>
                </div>
                <div className="mb-2.5 flex items-center gap-2 text-ds-text-tertiary text-xs">
                  <EntityName entity={p.entityId ? { id: p.entityId, name: p.entityName } : null} />
                  <span
                    className="inline-block size-[3px] rounded-full"
                    style={{ background: "var(--ds-border-strong)" }}
                  />
                  <span className="font-mono text-[11px]">{pct}%</span>
                </div>
                <div className="mb-2.5 h-[5px] overflow-hidden rounded-full bg-ds-hover">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${pct}%`, background: tint }}
                  />
                </div>
                {next ? (
                  <div className="mb-2.5 flex items-center gap-2 rounded-md bg-ds-surface px-2.5 py-1.5">
                    <ArrowBendDownRight
                      weight="duotone"
                      className="size-3.5 flex-none"
                      style={{ color: tint }}
                    />
                    <span className="min-w-0 flex-1 truncate text-ds-text-muted text-xs">
                      <DemoBlur>{next.title}</DemoBlur>
                    </span>
                  </div>
                ) : null}
                <div className="flex items-center gap-3.5 text-ds-text-muted text-xs">
                  <span className="inline-flex items-center gap-1.5">
                    <CheckSquare weight="duotone" className="size-3.5 text-ds-text-tertiary" />
                    {open} tâche{open > 1 ? "s" : ""}
                  </span>
                  <span
                    className={`inline-flex items-center gap-1.5 ${dueOverdue ? "text-tint-red-text" : ""}`}
                  >
                    <CalendarBlank weight="duotone" className="size-3.5" />
                    {next?.dueDate ? shortDateFmt.format(new Date(next.dueDate)) : "—"}
                  </span>
                  <span className="flex-1" />
                  <AvatarStack assignees={team} max={3} />
                </div>
              </Link>
            );
          })
        )}
      </div>
    </section>
  );
}
