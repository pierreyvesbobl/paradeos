import { TaskAssigneeEditor } from "@/app/(app)/taches/inline-editors/assignee-editor";
import { TaskDueDateEditor } from "@/app/(app)/taches/inline-editors/due-date-editor";
import { TaskPriorityEditor } from "@/app/(app)/taches/inline-editors/priority-editor";
import { TaskRowActions } from "@/app/(app)/taches/inline-editors/row-actions";
import { TaskStatusEditor } from "@/app/(app)/taches/inline-editors/status-editor";
import { QuickAddTask } from "@/app/(app)/taches/quick-add-task";
import { TaskToggle } from "@/app/(app)/taches/task-toggle";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { NoteList } from "@/components/notes/note-list";
import { PageHeader } from "@/components/page-header";
import { ProjectDetailLayout } from "@/components/projets/project-detail-layout";
import { Badge } from "@/components/ui/badge";
import { entities } from "@/db/schema/entities";
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
import { projectBillingTypeLabels } from "@/lib/schemas/projects";
import { cn } from "@/lib/utils";
import { asc, eq } from "drizzle-orm";
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
import { ProjectTransitionButtons } from "./transition-button";

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

  const [projectTasks, userOptions] = await Promise.all([
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

  const main = (
    <>
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium text-sm">
            Tâches ({openTasks.length} ouverte{openTasks.length > 1 ? "s" : ""}
            {doneTasks.length > 0
              ? ` · ${doneTasks.length} terminée${doneTasks.length > 1 ? "s" : ""}`
              : ""}
            )
          </h2>
        </div>

        <div className="rounded-md border bg-card">
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
    </>
  );

  const sidebar = (
    <>
      <SidebarSection title="Transition">
        <ProjectTransitionButtons projectId={id} status={project.status} />
      </SidebarSection>

      <SidebarSection title="Informations">
        <dl className="space-y-3">
          <ProjField label="Type">
            <ProjKind id={id} value={project.kind} />
          </ProjField>
          <ProjField label="Statut">
            <ProjStatus id={id} value={project.status} />
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
          <div className="grid grid-cols-2 gap-3">
            <ProjField label="Début">
              <ProjDate id={id} field="startDate" value={project.startDate} />
            </ProjField>
            <ProjField label="Fin">
              <ProjDate id={id} field="endDate" value={project.endDate} />
            </ProjField>
          </div>
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
        <ProjField label="Description">
          <ProjDescription id={id} value={project.description} />
        </ProjField>
      </SidebarSection>

      <SidebarSection title="Entité">
        <ProjEntity
          id={id}
          value={entity ? { id: entity.id, name: entity.name } : null}
          options={entityList}
        />
        {entity ? (
          <Link
            href={`/entites/${entity.id}`}
            className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:underline"
          >
            Voir la fiche <ExternalLink className="size-3" />
          </Link>
        ) : null}
      </SidebarSection>

      <SidebarSection title="Temps passé">
        {timeStats.totals.actualMinutes === 0 && timeStats.totals.plannedMinutes === 0 ? (
          <EmptyState
            compact
            title="Aucun créneau enregistré."
            description={
              <>
                Crée-en depuis le{" "}
                <Link href="/planning" className="underline">
                  calendrier
                </Link>
                .
              </>
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <CompactStat
                label="Réalisé"
                value={formatDuration(timeStats.totals.actualMinutes)}
                tone="actual"
              />
              <CompactStat
                label="Planifié"
                value={formatDuration(timeStats.totals.plannedMinutes)}
                tone="planned"
              />
              <CompactStat
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
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  Par membre
                </p>
                <ul className="space-y-1">
                  {timeStats.byUser.map((u) => (
                    <li key={u.userId} className="flex items-center justify-between text-sm">
                      <span className="truncate">{u.userName ?? "(sans nom)"}</span>
                      <span className="shrink-0 text-muted-foreground text-xs">
                        {formatDuration(u.actualMinutes)} / {formatDuration(u.plannedMinutes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {timeStats.byTask.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
                  Par tâche
                </p>
                <ul className="space-y-1">
                  {timeStats.byTask.map((t, i) => (
                    <li
                      key={t.taskId ?? `unassigned-${i}`}
                      className="flex items-center justify-between text-sm"
                    >
                      {t.taskId ? (
                        <Link href={`/taches/${t.taskId}`} className="truncate hover:underline">
                          {t.taskTitle ?? "(tâche supprimée)"}
                        </Link>
                      ) : (
                        <span className="truncate text-muted-foreground">Sans tâche</span>
                      )}
                      <span className="shrink-0 text-muted-foreground text-xs">
                        {formatDuration(t.actualMinutes)} / {formatDuration(t.plannedMinutes)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </SidebarSection>

      <SidebarSection
        title={
          <span className="flex items-center justify-between">
            <span>Rentabilité</span>
            <Badge variant="outline" className="font-normal text-[10px]">
              {projectBillingTypeLabels[profitability.billingType]}
            </Badge>
          </span>
        }
      >
        {profitability.billingType === "none" ? (
          <p className="text-muted-foreground text-xs">
            Non facturable. Coût interne : {formatEuro(profitability.costAmount)} sur{" "}
            {formatDuration(profitability.actualMinutes)} réalisés.
          </p>
        ) : profitability.actualMinutes === 0 ? (
          <EmptyState
            compact
            title="Aucun temps réalisé."
            description="La marge est égale au revenu prévu."
          />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <CompactStat
                label="Revenu"
                value={formatEuro(profitability.revenueAmount)}
                tone="muted"
              />
              <CompactStat label="Coût" value={formatEuro(profitability.costAmount)} tone="muted" />
              <CompactMargin amount={profitability.marginAmount} pct={profitability.marginPct} />
            </div>
            {profitability.effectiveHourlyRate != null ? (
              <p className="text-[11px] text-muted-foreground">
                Taux effectif :{" "}
                <span className="font-mono">{formatEuro(profitability.effectiveHourlyRate)}/h</span>
              </p>
            ) : null}
          </>
        )}
      </SidebarSection>
    </>
  );

  return (
    <div className="space-y-6">
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
      <ProjectDetailLayout main={main} sidebar={sidebar} />
    </div>
  );
}

function SidebarSection({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function ProjField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

function CompactStat({
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
        : "text-foreground";
  return (
    <div className="rounded border bg-background p-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={cn("mt-0.5 font-semibold text-sm tabular-nums", accent)}>{value}</p>
    </div>
  );
}

function CompactMargin({ amount, pct }: { amount: number; pct: number | null }) {
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
    <div className="rounded border bg-background p-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Marge</p>
      <p className={cn("mt-0.5 font-semibold text-sm tabular-nums", tone)}>
        {sign}
        {formatEuro(Math.abs(amount))}
      </p>
      {pct != null ? <p className="text-[10px] text-muted-foreground">{pct.toFixed(1)}%</p> : null}
    </div>
  );
}
