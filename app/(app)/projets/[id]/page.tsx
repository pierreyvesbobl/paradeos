import { TaskAssigneeEditor } from "@/app/(app)/taches/inline-editors/assignee-editor";
import { TaskDueDateEditor } from "@/app/(app)/taches/inline-editors/due-date-editor";
import { TaskPriorityEditor } from "@/app/(app)/taches/inline-editors/priority-editor";
import { TaskRowActions } from "@/app/(app)/taches/inline-editors/row-actions";
import { TaskStatusEditor } from "@/app/(app)/taches/inline-editors/status-editor";
import { QuickAddTask } from "@/app/(app)/taches/quick-add-task";
import { TaskToggle } from "@/app/(app)/taches/task-toggle";
import { DeleteButton } from "@/components/delete-button";
import { NoteList } from "@/components/notes/note-list";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { deleteProjectAndRedirect } from "@/lib/actions/projects";
import { buildMarkdownResolver } from "@/lib/db/queries/mention-resolver";
import { getAttachmentsForNotes, getNotesForSubject } from "@/lib/db/queries/notes";
import { getProjectProfitability } from "@/lib/db/queries/profitability";
import { getProjectTimeStats } from "@/lib/db/queries/time-stats";
import { db } from "@/lib/db/server";
import { formatDuration, formatEuro } from "@/lib/format";
import { opportunityStatusLabels } from "@/lib/schemas/opportunities";
import { projectBillingTypeLabels } from "@/lib/schemas/projects";
import { asc, desc, eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ProjBilling,
  ProjBudget,
  ProjColor,
  ProjDate,
  ProjDescription,
  ProjEntity,
  ProjHourlyRate,
  ProjIcon,
  ProjKind,
  ProjName,
  ProjOwner,
  ProjStatus,
} from "./inline-fields";

type Params = Promise<{ id: string }>;

