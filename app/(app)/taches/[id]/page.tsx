import { TaskAssigneeRailEditor } from "@/app/(app)/taches/[id]/rail/assignee-rail-editor";
import { TaskCompletedEditor } from "@/app/(app)/taches/[id]/rail/completed-editor";
import { TaskPriorityPillEditor } from "@/app/(app)/taches/[id]/rail/priority-pill-editor";
import { TaskProjectRailEditor } from "@/app/(app)/taches/[id]/rail/project-rail-editor";
import { TaskStatusPillEditor } from "@/app/(app)/taches/[id]/rail/status-pill-editor";
import { TaskTitleEditor } from "@/app/(app)/taches/[id]/rail/title-editor";
import { TaskScheduleEditor } from "@/app/(app)/taches/inline-editors/schedule-editor";
import { DeleteButton } from "@/components/delete-button";
import { NoteList } from "@/components/notes/note-list";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { deleteTaskAndRedirect } from "@/lib/actions/tasks";
import { getAttachmentsForNotes, getNotesForSubject } from "@/lib/db/queries/notes";
import { fetchAssigneesForTasks } from "@/lib/db/queries/task-assignees";
import { getTaskTimeStats } from "@/lib/db/queries/time-stats";
import { db } from "@/lib/db/server";
import { formatDateTime, formatDuration } from "@/lib/format";
import { timeEntryKindLabels } from "@/lib/schemas/time-entries";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

type Params = Promise<{ id: string }>;

/**
 * Fiche tâche « rail » : colonne large (titre inline, temps passé,
 * notes) + rail 320px (statut, priorité, assignée, projet, période,
 * terminée le, supprimer). Toutes les propriétés éditables in-place
 * — pas de mode édition séparé.
 */
