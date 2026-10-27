import { and, desc, eq, sql } from "drizzle-orm";
import { emailProposals, gmailMessages } from "@/db/schema/gmail";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { tasks } from "@/db/schema/tasks";
import { db } from "@/lib/db/server";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { type RecentCompletion, TaskCompletionSettings } from "./task-completion-settings";

/**
 * Clôture des tâches d'après les mails et les réunions : état de
 * l'interrupteur, compteurs et dernières clôtures appliquées sans clic.
 * Les propositions elles-mêmes se traitent dans /inbox.
 */
export async function TaskCompletionSection() {
  const conn = await db();
  const meetingAuto = sql`${meetingProposals.payload}->>'auto' = 'true'`;
  const emailAuto = sql`${emailProposals.payload}->>'auto' = 'true'`;

  const [enabledSetting, meetingStats, emailStats, recentMeetings, recentEmails] =
    await Promise.all([
      getSetting(SETTING_KEYS.TASK_AUTOCOMPLETE_ENABLED),
      conn
        .select({
          status: meetingProposals.status,
          auto: sql<boolean>`coalesce(${meetingAuto}, false)`,
          n: sql<number>`count(*)::int`,
        })
        .from(meetingProposals)
        .where(eq(meetingProposals.kind, "task_completion"))
        .groupBy(meetingProposals.status, sql`coalesce(${meetingAuto}, false)`),
      conn
        .select({
          status: emailProposals.status,
          auto: sql<boolean>`coalesce(${emailAuto}, false)`,
          n: sql<number>`count(*)::int`,
        })
        .from(emailProposals)
        .where(eq(emailProposals.kind, "task_completion"))
        .groupBy(emailProposals.status, sql`coalesce(${emailAuto}, false)`),
      conn
        .select({
          id: meetingProposals.id,
          taskId: meetingProposals.createdEntityId,
          taskTitle: tasks.title,
          taskStatus: tasks.status,
          payload: meetingProposals.payload,
          decidedAt: meetingProposals.decidedAt,
          sourceId: meetings.id,
          sourceTitle: meetings.title,
        })
        .from(meetingProposals)
        .innerJoin(meetings, eq(meetings.id, meetingProposals.meetingId))
        .leftJoin(tasks, eq(tasks.id, meetingProposals.createdEntityId))
        .where(
          and(
            eq(meetingProposals.kind, "task_completion"),
            eq(meetingProposals.status, "accepted"),
            meetingAuto,
          ),
        )
        .orderBy(desc(meetingProposals.decidedAt))
        .limit(12),
      conn
        .select({
          id: emailProposals.id,
          taskId: emailProposals.createdEntityId,
          taskTitle: tasks.title,
          taskStatus: tasks.status,
          payload: emailProposals.payload,
          decidedAt: emailProposals.decidedAt,
          sourceId: gmailMessages.threadId,
          sourceTitle: gmailMessages.subject,
        })
        .from(emailProposals)
        .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
        .leftJoin(tasks, eq(tasks.id, emailProposals.createdEntityId))
        .where(
          and(
            eq(emailProposals.kind, "task_completion"),
            eq(emailProposals.status, "accepted"),
            emailAuto,
          ),
        )
        .orderBy(desc(emailProposals.decidedAt))
        .limit(12),
    ]);

  const enabled = enabledSetting === "true";
  const counts = { pending: 0, auto: 0, manual: 0, rejected: 0 };
  for (const row of [...meetingStats, ...emailStats]) {
    if (row.status === "pending") counts.pending += row.n;
    else if (row.status === "rejected") counts.rejected += row.n;
    else if (row.auto) counts.auto += row.n;
    else counts.manual += row.n;
  }

  const recent: RecentCompletion[] = [
    ...recentMeetings.map((r) => ({
      id: r.id,
      source: "meeting" as const,
      taskId: r.taskId,
      taskTitle: r.taskTitle ?? titleFromPayload(r.payload),
      stillDone: r.taskStatus === "done",
      evidence: evidenceFromPayload(r.payload),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      sourceHref: `/meetings/${r.sourceId}`,
      sourceLabel: r.sourceTitle,
    })),
    ...recentEmails.map((r) => ({
      id: r.id,
      source: "email" as const,
      taskId: r.taskId,
      taskTitle: r.taskTitle ?? titleFromPayload(r.payload),
      stillDone: r.taskStatus === "done",
      evidence: evidenceFromPayload(r.payload),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      sourceHref: `/emails/${r.sourceId}`,
      sourceLabel: r.sourceTitle?.trim() || "(sans objet)",
    })),
  ]
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .slice(0, 12);

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Clôture des tâches d'après les mails et réunions</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Quand un mail ou un compte-rendu donne une tâche ouverte pour faite (« c'est envoyé »,
            livrable reçu), l'extraction propose de la clôturer dans /inbox. Interrupteur activé :
            les détections certaines passent la tâche en « Terminée » sans clic, annulable depuis
            l'historique de /inbox. Les détections seulement probables, et les tâches déjà soumises
            une fois, restent des propositions.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${enabled ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}
        >
          {enabled ? "Automatique" : "Sur validation"}
        </span>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="À valider" value={String(counts.pending)} tone="amber" />
        <Stat label="Clôturées auto" value={String(counts.auto)} tone="emerald" />
        <Stat label="Validées à la main" value={String(counts.manual)} />
        <Stat label="Refusées" value={String(counts.rejected)} />
      </div>

      <TaskCompletionSettings enabled={enabled} recent={recent} />
    </section>
  );
}

function titleFromPayload(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  return typeof p.taskTitle === "string" ? p.taskTitle : "Tâche supprimée";
}

function evidenceFromPayload(payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  return typeof p.evidence === "string" ? p.evidence : "";
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
