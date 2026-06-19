import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { deleteMeetingAndRedirect } from "@/lib/actions/meetings";
import { db } from "@/lib/db/server";
import { FileText } from "@phosphor-icons/react/dist/ssr";
import { and, asc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { CopyTranscriptButton } from "./copy-transcript-button";
import { MeetingSubjectEditor } from "./meeting-subject-editor";
import { ProposalsPanel } from "./proposals-panel";
import { ReExtractButton } from "./re-extract-button";
import { SummaryEditor } from "./summary-editor";

// Pas de cache statique sur cette page : les propositions et le résumé
// changent en continu à chaque action humaine, on veut toujours la
// donnée fraîche.
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

type MeetingStatus = "ingested" | "extracted" | "reviewed" | "archived";

const STATUS_LABEL: Record<MeetingStatus, string> = {
  ingested: "À extraire",
  extracted: "En cours de revue",
  reviewed: "Validé",
  archived: "Archivé",
};

const STATUS_TINT: Record<MeetingStatus, "gray" | "yellow" | "green" | "blue"> = {
  ingested: "gray",
  extracted: "yellow",
  reviewed: "green",
  archived: "blue",
};

export default async function MeetingDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();

  const [meeting] = await conn.select().from(meetings).where(eq(meetings.id, id)).limit(1);
  if (!meeting) notFound();

  const [proposals, projectOptions, userOptions, entityOptions, contactOptions, taskOptions] =
    await Promise.all([
      conn
        .select()
        .from(meetingProposals)
        .where(eq(meetingProposals.meetingId, id))
        .orderBy(asc(meetingProposals.kind), asc(meetingProposals.createdAt)),
      conn
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .orderBy(asc(projects.name)),
      conn
        .select({ id: users.id, fullName: users.fullName })
        .from(users)
        .orderBy(asc(users.fullName)),
      conn
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .orderBy(asc(entities.name)),
      conn
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          entityName: entities.name,
        })
        .from(contacts)
        .leftJoin(entities, eq(entities.id, contacts.entityId))
        .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
      conn
        .select({ id: tasks.id, title: tasks.title })
        .from(tasks)
        .where(and(sql`${tasks.status} not in ('done', 'cancelled')`))
        .orderBy(asc(tasks.title)),
    ]);

  const pending = proposals.filter((p) => p.status === "pending");
  const accepted = proposals.filter((p) => p.status === "accepted");
  const rejected = proposals.filter((p) => p.status === "rejected");
  const status = meeting.status as MeetingStatus;
  const statusTint = STATUS_TINT[status];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          meeting.occurredAt
            ? `${new Date(meeting.occurredAt).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })} · Réunion`
            : "Meeting"
        }
        title={meeting.title}
        description={meeting.sourceLabel ?? undefined}
        actions={<ReExtractButton meetingId={meeting.id} />}
      />

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-5">
          <section className="rounded-xl border bg-[var(--ds-bg-surface)] p-5">
            <header className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold text-[15px] text-foreground">Résumé</h2>
              {meeting.summary == null ? (
                <span className="text-[12px] text-[var(--ds-text-tertiary)]">
                  Pas encore d'extraction. Lance « Ré-extraire ».
                </span>
              ) : null}
            </header>
            <SummaryEditor meetingId={meeting.id} initial={meeting.summary} />
          </section>

          <ProposalsPanel
            proposals={proposals}
            projects={projectOptions}
            users={userOptions}
            entities={entityOptions}
            contacts={contactOptions.map((c) => ({
              id: c.id,
              fullName: `${c.firstName} ${c.lastName}`.trim(),
              entityName: c.entityName ?? null,
            }))}
            existingTasks={taskOptions}
          />

          <details className="group rounded-xl border bg-[var(--ds-bg-surface)]">
            <summary className="flex cursor-pointer items-center gap-3 px-4 py-3.5 text-sm">
              <FileText size={18} weight="duotone" className="text-muted-foreground" />
              <span className="font-medium text-foreground">Transcript brut</span>
              <span className="text-[12px] text-[var(--ds-text-tertiary)]">
                {meeting.transcript.length.toLocaleString("fr-FR")} caractères
              </span>
              <span className="flex-1" />
              <CopyTranscriptButton transcript={meeting.transcript} />
            </summary>
            <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap border-t bg-[var(--ds-bg-app)] p-5 text-xs leading-relaxed">
              {meeting.transcript}
            </pre>
          </details>
        </div>

        <aside className="flex w-full flex-col gap-4 lg:w-[300px] lg:flex-none">
          <section className="rounded-xl border bg-[var(--ds-bg-surface)] p-4 sm:p-5">
            <h2 className="font-semibold text-[14px] text-foreground">Lié à</h2>
            <p className="mt-0.5 mb-3 text-[12px] text-[var(--ds-text-tertiary)] uppercase tracking-wider">
              Projet — phases commerciales & delivery
            </p>
            <MeetingSubjectEditor
              meetingId={meeting.id}
              initialProjectId={meeting.projectId}
              projects={projectOptions}
            />
          </section>

          <section className="rounded-xl border bg-[var(--ds-bg-surface)] p-4 sm:p-5">
            <h2 className="mb-3 font-semibold text-[14px] text-foreground">État</h2>
            <dl className="flex flex-col gap-2.5 text-sm">
              <div className="flex items-center">
                <dt className="text-muted-foreground">Statut</dt>
                <dd className="flex-1" />
                <span
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold text-[12px]"
                  style={{
                    background: `var(--ds-tint-${statusTint}-bg)`,
                    color: `var(--ds-tint-${statusTint}-text)`,
                  }}
                >
                  <span
                    className="inline-block size-1.5 rounded-full"
                    style={{ background: `var(--ds-tint-${statusTint}-dot)` }}
                  />
                  {STATUS_LABEL[status]}
                </span>
              </div>
              <div className="h-px bg-border/70" />
              <StatRow tint="yellow" label="En attente" value={pending.length} />
              <StatRow tint="green" label="Validés" value={accepted.length} />
              <StatRow tint="red" label="Invalidés" value={rejected.length} />
              <div className="flex items-center">
                <dt className="text-muted-foreground">Transcript</dt>
                <dd className="flex-1" />
                <span className="text-[12px] text-muted-foreground tabular-nums">
                  {meeting.transcript.length.toLocaleString("fr-FR")} car.
                </span>
              </div>
            </dl>
          </section>

          <DeleteButton
            action={deleteMeetingAndRedirect}
            id={meeting.id}
            label="Supprimer la réunion"
            confirmTitle={`Supprimer "${meeting.title}" ?`}
            className="w-full justify-center bg-[var(--ds-tint-red-bg)] py-2.5 font-medium text-[var(--ds-tint-red-text)] hover:bg-[var(--ds-tint-red-bg)] hover:text-[var(--ds-tint-red-text)] hover:brightness-95"
          />
        </aside>
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  tint,
}: {
  label: string;
  value: number;
  tint?: "yellow" | "green" | "red";
}) {
  return (
    <div className="flex items-center">
      <dt className="inline-flex items-center gap-2 text-muted-foreground">
        {tint ? (
          <span
            className="inline-block size-2 rounded-full"
            style={{ background: `var(--ds-tint-${tint}-dot)` }}
          />
        ) : null}
        {label}
      </dt>
      <dd className="flex-1" />
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}
