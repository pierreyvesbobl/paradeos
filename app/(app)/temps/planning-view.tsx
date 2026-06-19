import { contacts } from "@/db/schema/contacts";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { timeEntries } from "@/db/schema/time-entries";
import { requireUser } from "@/lib/auth/server";
import { addDays, formatWeekRange, startOfIsoWeek } from "@/lib/calendar";
import { getCalendarEventsForRange } from "@/lib/db/queries/calendar";
import { db } from "@/lib/db/server";
import { formatDuration } from "@/lib/format";
import { CaretLeft, CaretRight } from "@phosphor-icons/react/dist/ssr";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import Link from "next/link";
import { WeekView } from "./week-view";

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

export async function PlanningView({ week }: { week?: string }) {
  const user = await requireUser();
  const weekStart = parseWeekParam(week);
  const weekEnd = addDays(weekStart, 7);

  const conn = await db();
  const [entries, taskList, projectList, contactList, googleEvents] = await Promise.all([
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
        googleEventId: timeEntries.googleEventId,
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
    getCalendarEventsForRange(user.id, weekStart, weekEnd),
  ]);

  const prevWeek = addDays(weekStart, -7);
  const nextWeek = addDays(weekStart, 7);

  // Totaux de la semaine (en minutes) — planifié vs réalisé.
  const { plannedMinutes, actualMinutes } = entries.reduce(
    (acc, e) => {
      const minutes = Math.max(0, (e.endAt.getTime() - e.startAt.getTime()) / 60_000);
      if (e.kind === "actual") acc.actualMinutes += minutes;
      else acc.plannedMinutes += minutes;
      return acc;
    },
    { plannedMinutes: 0, actualMinutes: 0 },
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3.5">
        <div className="inline-flex items-center overflow-hidden rounded-lg border bg-[var(--ds-bg-app)]">
          <Link
            href={`/temps?tab=planning&week=${isoDateLocal(prevWeek)}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-[var(--ds-bg-hover)]"
          >
            <CaretLeft size={12} weight="bold" />
            Sem. préc.
          </Link>
          <span className="h-5 w-px self-stretch bg-border" />
          <Link
            href="/temps?tab=planning"
            className="px-3 py-1.5 font-medium text-[13px] text-foreground transition-colors hover:bg-[var(--ds-bg-hover)]"
          >
            Aujourd'hui
          </Link>
          <span className="h-5 w-px self-stretch bg-border" />
          <Link
            href={`/temps?tab=planning&week=${isoDateLocal(nextWeek)}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-[var(--ds-bg-hover)]"
          >
            Sem. suiv.
            <CaretRight size={12} weight="bold" />
          </Link>
        </div>
        <h2 className="font-semibold text-[16px] text-foreground">{formatWeekRange(weekStart)}</h2>
        <span className="ml-auto inline-flex items-center gap-3">
          <span
            className="inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium text-[13px]"
            style={{
              background: "var(--ds-tint-green-bg)",
              color: "var(--ds-tint-green-text)",
            }}
          >
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ background: "var(--ds-tint-green-dot)" }}
            />
            Réalisé · {formatDuration(actualMinutes)}
          </span>
          <span className="inline-flex items-center gap-2 rounded-full border bg-[var(--ds-bg-surface)] px-3 py-1 font-medium text-[13px] text-muted-foreground">
            <span
              className="inline-block size-1.5 rounded-full"
              style={{ background: "var(--ds-text-tertiary)" }}
            />
            Planifié · {formatDuration(plannedMinutes)}
          </span>
        </span>
      </div>

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
          googleEventId: e.googleEventId,
        }))}
        googleEvents={(() => {
          const trackedEventIds = new Set(
            entries.map((e) => e.googleEventId).filter((v): v is string => !!v),
          );
          return googleEvents
            .filter((e) => !e.allDay && !trackedEventIds.has(e.googleEventId))
            .map((e) => ({
              id: e.id,
              startAt: e.startAt.toISOString(),
              endAt: e.endAt.toISOString(),
              summary: e.summary,
              location: e.location,
              htmlLink: e.htmlLink,
              calendarSummary: e.calendarSummary,
              backgroundColor: e.calendarBackgroundColor,
            }));
        })()}
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