export default async function TaskDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();

  const [row] = await conn
    .select({ task: tasks, project: projects })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(tasks.id, id))
    .limit(1);

  if (!row) notFound();
  const { task, project } = row;

  const [assigneesByTask, timeStats, notesList, projectOptions, userOptions, contactRows] =
    await Promise.all([
      fetchAssigneesForTasks(conn, [id]),
      getTaskTimeStats(id),
      getNotesForSubject("task", id),
      conn
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .orderBy(asc(projects.name)),
      conn
        .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
        .from(users)
        .orderBy(asc(users.fullName)),
      conn
        .select({
          id: contacts.id,
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          entityName: entities.name,
        })
        .from(contacts)
        .leftJoin(entities, eq(contacts.entityId, entities.id))
        .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
    ]);

  const assignees = assigneesByTask.get(id) ?? [];
  const contactOptions = contactRows.map((c) => ({
    id: c.id,
    fullName: `${c.firstName} ${c.lastName}`.trim(),
    entityName: c.entityName ?? null,
  }));

  const attachmentRows = await getAttachmentsForNotes(notesList.map((n) => n.id));
  const attachmentsByNote: Record<string, typeof attachmentRows> = {};
  for (const a of attachmentRows) {
    if (!attachmentsByNote[a.noteId]) attachmentsByNote[a.noteId] = [];
    attachmentsByNote[a.noteId]?.push(a);
  }

  const diff = timeStats.totals.actualMinutes - timeStats.totals.plannedMinutes;
  const diffLabel = `${diff >= 0 ? "+" : "−"}${formatDuration(Math.abs(diff))}`;
  const diffClass =
    diff > 0 ? "text-tint-red-text" : diff < 0 ? "text-tint-green-text" : "text-foreground";

  return (
    <div className="mx-auto max-w-[1180px]">
      <nav
        aria-label="fil d'ariane"
        className="mb-3.5 flex items-center gap-2.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.06em]"
      >
        <Link href="/taches" className="hover:text-foreground hover:underline">
          Tâches
        </Link>
        {project ? (
          <>
            <CaretRight size={10} weight="bold" />
            <Link href={`/projets/${project.id}`} className="hover:text-foreground hover:underline">
              {project.name.toUpperCase()}
            </Link>
          </>
        ) : null}
        <CaretRight size={10} weight="bold" />
        <span className="max-w-[520px] truncate text-foreground/80">
          {task.title.toUpperCase()}
        </span>
      </nav>

      <article className="flex overflow-visible rounded-xl border border-ds-border bg-ds-app shadow-sm">
        {/* colonne principale */}
        <div className="min-w-0 flex-1 space-y-8 px-10 py-8">
          <TaskTitleEditor id={id} value={task.title} />

          <section className="space-y-3.5">
            <h2 className="font-medium text-[17px]">Temps passé</h2>
            <div className="grid grid-cols-3 gap-4">
              <StatCard
                label="Réalisé"
                value={formatDuration(timeStats.totals.actualMinutes)}
                className="text-tint-green-text"
              />
              <StatCard label="Planifié" value={formatDuration(timeStats.totals.plannedMinutes)} />
              <StatCard label="Écart" value={diffLabel} className={diffClass} />
            </div>
            {timeStats.entries.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Aucun créneau enregistré sur cette tâche. Ajoute-en depuis le{" "}
                <Link href="/temps?tab=planning" className="text-primary hover:underline">
                  calendrier
                </Link>
                .
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {timeStats.entries.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-3.5 py-2 text-sm">
                    <span
                      className={`inline-block size-1.5 rounded-full ${
                        e.kind === "actual" ? "bg-tint-green-dot" : "bg-primary"
                      }`}
                      aria-hidden
                    />
                    <span className="w-20 text-muted-foreground text-xs">
                      {timeEntryKindLabels[e.kind]}
                    </span>
                    <span className="flex-1 truncate">{e.title ?? "Sans titre"}</span>
                    <span className="text-muted-foreground text-xs">{e.userName ?? ""}</span>
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(e.startAt)}
                    </span>
                    <span className="font-mono text-xs">{formatDuration(e.minutes)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <NoteList
            subjectType="task"
            subjectId={id}
            notes={notesList}
            attachmentsByNote={attachmentsByNote}
          />
        </div>

        {/* rail latéral */}
        <aside className="flex w-[320px] shrink-0 flex-col gap-6 rounded-r-xl border-ds-border border-l bg-ds-surface px-6 py-8">
          <RailField label="Statut">
            <TaskStatusPillEditor id={id} value={task.status} />
          </RailField>

          <RailField label="Priorité">
            <TaskPriorityPillEditor id={id} value={task.priority} />
          </RailField>

          <RailField label={`Assigné${assignees.length > 1 ? "s" : "e"} à`}>
            <TaskAssigneeRailEditor
              id={id}
              value={assignees}
              options={userOptions}
              contactOptions={contactOptions}
            />
          </RailField>

          <RailField label="Projet">
            <TaskProjectRailEditor
              id={id}
              value={project ? { id: project.id, name: project.name } : null}
              options={projectOptions}
            />
          </RailField>

          <RailField label="Période (Gantt)">
            <TaskScheduleEditor
              id={id}
              startDate={task.startDate}
              dueDate={task.dueDate}
              variant="labeled"
            />
          </RailField>

          <RailField label="Terminée le">
            <TaskCompletedEditor id={id} value={task.completedAt} />
          </RailField>

          <div className="h-px bg-ds-border" />

          <DeleteButton
            action={deleteTaskAndRedirect}
            id={id}
            label="Supprimer la tâche"
            confirmTitle={`Supprimer "${task.title}" ?`}
            className="w-full justify-center"
          />
        </aside>
      </article>
    </div>
  );
}

function StatCard({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-xl border border-ds-border bg-ds-surface px-4 py-3.5">
      <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
        {label}
      </p>
      <p
        className={`mt-1.5 font-bold text-[26px] tracking-tight ${className ?? "text-foreground"}`}
      >
        {value}
      </p>
    </div>
  );
}

function RailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="font-semibold text-[11px] text-muted-foreground uppercase tracking-[0.06em]">
        {label}
      </p>
      {children}
    </div>
  );
}
