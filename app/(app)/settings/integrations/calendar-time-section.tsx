import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { calendarEventLinks } from "@/db/schema/calendar-event-links";
import { projects } from "@/db/schema/projects";
import { timeEntries } from "@/db/schema/time-entries";
import { db } from "@/lib/db/server";
import { isCalendarAutoTimeEnabled } from "@/lib/settings";
import { CalendarTimeSettings, type RecentCalendarEntry } from "./calendar-time-settings";

/**
 * Rendez-vous du calendrier → projet → temps : état de l'interrupteur,
 * compteurs par issue et derniers créneaux posés sans clic.
 */
export async function CalendarTimeSection() {
  const conn = await db();
  const [enabled, byStatus, recent] = await Promise.all([
    isCalendarAutoTimeEnabled(),
    conn
      .select({
        status: calendarEventLinks.status,
        auto: sql<boolean>`${calendarEventLinks.autoAt} is not null`,
        n: sql<number>`count(*)::int`,
      })
      .from(calendarEventLinks)
      .groupBy(calendarEventLinks.status, sql`${calendarEventLinks.autoAt} is not null`),
    conn
      .select({
        id: calendarEventLinks.id,
        title: timeEntries.title,
        startAt: timeEntries.startAt,
        endAt: timeEntries.endAt,
        projectId: projects.id,
        projectName: projects.name,
        reasons: calendarEventLinks.reasons,
        autoAt: calendarEventLinks.autoAt,
        meetingId: calendarEventLinks.meetingId,
      })
      .from(calendarEventLinks)
      .innerJoin(timeEntries, eq(timeEntries.id, calendarEventLinks.timeEntryId))
      .leftJoin(projects, eq(projects.id, calendarEventLinks.projectId))
      .where(and(eq(calendarEventLinks.status, "applied"), isNotNull(calendarEventLinks.autoAt)))
      .orderBy(desc(calendarEventLinks.autoAt))
      .limit(10),
  ]);

  const counts = { suggested: 0, auto: 0, manual: 0, dismissed: 0, unmatched: 0 };
  for (const row of byStatus) {
    if (row.status === "suggested") counts.suggested += row.n;
    else if (row.status === "dismissed") counts.dismissed += row.n;
    else if (row.status === "unmatched") counts.unmatched += row.n;
    else if (row.auto) counts.auto += row.n;
    else counts.manual += row.n;
  }

  const recentEntries: RecentCalendarEntry[] = recent.map((r) => ({
    id: r.id,
    title: r.title ?? "Sans titre",
    startAt: r.startAt.toISOString(),
    endAt: r.endAt.toISOString(),
    projectId: r.projectId,
    projectName: r.projectName,
    reasons: r.reasons,
    meetingId: r.meetingId,
  }));

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Rendez-vous du calendrier → projet → temps</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            À chaque relève, chaque rendez-vous est rapproché d'un projet : nom du projet ou du
            client dans le titre, contacts invités, domaine de leur adresse, réunion Parade OS tenue
            au même moment. Reconnu, il s'affiche en bleu dans la grille de /temps et s'impute d'un
            clic. Interrupteur activé : un rendez-vous passé auquel tu as pris part devient un
            créneau réalisé sans clic ; le supprimer vaut refus définitif pour ce rendez-vous. Une
            réunion sans projet tenue sur le créneau reçoit celui du rendez-vous.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${enabled ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}
        >
          {enabled ? "Automatique" : "Sur un clic"}
        </span>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Reconnus, à imputer" value={String(counts.suggested)} tone="amber" />
        <Stat label="Créneaux posés auto" value={String(counts.auto)} tone="emerald" />
        <Stat label="Imputés à la main" value={String(counts.manual)} />
        <Stat label="Refusés" value={String(counts.dismissed)} />
        <Stat label="Sans projet" value={String(counts.unmatched)} />
      </div>

      <CalendarTimeSettings enabled={enabled} recent={recentEntries} />
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "amber";
}) {
  const tint =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded border bg-background p-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`mt-0.5 font-semibold text-sm tabular-nums ${tint}`}>{value}</p>
    </div>
  );
}
