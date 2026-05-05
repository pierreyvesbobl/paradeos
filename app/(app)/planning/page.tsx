import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { contacts } from "@/db/schema/contacts";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { timeEntries } from "@/db/schema/time-entries";
import { requireUser } from "@/lib/auth/server";
import { addDays, startOfIsoWeek } from "@/lib/calendar";
import { db } from "@/lib/db/server";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import Link from "next/link";
import { WeekView } from "./week-view";

type SearchParams = Promise<{ week?: string }>;

function parseWeekParam(raw: string | undefined): Date {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return startOfIsoWeek(d);
  }
  return startOfIsoWeek(new Date());
}

function isoDateLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function PlanningPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const { week } = await searchParams;
  const weekStart = parseWeekParam(week);
  const weekEnd = addDays(weekStart, 7);

  const conn = await db();
  const [entries, taskList, projectList, contactList] = await Promise.all([
    conn
      .select({
        id: timeEntries.id,
        kind: timeEntries.kind,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        title: timeEntries.title,
        description: timeEntries.description,
        taskId: timeEntries.taskId,
        projectId: timeEntries.projectId,
        contactId: timeEntries.contactId,
        color: timeEntries.color,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, user.id),
          gte(timeEntries.startAt, weekStart),
          lt(timeEntries.startAt, weekEnd),
        ),
      )
      .orderBy(asc(timeEntries.startAt)),
    conn.select({ id: tasks.id, title: tasks.title }).from(tasks).orderBy(asc(tasks.title)),
    conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .orderBy(asc(projects.name)),
    conn
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
  ]);

  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Planning"
        title="Calendrier"
        description="Planification a priori (planifié) et suivi a posteriori (réalisé)."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/planning?week=${isoDateLocal(prevWeek)}`}>← Sem. préc.</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/planning">Aujourd'hui</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/planning?week=${isoDateLocal(nextWeek)}`}>Sem. suiv. →</Link>
            </Button>
          </>
        }
      />

      <WeekView
        weekStartIso={isoDateLocal(weekStart)}
        entries={entries.map((e) => ({
          id: e.id,
          kind: e.kind,
          startAt: e.startAt.toISOString(),
          endAt: e.endAt.toISOString(),
          title: e.title,
          description: e.description,
          taskId: e.taskId,
          projectId: e.projectId,
          contactId: e.contactId,
          color: e.color,
        }))}
        tasks={taskList}
        projects={projectList}
        contacts={contactList.map((c) => ({
          id: c.id,
          label: `${c.firstName} ${c.lastName}`,
        }))}
      />
    </div>
  );
}
