import { AvatarStack, type StackedAssignee } from "@/components/tasks/avatar-stack";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { taskAssignees } from "@/db/schema/task-assignees";
import { tasks } from "@/db/schema/tasks";
import { timeEntries } from "@/db/schema/time-entries";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { getCalendarEventsForRange } from "@/lib/db/queries/calendar";
import { db } from "@/lib/db/server";
import { DemoBlur, EntityName, EuroAmount, ProjectName } from "@/lib/demo/components";
import {
  ArrowBendDownRight,
  ArrowUpRight,
  BellRinging,
  Briefcase,
  CalendarBlank,
  CalendarDots,
  CheckSquare,
  Clock,
  MapPin,
  Plus,
  Receipt,
  Sigma,
  VideoCamera,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { and, asc, desc, eq, gte, inArray, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import Link from "next/link";
import { type DashboardTask, DashboardTasksPanel } from "./dashboard-tasks";

// ─── helpers ──────────────────────────────────────────────────────────

function todayIso(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

const dayLabelFmt = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const shortDateFmt = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });
const hourFmt = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Bucket par rapport à aujourd'hui (string YYYY-MM-DD).
function bucketFor(due: string | null, today: string, weekEnd: string): DashboardTask["bucket"] {
  if (!due) return "later";
  if (due < today) return "overdue";
  if (due === today) return "today";
  if (due <= weekEnd) return "week";
  return "later";
}

function dueLabelFor(due: string | null, today: string): string {
  if (!due) return "—";
  if (due === today) return "Auj.";
  return shortDateFmt.format(new Date(due));
}

// 8 tints pour colorier les projets (skip gray).
const PROJECT_TINTS: string[] = [
  "var(--ds-tint-orange-dot)",
  "var(--ds-tint-blue-dot)",
  "var(--ds-tint-green-dot)",
  "var(--ds-tint-mauve-dot)",
  "var(--ds-tint-pink-dot)",
  "var(--ds-tint-yellow-dot)",
  "var(--ds-tint-brown-dot)",
  "var(--ds-tint-red-dot)",
];
function projectTint(p: { id: string; color: string | null }): string {
  if (p.color && /^#[0-9a-fA-F]{6}$/.test(p.color)) return p.color;
  // hash id en index stable
  let h = 0;
  for (const c of p.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PROJECT_TINTS[h % PROJECT_TINTS.length] ?? "var(--ds-tint-blue-dot)";
}

// ─── page ────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const authUser = await requireUser();
  const conn = await db();

  const [profile] = await conn
    .select({ fullName: users.fullName, avatarUrl: users.avatarUrl })
    .from(users)
    .where(eq(users.id, authUser.id))
    .limit(1);

  const firstName =
    profile?.fullName?.trim().split(/\s+/)[0] ?? authUser.email?.split("@")[0] ?? "toi";
  const todayLabel = capitalize(dayLabelFmt.format(new Date()));

  const today = todayIso();
  const weekEnd = isoDaysFromNow(7);
  const last7Start = isoDaysFromNow(-7);
  const dayStart = startOfDay();
  const dayEnd = endOfDay();

  // ─── tâches ouvertes (multi-assignées au user) ────────────────────
  const myOpenTasksRows = await conn
    .select({
      id: tasks.id,
      title: tasks.title,
      priority: tasks.priority,
      dueDate: tasks.dueDate,
      projectId: projects.id,
      projectName: projects.name,
      projectColor: projects.color,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        sql`${tasks.status} not in ('done', 'cancelled')`,
        sql`EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = ${tasks.id} AND ta.user_id = ${authUser.id})`,
      ),
    )
    .orderBy(asc(tasks.dueDate), asc(tasks.title));

  const myTaskIds = myOpenTasksRows.map((t) => t.id);

  // assignees pour chaque tâche (en 1 requête)
  const taskAssigneesRows =
    myTaskIds.length > 0
      ? await conn
          .select({
            taskId: taskAssignees.taskId,
            kind: taskAssignees.kind,
            userId: taskAssignees.userId,
            userName: users.fullName,
            userAvatarUrl: users.avatarUrl,
            contactId: taskAssignees.contactId,
            contactFirstName: contacts.firstName,
            contactLastName: contacts.lastName,
            contactEntityName: entities.name,
          })
          .from(taskAssignees)
          .leftJoin(users, eq(taskAssignees.userId, users.id))
          .leftJoin(contacts, eq(taskAssignees.contactId, contacts.id))
          .leftJoin(entities, eq(contacts.entityId, entities.id))
          .where(inArray(taskAssignees.taskId, myTaskIds))
      : [];

  const taskAssigneeMap = new Map<string, StackedAssignee[]>();
  for (const r of taskAssigneesRows) {
    const list = taskAssigneeMap.get(r.taskId) ?? [];
    if (r.kind === "user" && r.userId) {
      list.push({
        kind: "user",
        id: r.userId,
        fullName: r.userName,
        avatarUrl: r.userAvatarUrl,
      });
    } else if (r.kind === "contact" && r.contactId) {
      list.push({
        kind: "contact",
        id: r.contactId,
        fullName: `${r.contactFirstName ?? ""} ${r.contactLastName ?? ""}`.trim(),
        entityName: r.contactEntityName ?? null,
      });
    }
    taskAssigneeMap.set(r.taskId, list);
  }

  const dashTasks: DashboardTask[] = myOpenTasksRows.map((t) => ({
    id: t.id,
    title: t.title,
    priority: t.priority,
    bucket: bucketFor(t.dueDate, today, weekEnd),
    dueDate: t.dueDate,
    dueLabel: dueLabelFor(t.dueDate, today),
    projectId: t.projectId,
    projectName: t.projectName,
    projectTint: t.projectId
      ? projectTint({ id: t.projectId, color: t.projectColor ?? null })
      : "var(--ds-border-strong)",
    assignees: taskAssigneeMap.get(t.id) ?? [],
  }));

  const overdueCount = dashTasks.filter((t) => t.bucket === "overdue").length;

  const [doneTodayRow] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        sql`${tasks.status} = 'done'`,
        sql`${tasks.completedAt} >= ${dayStart.toISOString()}`,
        sql`EXISTS (SELECT 1 FROM task_assignees ta WHERE ta.task_id = ${tasks.id} AND ta.user_id = ${authUser.id})`,
      ),
    );
  const doneTodayCount = doneTodayRow?.count ?? 0;

  // ─── projets en cours ────────────────────────────────────────────
  const activeProjects = await conn
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
    .where(inArray(projects.status, ["planning", "active", "to_follow_up", "awaiting_response"]))
    .orderBy(desc(projects.updatedAt))
    .limit(4);

  const projIds = activeProjects.map((p) => p.id);

  // counts done/open par projet
  const projTaskCounts =
    projIds.length > 0
      ? await conn
          .select({
            projectId: tasks.projectId,
            total: sql<number>`count(*)::int`,
            done: sql<number>`count(*) filter (where ${tasks.status} = 'done')::int`,
            open: sql<number>`count(*) filter (where ${tasks.status} not in ('done', 'cancelled'))::int`,
          })
          .from(tasks)
          .where(inArray(tasks.projectId, projIds))
          .groupBy(tasks.projectId)
      : [];
  const countsMap = new Map(
    projTaskCounts.filter((r) => r.projectId != null).map((r) => [r.projectId as string, r]),
  );

  // "next step" : prochaine tâche ouverte par projet (asc due_date, asc createdAt)
  const nextStepCandidates =
    projIds.length > 0
      ? await conn
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
          .orderBy(asc(tasks.dueDate), asc(tasks.createdAt))
      : [];
  const nextStepMap = new Map<string, { title: string; dueDate: string | null }>();
  for (const row of nextStepCandidates) {
    if (!row.projectId || nextStepMap.has(row.projectId)) continue;
    nextStepMap.set(row.projectId, { title: row.title, dueDate: row.dueDate });
  }

  // team par projet : users distincts assignés à des tâches ouvertes du projet
  const teamRows =
    projIds.length > 0
      ? await conn
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
          )
      : [];
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

  const [activeProjectsTotalRow] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(inArray(projects.status, ["planning", "active", "to_follow_up", "awaiting_response"]));

  // ─── agenda du jour ──────────────────────────────────────────────
  const agendaRaw = await getCalendarEventsForRange(authUser.id, dayStart, dayEnd);
  const agenda = agendaRaw
    .filter((e) => !e.allDay)
    .slice(0, 4)
    .map((e) => {
      const isPhysical = !!e.location && !/visio|meet|zoom|http/i.test(e.location);
      const dot =
        e.calendarBackgroundColor && /^#[0-9a-fA-F]{6}$/.test(e.calendarBackgroundColor)
          ? e.calendarBackgroundColor
          : "var(--ds-primary-400)";
      return {
        id: e.id,
        time: hourFmt.format(e.startAt),
        title: e.summary ?? "Sans titre",
        meta: e.location || (e.calendarSummary ?? ""),
        dot,
        physical: isPhysical,
      };
    });

  // ─── relances cette semaine ──────────────────────────────────────
  const relances = await conn
    .select({
      id: projects.id,
      title: projects.name,
      followUpDate: projects.followUpDate,
      status: projects.status,
      entityId: entities.id,
      entityName: entities.name,
      color: projects.color,
    })
    .from(projects)
    .leftJoin(entities, eq(projects.entityId, entities.id))
    .where(
      and(
        isNotNull(projects.followUpDate),
        gte(projects.followUpDate, today),
        lte(projects.followUpDate, weekEnd),
        ne(projects.status, "lost"),
      ),
    )
    .orderBy(asc(projects.followUpDate))
    .limit(5);

  const [relancesAggRow] = await conn
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${projects.valueAmount}), 0)`,
    })
    .from(projects)
    .where(
      and(
        isNotNull(projects.followUpDate),
        gte(projects.followUpDate, today),
        lte(projects.followUpDate, weekEnd),
        ne(projects.status, "lost"),
      ),
    );

  // ─── temps tracké (7 derniers jours, mon temps réel) ──────────────
  const [trackedRow] = await conn
    .select({
      minutes: sql<number>`coalesce(sum(extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60), 0)::int`,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, authUser.id),
        eq(timeEntries.kind, "actual"),
        gte(timeEntries.startAt, new Date(`${last7Start}T00:00:00Z`)),
      ),
    );
  const [trackedTotalRow] = await conn
    .select({
      minutes: sql<number>`coalesce(sum(extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60), 0)::int`,
    })
    .from(timeEntries)
    .where(and(eq(timeEntries.userId, authUser.id), eq(timeEntries.kind, "actual")));

  const trackedHours = Math.round((trackedRow?.minutes ?? 0) / 60);
  const trackedTotalHours = Math.round((trackedTotalRow?.minutes ?? 0) / 60);

  // ─── factures à encaisser (sent, non payées) ──────────────────────
  const [toCollectRow] = await conn
    .select({
      total: sql<string>`coalesce(sum(${invoices.amountHt}), 0)`,
      count: sql<number>`count(*)::int`,
      overdue: sql<number>`count(*) filter (where ${invoices.invoicedAt} < now() - interval '30 days')::int`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, "sent"),
        or(
          eq(invoices.kind, "milestone"),
          eq(invoices.kind, "coworking"),
          eq(invoices.kind, "one_off"),
        ),
      ),
    );
  const toCollect = Number(toCollectRow?.total ?? 0);
  const toCollectCount = toCollectRow?.count ?? 0;
  const toCollectOverdue = toCollectRow?.overdue ?? 0;

  // KPI strip
  const relancesCount = relancesAggRow?.count ?? 0;
  const relancesTotal = Number(relancesAggRow?.total ?? 0);

  return (
    <div className="mx-auto flex max-w-[1280px] flex-col gap-6">
      {/* greeting */}
      <div className="flex items-end gap-4">
        <div>
          <div className="font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.12em]">
            {todayLabel}
          </div>
          <h1 className="mt-2 whitespace-nowrap font-brand font-semibold text-[30px] text-ds-text leading-tight">
            Bonjour {firstName}.
          </h1>
        </div>
        <span className="flex-1" />
        <Link
          href="/taches/nouveau"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-3.5 py-2.5 font-medium text-sm text-white transition-colors hover:bg-primary-700"
        >
          <Plus weight="bold" className="size-3.5" />
          Nouvelle tâche
        </Link>
      </div>

      {/* metrics strip */}
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <MetricCard
          href="/taches?scope=mine&status=open"
          label="Tâches en retard"
          icon={<WarningCircle weight="duotone" className="size-5 text-tint-red-dot" />}
          value={String(overdueCount)}
          sub={overdueCount > 0 ? "à traiter" : "à jour"}
          valueClassName={overdueCount > 0 ? "text-tint-red-text" : "text-ds-text"}
          footIcon={<CheckSquare weight="duotone" className="size-3.5 text-ds-text-muted" />}
          footText={`${doneTodayCount} terminée${doneTodayCount > 1 ? "s" : ""} aujourd'hui`}
          footClassName="text-ds-text-muted"
        />
        <MetricCard
          href="/projets"
          label="Relances à effectuer"
          icon={<BellRinging weight="duotone" className="size-5 text-tint-orange-dot" />}
          value={String(relancesCount)}
          sub={relancesCount > 1 ? "clients" : "client"}
          valueClassName="text-ds-text"
          footIcon={<Briefcase weight="duotone" className="size-3.5 text-ds-text-muted" />}
          footText={
            <>
              Pipeline · <EuroAmount value={relancesTotal} demoId="kpi-relances" compact />
            </>
          }
          footClassName="text-ds-text-muted"
        />
        <MetricCard
          href="/temps"
          label="Temps tracké"
          icon={<Clock weight="duotone" className="size-5 text-primary-500" />}
          value={`${trackedHours}h`}
          sub="7 derniers jours"
          valueClassName="text-ds-text"
          footIcon={<Sigma weight="duotone" className="size-3.5 text-ds-text-muted" />}
          footText={`${trackedTotalHours}h au total`}
          footClassName="text-ds-text-muted"
        />
        <MetricCard
          href="/compta"
          label="À encaisser"
          icon={<Receipt weight="duotone" className="size-5 text-tint-mauve-dot" />}
          value={<EuroAmount value={toCollect} demoId="kpi-to-collect" compact />}
          sub={`${toCollectCount} facture${toCollectCount > 1 ? "s" : ""}`}
          valueClassName="text-ds-text"
          footIcon={
            <Warning
              weight="duotone"
              className={
                toCollectOverdue > 0
                  ? "size-3.5 text-tint-orange-text"
                  : "size-3.5 text-ds-text-muted"
              }
            />
          }
          footText={toCollectOverdue > 0 ? `${toCollectOverdue} en retard` : "aucune en retard"}
          footClassName={toCollectOverdue > 0 ? "text-tint-orange-text" : "text-ds-text-muted"}
        />
      </div>

      {/* two-column body */}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        {/* LEFT: tasks */}
        <DashboardTasksPanel tasks={dashTasks} doneCount={doneTodayCount} />

        {/* RIGHT: projects + agenda + relances */}
        <div className="flex flex-col gap-6">
          {/* projets */}
          <section>
            <div className="mb-3 flex items-center gap-2.5">
              <Briefcase weight="duotone" className="size-4.5 text-primary-500" />
              <h2 className="font-semibold text-[16px] text-ds-text">Mes projets en cours</h2>
              <span className="flex-1" />
              <Link href="/projets" className="text-primary-700 text-sm hover:underline">
                Tout voir ({activeProjectsTotalRow?.count ?? 0})
              </Link>
            </div>
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
                          <span
                            className="size-[6px] rounded-full"
                            style={{ background: status.dot }}
                          />
                          {status.label}
                        </span>
                      </div>
                      <div className="mb-2.5 flex items-center gap-2 text-ds-text-tertiary text-xs">
                        <EntityName
                          entity={p.entityId ? { id: p.entityId, name: p.entityName } : null}
                        />
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
                          <CheckSquare
                            weight="duotone"
                            className="size-3.5 text-ds-text-tertiary"
                          />
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

          {/* agenda */}
          <section>
            <div className="mb-3 flex items-center gap-2.5">
              <CalendarDots weight="duotone" className="size-4.5 text-primary-500" />
              <h2 className="font-semibold text-[16px] text-ds-text">Aujourd'hui</h2>
              <span className="flex-1" />
              <span className="text-ds-text-tertiary text-sm">{agenda.length} rendez-vous</span>
            </div>
            <div className="overflow-hidden rounded-[10px] border border-ds-border">
              {agenda.length === 0 ? (
                <div className="bg-ds-app px-3.5 py-4 text-ds-text-tertiary text-sm">
                  Aucun rendez-vous aujourd'hui.
                </div>
              ) : (
                agenda.map((e, i) => (
                  <div
                    key={e.id}
                    className={`flex items-center gap-3 bg-ds-app px-3.5 py-2.5 transition-colors hover:bg-ds-hover ${i < agenda.length - 1 ? "border-ds-border border-b" : ""}`}
                  >
                    <span className="w-[42px] flex-none font-mono text-ds-text-muted text-xs">
                      {e.time}
                    </span>
                    <span
                      className="w-[3px] flex-none self-stretch rounded-full"
                      style={{ background: e.dot }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-ds-text text-sm">
                        <DemoBlur>{e.title}</DemoBlur>
                      </div>
                      {e.meta ? (
                        <div className="truncate text-ds-text-tertiary text-xs">
                          <DemoBlur>{e.meta}</DemoBlur>
                        </div>
                      ) : null}
                    </div>
                    {e.physical ? (
                      <MapPin weight="duotone" className="size-4 text-ds-text-tertiary" />
                    ) : (
                      <VideoCamera weight="duotone" className="size-4 text-ds-text-tertiary" />
                    )}
                  </div>
                ))
              )}
            </div>
          </section>

          {/* relances */}
          <section>
            <div className="mb-3 flex items-center gap-2.5">
              <BellRinging weight="duotone" className="size-4.5 text-primary-500" />
              <h2 className="font-semibold text-[16px] text-ds-text">Relances cette semaine</h2>
            </div>
            <div className="overflow-hidden rounded-[10px] border border-ds-border">
              {relances.length === 0 ? (
                <div className="bg-ds-app px-3.5 py-4 text-ds-text-tertiary text-sm">
                  Aucune relance prévue d'ici 7 jours.
                </div>
              ) : (
                relances.map((r, i) => (
                  <Link
                    href={`/projets/${r.id}`}
                    key={r.id}
                    className={`flex items-center gap-2.5 bg-ds-app px-3.5 py-3 transition-colors hover:bg-ds-hover ${i < relances.length - 1 ? "border-ds-border border-b" : ""}`}
                  >
                    <span
                      className="size-[9px] flex-none rounded-full"
                      style={{ background: projectTint({ id: r.id, color: r.color }) }}
                    />
                    <div className="min-w-0 flex-1">
                      <ProjectName
                        project={{ id: r.id, name: r.title }}
                        className="block truncate text-ds-text text-sm"
                      />
                      <div className="truncate text-ds-text-tertiary text-xs">
                        <EntityName
                          entity={r.entityId ? { id: r.entityId, name: r.entityName } : null}
                        />{" "}
                        · {RELANCE_STATUS_LABEL[r.status] ?? r.status}
                      </div>
                    </div>
                    <span className="font-medium text-ds-text-tertiary text-xs">
                      {r.followUpDate ? shortDateFmt.format(new Date(r.followUpDate)) : ""}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── sous-composants ─────────────────────────────────────────────────

function MetricCard({
  href,
  label,
  icon,
  value,
  sub,
  valueClassName,
  footIcon,
  footText,
  footClassName,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  sub?: string;
  valueClassName?: string;
  footIcon?: React.ReactNode;
  footText?: React.ReactNode;
  footClassName?: string;
}) {
  return (
    <Link
      href={href}
      className="statcard group/card flex flex-col gap-2.5 rounded-[10px] border border-ds-border bg-ds-app px-4 py-3.5 transition-colors hover:bg-ds-surface"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.06em]">
          {label}
        </span>
        <span className="flex-1" />
        <ArrowUpRight
          weight="bold"
          className="size-3 text-ds-text-tertiary opacity-0 transition-opacity group-hover/card:opacity-100"
        />
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-semibold text-[29px] leading-none ${valueClassName ?? ""}`}>
          {value}
        </span>
        {sub ? <span className="text-ds-text-tertiary text-xs">{sub}</span> : null}
      </div>
      <div className="flex items-center gap-1.5 border-ds-border border-t pt-2">
        {footIcon}
        <span className={`text-xs ${footClassName ?? "text-ds-text-muted"}`}>{footText}</span>
      </div>
    </Link>
  );
}

type StatusPill = { label: string; bg: string; text: string; dot: string };
const FALLBACK_STATUS: StatusPill = {
  label: "Actif",
  bg: "var(--ds-tint-green-bg)",
  text: "var(--ds-tint-green-text)",
  dot: "var(--ds-tint-green-dot)",
};
const STATUS_PILL: Record<string, StatusPill> = {
  planning: {
    label: "Planification",
    bg: "var(--ds-tint-blue-bg)",
    text: "var(--ds-tint-blue-text)",
    dot: "var(--ds-tint-blue-dot)",
  },
  active: {
    label: "Actif",
    bg: "var(--ds-tint-green-bg)",
    text: "var(--ds-tint-green-text)",
    dot: "var(--ds-tint-green-dot)",
  },
  to_follow_up: {
    label: "À relancer",
    bg: "var(--ds-tint-orange-bg)",
    text: "var(--ds-tint-orange-text)",
    dot: "var(--ds-tint-orange-dot)",
  },
  awaiting_response: {
    label: "En attente",
    bg: "var(--ds-tint-yellow-bg)",
    text: "var(--ds-tint-yellow-text)",
    dot: "var(--ds-tint-yellow-dot)",
  },
  on_hold: {
    label: "En pause",
    bg: "var(--ds-tint-gray-bg)",
    text: "var(--ds-tint-gray-text)",
    dot: "var(--ds-tint-gray-dot)",
  },
  not_started: {
    label: "Non démarré",
    bg: "var(--ds-tint-gray-bg)",
    text: "var(--ds-tint-gray-text)",
    dot: "var(--ds-tint-gray-dot)",
  },
};

const RELANCE_STATUS_LABEL: Record<string, string> = {
  not_started: "Non démarré",
  to_follow_up: "À relancer",
  awaiting_response: "Proposition envoyée",
  won: "Signé",
  planning: "Planification",
  active: "Actif",
  on_hold: "En pause",
};
