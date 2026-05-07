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
import { and, asc, eq, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { MeetingSubjectEditor } from "./meeting-subject-editor";
import { ProposalsPanel } from "./proposals-panel";
import { ReExtractButton } from "./re-extract-button";
import { SummaryEditor } from "./summary-editor";

// Pas de cache statique sur cette page : les propositions et le résumé
// changent en continu à chaque action humaine, on veut toujours la
// donnée fraîche.
export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

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
        })
        .from(contacts)
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          meeting.occurredAt
            ? new Date(meeting.occurredAt).toLocaleDateString("fr-FR", {
                day: "2-digit",
                month: "long",
                year: "numeric",
              })
            : "Meeting"
        }
        title={meeting.title}
        description={meeting.sourceLabel ?? undefined}
        actions={
          <>
            <ReExtractButton meetingId={meeting.id} />
            <DeleteButton
              action={deleteMeetingAndRedirect}
              id={meeting.id}
              label="Supprimer"
              confirmTitle={`Supprimer "${meeting.title}" ?`}
            />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-3 rounded-lg border bg-card p-6 lg:col-span-2">
          <header className="flex items-center justify-between">
            <h2 className="font-medium text-sm">Résumé</h2>
            {meeting.summary == null ? (
              <span className="text-muted-foreground text-xs">
                Pas encore d'extraction. Lance "Ré-extraire".
              </span>
            ) : null}
          </header>
          <SummaryEditor meetingId={meeting.id} initial={meeting.summary} />
        </section>

        <div className="space-y-6">
          <section className="space-y-3 rounded-lg border bg-card p-6">
            <h2 className="font-medium text-sm">Lié à</h2>
            <MeetingSubjectEditor
              meetingId={meeting.id}
              initialProjectId={meeting.projectId}
              projects={projectOptions}
            />
          </section>

          <section className="space-y-3 rounded-lg border bg-card p-6">
            <h2 className="font-medium text-sm">État</h2>
            <dl className="space-y-2 text-sm">
              <Stat label="Statut" value={STATUS_LABEL[meeting.status]} />
              <Stat label="À valider" value={pending.length.toString()} />
              <Stat label="Acceptées" value={accepted.length.toString()} />
              <Stat label="Rejetées" value={rejected.length.toString()} />
              <Stat
                label="Transcript"
                value={`${meeting.transcript.length.toLocaleString("fr-FR")} car.`}
              />
            </dl>
          </section>
        </div>
      </div>

      <ProposalsPanel
        proposals={proposals}
        projects={projectOptions}
        users={userOptions}
        entities={entityOptions}
        contacts={contactOptions.map((c) => ({
          id: c.id,
          fullName: `${c.firstName} ${c.lastName}`.trim(),
        }))}
        existingTasks={taskOptions}
      />

      <details className="rounded-lg border bg-card">
        <summary className="cursor-pointer px-6 py-3 font-medium text-sm">Transcript brut</summary>
        <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap p-6 font-mono text-xs leading-relaxed">
          {meeting.transcript}
        </pre>
      </details>
    </div>
  );
}

const STATUS_LABEL = {
  ingested: "À extraire",
  extracted: "À valider",
  reviewed: "Validé",
  archived: "Archivé",
} as const;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