export default async function ProjectDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();

  const [row] = await conn
    .select({
      project: projects,
      entity: entities,
      ownerId: users.id,
      ownerName: users.fullName,
      ownerAvatarUrl: users.avatarUrl,
    })
    .from(projects)
    .leftJoin(entities, eq(projects.entityId, entities.id))
    .leftJoin(users, eq(projects.ownerId, users.id))
    .where(eq(projects.id, id))
    .limit(1);

  if (!row) notFound();
  const { project, entity, ownerId, ownerName, ownerAvatarUrl } = row;
  const entityList = await conn
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .orderBy(asc(entities.name));
  const timeStats = await getProjectTimeStats(id);
  const profitability = await getProjectProfitability(id);
  const notesList = await getNotesForSubject("project", id);
  const attachmentRows = await getAttachmentsForNotes(notesList.map((n) => n.id));
  const attachmentsByNote: Record<string, typeof attachmentRows> = {};
  for (const a of attachmentRows) {
    if (!attachmentsByNote[a.noteId]) attachmentsByNote[a.noteId] = [];
    attachmentsByNote[a.noteId]?.push(a);
  }
  const mdResolver = await buildMarkdownResolver();

  const [linkedOpportunities, projectTasks, userOptions] = await Promise.all([
    conn
      .select({
        id: opportunities.id,
        title: opportunities.title,
        status: opportunities.status,
        valueAmount: opportunities.valueAmount,
      })
      .from(opportunities)
      .where(eq(opportunities.projectId, id))
      .orderBy(desc(opportunities.createdAt)),
    conn
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
        assigneeId: tasks.assigneeId,
        assigneeName: users.fullName,
        assigneeAvatarUrl: users.avatarUrl,
      })
      .from(tasks)
      .leftJoin(users, eq(tasks.assigneeId, users.id))
      .where(eq(tasks.projectId, id))
      .orderBy(asc(tasks.dueDate), asc(tasks.title)),
    conn
      .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
      .from(users)
      .orderBy(asc(users.fullName)),
  ]);

  const openTasks = projectTasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  const doneTasks = projectTasks.filter((t) => t.status === "done");

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Projet"
        title={
          <span className="inline-flex items-center gap-2">
            <ProjColor id={id} value={project.color} />
            <ProjIcon id={id} value={project.icon} />
            <ProjName id={id} value={project.name} />
          </span>
        }
        actions={
          <DeleteButton
            action={deleteProjectAndRedirect}
            id={id}
            label="Supprimer"
            confirmTitle={`Supprimer "${project.name}" ?`}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 rounded-lg border bg-card p-6 lg:col-span-2">
          <h2 className="font-medium text-sm">Informations</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <ProjField label="Type">
              <ProjKind id={id} value={project.kind} />
            </ProjField>
            <ProjField label="Statut">
              <ProjStatus id={id} value={project.status} />
            </ProjField>
            <ProjField label="Début">
              <ProjDate id={id} field="startDate" value={project.startDate} />
            </ProjField>
            <ProjField label="Fin">
              <ProjDate id={id} field="endDate" value={project.endDate} />
            </ProjField>
            <ProjField label="Lead">
              <ProjOwner
                id={id}
                value={
                  ownerId
                    ? {
                        id: ownerId,
                        fullName: ownerName ?? null,
                        avatarUrl: ownerAvatarUrl ?? null,
                      }
                    : null
                }
                options={userOptions}
              />
            </ProjField>
            <ProjField label="Facturation">
              <ProjBilling id={id} value={project.billingType} />
            </ProjField>
            {project.billingType === "fixed" ? (
              <ProjField label="Budget">
                <ProjBudget id={id} value={project.budgetAmount} />
              </ProjField>
            ) : null}
            {project.billingType === "hourly" ? (
              <ProjField label="Taux horaire">
                <ProjHourlyRate id={id} value={project.hourlyRate} />
              </ProjField>
            ) : null}
          </dl>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Description</p>
            <div className="mt-1">
              <ProjDescription id={id} value={project.description} />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-6">
          <div>
            <h2 className="font-medium text-sm">Entité</h2>
            <div className="mt-2 text-sm">
              <ProjEntity
                id={id}
                value={entity ? { id: entity.id, name: entity.name } : null}
                options={entityList}
              />
            </div>
            {entity ? (
              <Link
                href={`/entites/${entity.id}`}
                className="mt-1 inline-flex items-center gap-1 text-muted-foreground text-xs hover:underline"
              >
                Voir la fiche <ExternalLink className="size-3" />
              </Link>
            ) : null}
          </div>

          <div>
            <h2 className="font-medium text-sm">Opportunités ({linkedOpportunities.length})</h2>
            {linkedOpportunities.length === 0 ? (
              <p className="mt-2 text-muted-foreground text-sm">Aucune opportunité liée.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {linkedOpportunities.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/opportunites/${o.id}`}
                      className="block rounded-md border bg-background px-3 py-2 hover:bg-muted"
                    >
                      <p className="font-medium text-sm">{o.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {opportunityStatusLabels[o.status]}
                        {o.valueAmount ? ` · ${formatEuro(Number(o.valueAmount))}` : ""}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Temps passé</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            label="Réalisé"
            value={formatDuration(timeStats.totals.actualMinutes)}
            tone="actual"
          />
          <Stat
            label="Planifié"
            value={formatDuration(timeStats.totals.plannedMinutes)}
            tone="planned"
          />
          <Stat
            label="Écart"
            value={
              (timeStats.totals.actualMinutes >= timeStats.totals.plannedMinutes ? "+" : "−") +
              formatDuration(
                Math.abs(timeStats.totals.actualMinutes - timeStats.totals.plannedMinutes),
              )
            }
            tone="muted"
          />
        </div>

        {timeStats.byUser.length > 0 ? (
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Par membre</p>
            <ul className="mt-2 space-y-1.5">
              {timeStats.byUser.map((u) => (
                <li
                  key={u.userId}
                  className="flex items-center justify-between rounded border bg-background px-3 py-2 text-sm"
                >
                  <span>{u.userName ?? "(sans nom)"}</span>
                  <span className="text-muted-foreground">
                    {formatDuration(u.actualMinutes)} / {formatDuration(u.plannedMinutes)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {timeStats.byTask.length > 0 ? (
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Par tâche</p>
            <ul className="mt-2 space-y-1.5">
              {timeStats.byTask.map((t, i) => (
                <li
                  key={t.taskId ?? `unassigned-${i}`}
                  className="flex items-center justify-between rounded border bg-background px-3 py-2 text-sm"
                >
                  {t.taskId ? (
                    <Link href={`/taches/${t.taskId}`} className="hover:underline">
                      {t.taskTitle ?? "(tâche supprimée)"}
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">Sans tâche</span>
                  )}
                  <span className="text-muted-foreground">
                    {formatDuration(t.actualMinutes)} / {formatDuration(t.plannedMinutes)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {timeStats.totals.actualMinutes === 0 && timeStats.totals.plannedMinutes === 0 ? (
          <p className="text-muted-foreground text-sm">
            Aucun créneau enregistré sur ce projet. Crée-en depuis le{" "}
            <Link href="/planning" className="underline">
              calendrier
            </Link>
            .
          </p>
        ) : null}
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-sm">Rentabilité</h2>
          <Badge variant="outline">{projectBillingTypeLabels[profitability.billingType]}</Badge>
        </div>
        {profitability.billingType === "none" ? (
          <p className="text-muted-foreground text-sm">
            Projet non facturable. Coût interne : {formatEuro(profitability.costAmount)} sur{" "}
            {formatDuration(profitability.actualMinutes)} réalisés.
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded border bg-background p-3">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">Revenu</p>
                <p className="mt-1 font-semibold text-xl tracking-tight">
                  {formatEuro(profitability.revenueAmount)}
                </p>
                {profitability.billingType === "fixed" ? (
                  <p className="text-muted-foreground text-xs">
                    Forfait {formatEuro(profitability.budgetAmount)}
                  </p>
                ) : (
                  <p className="text-muted-foreground text-xs">
                    {formatEuro(profitability.hourlyRate)}/h ×{" "}
                    {formatDuration(profitability.actualMinutes)}
                  </p>
                )}
              </div>
              <div className="rounded border bg-background p-3">
                <p className="text-muted-foreground text-xs uppercase tracking-wide">
                  Coût interne
                </p>
                <p className="mt-1 font-semibold text-xl tracking-tight">
                  {formatEuro(profitability.costAmount)}
                </p>
                <p className="text-muted-foreground text-xs">
                  {formatDuration(profitability.actualMinutes)} réalisés
                </p>
              </div>
              <MarginCard amount={profitability.marginAmount} pct={profitability.marginPct} />
            </div>

            {profitability.effectiveHourlyRate != null ? (
              <p className="text-muted-foreground text-xs">
                Taux horaire effectif :{" "}
                <span className="font-mono">{formatEuro(profitability.effectiveHourlyRate)}/h</span>
              </p>
            ) : null}

            {profitability.actualMinutes === 0 ? (
              <p className="text-muted-foreground text-sm">
                Aucun temps réalisé pour l'instant — la marge est égale au revenu prévu.
              </p>
            ) : null}
          </>
        )}
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-sm">
            Tâches ({openTasks.length} ouverte{openTasks.length > 1 ? "s" : ""}
            {doneTasks.length > 0
              ? ` · ${doneTasks.length} terminée${doneTasks.length > 1 ? "s" : ""}`
              : ""}
            )
          </h2>
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/taches/nouveau?projectId=${id}`} className="text-muted-foreground">
              Détails…
            </Link>
          </Button>
        </div>

        <div className="rounded-md border">
          {projectTasks.length > 0 ? (
            <ul className="divide-y">
              {[...openTasks, ...doneTasks].map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/40">
                  <TaskToggle id={t.id} done={t.status === "done"} />
                  <Link
                    href={`/taches/${t.id}`}
                    className={`flex-1 text-sm hover:underline ${
                      t.status === "done" ? "text-muted-foreground line-through" : ""
                    }`}
                  >
                    {t.title}
                  </Link>
                  <TaskStatusEditor id={t.id} value={t.status} />
                  <TaskPriorityEditor id={t.id} value={t.priority} />
                  <TaskAssigneeEditor
                    id={t.id}
                    value={
                      t.assigneeId
                        ? {
                            id: t.assigneeId,
                            fullName: t.assigneeName,
                            avatarUrl: t.assigneeAvatarUrl,
                          }
                        : null
                    }
                    options={userOptions}
                  />
                  <TaskDueDateEditor id={t.id} value={t.dueDate} />
                  <TaskRowActions id={t.id} title={t.title} />
                </li>
              ))}
            </ul>
          ) : null}
          <div className={projectTasks.length > 0 ? "border-t" : ""}>
            <QuickAddTask projectId={id} variant="inline" placeholder="+ Ajouter une tâche…" />
          </div>
        </div>
      </section>

      <NoteList
        subjectType="project"
        subjectId={id}
        notes={notesList}
        resolver={mdResolver}
        attachmentsByNote={attachmentsByNote}
      />
    </div>
  );
}

function ProjField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "actual" | "planned" | "muted";
}) {
  const accent =
    tone === "actual"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "planned"
        ? "text-primary"
        : "text-muted-foreground";
  return (
    <div className="rounded border bg-background p-3">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{label}</p>
      <p className={`mt-1 font-semibold text-xl tracking-tight ${accent}`}>{value}</p>
    </div>
  );
}

function MarginCard({ amount, pct }: { amount: number; pct: number | null }) {
  const positive = amount >= 0;
  const tone = positive
    ? pct == null || pct >= 50
      ? "text-emerald-600 dark:text-emerald-400"
      : pct >= 30
        ? "text-amber-600 dark:text-amber-400"
        : "text-orange-600 dark:text-orange-400"
    : "text-rose-600 dark:text-rose-400";
  const sign = amount === 0 ? "" : positive ? "+" : "−";
  return (
    <div className="rounded border bg-background p-3">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">Marge</p>
      <p className={`mt-1 font-semibold text-xl tracking-tight ${tone}`}>
        {sign}
        {formatEuro(Math.abs(amount))}
      </p>
      <p className="text-muted-foreground text-xs">{pct == null ? "—" : `${pct.toFixed(1)}%`}</p>
    </div>
  );
}
