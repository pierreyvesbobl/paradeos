import { TaskScheduleEditor } from "@/app/(app)/taches/inline-editors/schedule-editor";
import { DeleteButton } from "@/components/delete-button";
import { NoteList } from "@/components/notes/note-list";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { deleteTaskAndRedirect } from "@/lib/actions/tasks";
import { buildMarkdownResolver } from "@/lib/db/queries/mention-resolver";
import { getAttachmentsForNotes, getNotesForSubject } from "@/lib/db/queries/notes";
import { getTaskTimeStats } from "@/lib/db/queries/time-stats";
import { db } from "@/lib/db/server";
import { formatDateTime, formatDuration } from "@/lib/format";
import { taskPriorityLabels, taskStatusLabels } from "@/lib/schemas/tasks";
import { timeEntryKindLabels } from "@/lib/schemas/time-entries";
import { eq } from "drizzle-orm";
import { Pencil } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

type Params = Promise<{ id: string }>;

export default async function TaskDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();

  const [row] = await conn
    .select({
      task: tasks,
      project: projects,
      assignee: users,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .leftJoin(users, eq(tasks.assigneeId, users.id))
    .where(eq(tasks.id, id))
    .limit(1);

  if (!row) notFound();
  const { task, project, assignee } = row;
  const timeStats = await getTaskTimeStats(id);
  const notesList = await getNotesForSubject("task", id);
  const attachmentRows = await getAttachmentsForNotes(notesList.map((n) => n.id));
  const attachmentsByNote: Record<string, typeof attachmentRows> = {};
  for (const a of attachmentRows) {
    if (!attachmentsByNote[a.noteId]) attachmentsByNote[a.noteId] = [];
    attachmentsByNote[a.noteId]?.push(a);
  }
  const mdResolver = await buildMarkdownResolver();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={project ? project.name : "Tâche"}
        title={task.title}
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/taches/${id}/modifier`}>
                <Pencil className="size-4" />
                Modifier
              </Link>
            </Button>
            <DeleteButton
              action={deleteTaskAndRedirect}
              id={id}
              label="Supprimer"
              confirmTitle={`Supprimer "${task.title}" ?`}
            />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 rounded-lg border bg-card p-6 lg:col-span-2">
          <h2 className="font-medium text-sm">Détails</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Statut</dt>
              <dd className="mt-1">
                <Badge>{taskStatusLabels[task.status]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Priorité</dt>
              <dd className="mt-1">
                <Badge variant="outline">{taskPriorityLabels[task.priority]}</Badge>
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                Période (Gantt)
              </dt>
              <dd className="mt-1">
                <TaskScheduleEditor
                  id={id}
                  startDate={task.startDate}
                  dueDate={task.dueDate}
                  variant="labeled"
                />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Terminée le</dt>
              <dd className="mt-1 text-sm">
                {task.completedAt ? formatDateTime(task.completedAt) : "—"}
              </dd>
            </div>
          </dl>
          {task.description ? (
            <>
              <Separator />
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Description</p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{task.description}</p>
              </div>
            </>
          ) : null}
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-6">
          <div>
            <h2 className="font-medium text-sm">Projet</h2>
            {project ? (
              <Link
                href={`/projets/${project.id}`}
                className="mt-2 block rounded-md border bg-background px-3 py-2 text-sm hover:bg-muted"
              >
                {project.name}
              </Link>
            ) : (
              <p className="mt-2 text-muted-foreground text-sm">—</p>
            )}
          </div>
          <div>
            <h2 className="font-medium text-sm">Assignée à</h2>
            <p className="mt-2 text-sm">
              {assignee ? (
                (assignee.fullName ?? "(sans nom)")
              ) : (
                <span className="text-muted-foreground">—</span>
              )}
            </p>
          </div>
        </section>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Temps passé</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded border bg-background p-3">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Réalisé</p>
            <p className="mt-1 font-semibold text-emerald-600 text-xl tracking-tight dark:text-emerald-400">
              {formatDuration(timeStats.totals.actualMinutes)}
            </p>
          </div>
          <div className="rounded border bg-background p-3">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Planifié</p>
            <p className="mt-1 font-semibold text-primary text-xl tracking-tight">
              {formatDuration(timeStats.totals.plannedMinutes)}
            </p>
          </div>
          <div className="rounded border bg-background p-3">
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Écart</p>
            <p className="mt-1 font-semibold text-muted-foreground text-xl tracking-tight">
              {(timeStats.totals.actualMinutes >= timeStats.totals.plannedMinutes ? "+" : "−") +
                formatDuration(
                  Math.abs(timeStats.totals.actualMinutes - timeStats.totals.plannedMinutes),
                )}
            </p>
          </div>
        </div>

        {timeStats.entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aucun créneau enregistré sur cette tâche. Ajoute-en depuis le{" "}
            <Link href="/planning" className="underline">
              calendrier
            </Link>
            .
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {timeStats.entries.map((e) => (
              <li key={e.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span
                  className={`inline-block size-1.5 rounded-full ${
                    e.kind === "actual" ? "bg-emerald-500" : "bg-primary"
                  }`}
                  aria-hidden
                />
                <span className="w-20 text-muted-foreground text-xs">
                  {timeEntryKindLabels[e.kind]}
                </span>
                <span className="flex-1 truncate">{e.title ?? "Sans titre"}</span>
                <span className="text-muted-foreground text-xs">{e.userName ?? ""}</span>
                <span className="text-muted-foreground text-xs">{formatDateTime(e.startAt)}</span>
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
        resolver={mdResolver}
        attachmentsByNote={attachmentsByNote}
      />
    </div>
  );
}
