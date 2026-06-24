import { Breadcrumbs } from "@/components/breadcrumbs";
import { DeleteButton } from "@/components/delete-button";
import { DriveFolderSection } from "@/components/drive/drive-folder-section";
import { EmailsTab } from "@/components/emails/emails-tab";
import { EmptyState } from "@/components/empty-state";
import { NoteList } from "@/components/notes/note-list";
import { PageHeader } from "@/components/page-header";
import { ProjectContactsField } from "@/components/projects/project-contacts-field";
import { ProjectMembersField } from "@/components/projects/project-members-field";
import { ProjectMeetingsSection } from "@/components/projets/project-meetings-section";
import { ProjectSecretsSection } from "@/components/projets/project-secrets-section";
import { ProjectTabs } from "@/components/projets/project-tabs";
import { TaskTable } from "@/components/tasks/task-table";
import type { TaskRowData } from "@/components/tasks/task-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { contacts as contactsTable } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { deleteProjectAndRedirect } from "@/lib/actions/projects";
import { getAttachmentsForNotes, getNotesForSubject } from "@/lib/db/queries/notes";
import { getProjectProfitability } from "@/lib/db/queries/profitability";
import { getProjectContacts, getProjectMembers } from "@/lib/db/queries/project-members";
import { getProjectSecretsList } from "@/lib/db/queries/project-secrets";
import { fetchAssigneesForTasks } from "@/lib/db/queries/task-assignees";
import { getProjectTimeStats } from "@/lib/db/queries/time-stats";
import { db } from "@/lib/db/server";
import { EntityName, EuroAmount, ProjectName } from "@/lib/demo/components";
import { formatDuration } from "@/lib/format";
import { projectBillingTypeLabels } from "@/lib/schemas/projects";
import { cn } from "@/lib/utils";
import { and, asc, eq } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { BillingMilestonesSection } from "./billing-milestones-section";
import { BillingSummary } from "./billing-summary";
import { DougsQuoteSection } from "./dougs-quote-section";
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
  ProjPeriod,
  ProjProbability,
  ProjSource,
  ProjStatus,
  ProjValueAmount,
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

  // Requêtes en 2 vagues parallèles séquentielles. Un Promise.all de
  // 12+ queries sur le pooler Supabase 6543 (transaction mode) déclenche
  // des ETIMEDOUT côté Supavisor — au-delà de ~8 queries concurrentes,
  // le pooler n'arrive plus à les router et la page hang en prod. En
  // splittant on reste largement sous le seuil. La vague 1 contient
  // toutes les data spécifiques au projet (rendu immédiat). La vague 2
  // contient les listes globales (entities/users/contacts) utilisées
  // par les dropdowns d'édition — peu critiques pour le first paint mais
  // toujours awaited car les composants client en ont besoin synchrones.
  const notesPromise = getNotesForSubject("project", id).then(async (n) => ({
    list: n,
    attachments: await getAttachmentsForNotes(n.map((x) => x.id)),
  }));

  const [
    quoteInvoiceRows,
    milestonesRows,
    timeStats,
    profitability,
    notesData,
    projectTasks,
    projectMemberRows,
    projectContactRows,
    secretsList,
  ] = await Promise.all([
    conn
      .select()
      .from(invoices)
      .where(and(eq(invoices.projectId, id), eq(invoices.kind, "quote")))
      .limit(1),
    conn
      .select()
      .from(invoices)
      .where(and(eq(invoices.projectId, id), eq(invoices.kind, "milestone")))
      .orderBy(asc(invoices.createdAt)),
    getProjectTimeStats(id),
    getProjectProfitability(id),
    notesPromise,
    conn
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .where(eq(tasks.projectId, id))
      .orderBy(asc(tasks.dueDate), asc(tasks.title)),
    getProjectMembers(id),
    getProjectContacts(id),
    getProjectSecretsList(id),
  ]);

  const [entityList, userOptions, contactOptions] = await Promise.all([
    conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .orderBy(asc(entities.name)),
    conn
      .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
      .from(users)
      .orderBy(asc(users.fullName)),
    conn
      .select({
        id: contactsTable.id,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        email: contactsTable.email,
        entityName: entities.name,
      })
      .from(contactsTable)
      .leftJoin(entities, eq(entities.id, contactsTable.entityId))
      .orderBy(asc(contactsTable.lastName), asc(contactsTable.firstName)),
  ]);

  const contactAssigneeOptions = contactOptions.map((c) => ({
    id: c.id,
    fullName: `${c.firstName} ${c.lastName}`.trim(),
    entityName: c.entityName ?? null,
  }));

  const quoteInvoice = quoteInvoiceRows[0];
  const notesList = notesData.list;
  const attachmentRows = notesData.attachments;
  const attachmentsByNote: Record<string, typeof attachmentRows> = {};
  for (const a of attachmentRows) {
    if (!attachmentsByNote[a.noteId]) attachmentsByNote[a.noteId] = [];
    attachmentsByNote[a.noteId]?.push(a);
  }

  const projectAssigneesByTask = await fetchAssigneesForTasks(
    conn,
    projectTasks.map((t) => t.id),
  );

  const taskRows: TaskRowData[] = projectTasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    projectId: id,
    projectName: project.name,
    assignees: projectAssigneesByTask.get(t.id) ?? [],
  }));

  const tasksContent = (
    <TaskTable
      rows={taskRows}
      userOptions={userOptions}
      contactOptions={contactAssigneeOptions}
      projectOptions={[]}
      hideProjectColumn
      defaultProjectId={id}
    />
  );

  const notesContent = (
    <NoteList
      subjectType="project"
      subjectId={id}
      notes={notesList}
      attachmentsByNote={attachmentsByNote}
    />
  );

  // ProjectMeetingsSection et DriveFolderSection font des appels externes
  // (DB + Google Drive API) qui ne doivent pas bloquer le rendu initial
  // de la page. Les tabs étant client, leur contenu est rendu côté serveur
  // pour TOUS les onglets — donc même si l'user reste sur "overview", le
  // Drive API call est exécuté. Suspense permet à la page de stream sans
  // les attendre.
  const meetingsContent = (
    <Suspense fallback={<TabSkeleton lines={3} />}>
      <ProjectMeetingsSection projectId={id} />
    </Suspense>
  );

  const emailsContent = (
    <Suspense fallback={<TabSkeleton lines={3} />}>
      <EmailsTab linkKind="project" linkId={id} />
    </Suspense>
  );

  const filesContent = (
    <Suspense fallback={<TabSkeleton lines={4} />}>
      <DriveFolderSection subjectType="project" subjectId={id} defaultFolderName={project.name} />
    </Suspense>
  );

  const overviewContent = (
    <div className="grid gap-6 lg:grid-cols-2">
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
          <ProjField label="Période">
            <ProjPeriod id={id} startValue={project.startDate} endValue={project.endDate} />
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

      <SidebarSection title="Membres">
        <ProjectMembersField
          projectId={id}
          members={projectMemberRows}
          options={userOptions}
          ownerId={ownerId}
        />
      </SidebarSection>

      <SidebarSection title="Contacts liés">
        <ProjectContactsField
          projectId={id}
          contacts={projectContactRows}
          options={contactOptions}
          primaryContactId={project.contactId ?? null}
        />
      </SidebarSection>

      {project.kind === "client" ? (
        <SidebarSection title="Commercial">
          <dl className="space-y-3">
            <ProjField
              label={
                quoteInvoice?.dougsTotalHt != null
                  ? "Montant prévisionnel (manuel)"
                  : "Montant prévisionnel"
              }
            >
              <div className="space-y-1">
                <ProjValueAmount id={id} value={project.valueAmount} />
                {quoteInvoice?.dougsTotalHt != null ? (
                  <p className="text-[10px] text-muted-foreground">
                    ⓘ Source de vérité : devis Dougs (
                    {Number(quoteInvoice.dougsTotalHt).toLocaleString("fr-FR", {
                      style: "currency",
                      currency: "EUR",
                    })}
                    )
                  </p>
                ) : null}
              </div>
            </ProjField>
            <ProjField label="Probabilité">
              <ProjProbability id={id} value={project.probability} />
            </ProjField>
            <ProjField label="Source">
              <ProjSource id={id} value={project.source} />
            </ProjField>
            <div className="grid grid-cols-2 gap-3">
              <ProjField label="1er contact">
                <ProjDate id={id} field="firstContactDate" value={project.firstContactDate} />
              </ProjField>
              <ProjField label="Dernier contact">
                <ProjDate id={id} field="lastContactDate" value={project.lastContactDate} />
              </ProjField>
              <ProjField label="Relance prévue">
                <ProjDate id={id} field="followUpDate" value={project.followUpDate} />
              </ProjField>
              <ProjField label="Closing estimé">
                <ProjDate id={id} field="expectedCloseDate" value={project.expectedCloseDate} />
              </ProjField>
            </div>
          </dl>
        </SidebarSection>
      ) : null}
    </div>
  );

  const quoteTotalHt =
    quoteInvoice?.dougsTotalHt != null ? Number(quoteInvoice.dougsTotalHt) : null;
  const quoteTotalTtc =
    quoteInvoice?.dougsTotalTtc != null ? Number(quoteInvoice.dougsTotalTtc) : null;

  const billingContent =
    project.kind === "client" ? (
      <div className="space-y-6">
        <BillingSummary
          projectValueHt={Number(project.valueAmount ?? project.budgetAmount ?? 0)}
          dougsQuoteTotalHt={quoteTotalHt}
          dougsQuoteReference={quoteInvoice?.dougsReference ?? null}
          dougsQuoteId={quoteInvoice?.dougsQuoteId ?? null}
          milestones={milestonesRows}
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <SidebarSection title="Devis Dougs">
            <DougsQuoteSection
              projectId={id}
              quoteInvoiceId={quoteInvoice?.id ?? null}
              localStatus={quoteInvoice?.status ?? null}
              dougsQuoteId={quoteInvoice?.dougsQuoteId ?? null}
              dougsQuoteReference={quoteInvoice?.dougsReference ?? null}
              dougsQuoteStatus={quoteInvoice?.dougsStatus ?? null}
              dougsQuotePushedAt={quoteInvoice?.invoicedAt?.toISOString() ?? null}
              dougsQuoteTotalHt={quoteTotalHt}
              dougsQuoteTotalTtc={quoteTotalTtc}
            />
          </SidebarSection>
          <SidebarSection title="Jalons de facturation">
            <BillingMilestonesSection
              projectId={id}
              projectValueHt={
                quoteTotalHt ?? Number(project.valueAmount ?? project.budgetAmount ?? 0)
              }
              milestones={milestonesRows}
            />
          </SidebarSection>
        </div>
      </div>
    ) : null;

  const secretsContent = <ProjectSecretsSection projectId={id} secrets={secretsList} />;

  const timeContent = (
    <div className="grid gap-6 lg:grid-cols-2">
      <SidebarSection title="Temps passé">
        {timeStats.totals.actualMinutes === 0 && timeStats.totals.plannedMinutes === 0 ? (
          <EmptyState
            compact
            title="Aucun créneau enregistré."
            description={
              <>
                Crée-en depuis le{" "}
                <Link href="/temps?tab=planning" className="underline">
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
            Non facturable. Coût interne :{" "}
            <EuroAmount value={profitability.costAmount} demoId={`cost:${id}`} /> sur{" "}
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
                value={<EuroAmount value={profitability.revenueAmount} demoId={`rev:${id}`} />}
                tone="muted"
              />
              <CompactStat
                label="Coût"
                value={<EuroAmount value={profitability.costAmount} demoId={`cost:${id}`} />}
                tone="muted"
              />
              <CompactMargin amount={profitability.marginAmount} pct={profitability.marginPct} />
            </div>
            {profitability.effectiveHourlyRate != null ? (
              <p className="text-[11px] text-muted-foreground">
                Taux effectif :{" "}
                <span className="font-mono">
                  <EuroAmount value={profitability.effectiveHourlyRate} demoId={`rate:${id}`} />
                  /h
                </span>
              </p>
            ) : null}
          </>
        )}
      </SidebarSection>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Breadcrumbs
            items={[
              { label: "Projets", href: "/projets" },
              ...(entity
                ? [{ label: <EntityName entity={entity} />, href: `/entites/${entity.id}` }]
                : []),
              { label: <ProjectName project={project} /> },
            ]}
          />
        }
        title={
          <span className="inline-flex items-center gap-2">
            <ProjColor id={id} value={project.color} />
            <ProjIcon id={id} value={project.icon} />
            <ProjName id={id} value={project.name} />
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/taches/gantt?project=${id}`}>Gantt</Link>
            </Button>
            <DeleteButton
              action={deleteProjectAndRedirect}
              id={id}
              label="Supprimer"
              confirmTitle="Supprimer ce projet ?"
            />
          </>
        }
      />
      <ProjectTabs
        defaultTab={
          project.kind === "client" &&
          (project.status === "not_started" ||
            project.status === "to_follow_up" ||
            project.status === "awaiting_response" ||
            project.status === "lost")
            ? "overview"
            : "tasks"
        }
        overview={overviewContent}
        tasks={tasksContent}
        notes={notesContent}
        meetings={meetingsContent}
        emails={emailsContent}
        files={filesContent}
        billing={billingContent}
        secrets={secretsContent}
        time={timeContent}
      />
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
  value: React.ReactNode;
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
        <EuroAmount value={Math.abs(amount)} demoId="margin" />
      </p>
      {pct != null ? <p className="text-[10px] text-muted-foreground">{pct.toFixed(1)}%</p> : null}
    </div>
  );
}

function TabSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: skeleton statique, index stable
          key={i}
          className="h-8 animate-pulse rounded bg-muted-foreground/15"
          style={{ width: `${100 - i * 8}%` }}
        />
      ))}
    </div>
  );
}
