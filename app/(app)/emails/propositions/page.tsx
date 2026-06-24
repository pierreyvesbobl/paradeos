import { Breadcrumbs } from "@/components/breadcrumbs";
import { ProposalCard } from "@/components/emails/proposal-card";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { emailProposals, gmailMessages, gmailTags, gmailThreads } from "@/db/schema/gmail";
import { projects } from "@/db/schema/projects";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { Inbox } from "lucide-react";

export default async function EmailPropositionsPage() {
  const user = await requireUser();
  const conn = await db();

  const rows = await conn
    .select({
      id: emailProposals.id,
      kind: emailProposals.kind,
      payload: emailProposals.payload,
      matchedId: emailProposals.matchedId,
      matchConfidence: emailProposals.matchConfidence,
      messageId: emailProposals.messageId,
      messageSubject: gmailMessages.subject,
      messageFrom: gmailMessages.fromEmail,
      messageFromName: gmailMessages.fromName,
      messageDate: gmailMessages.internalDate,
      threadId: gmailMessages.threadId,
      threadGmailId: gmailThreads.gmailThreadId,
      createdAt: emailProposals.createdAt,
    })
    .from(emailProposals)
    .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
    .innerJoin(gmailThreads, eq(gmailThreads.id, gmailMessages.threadId))
    .where(and(eq(gmailMessages.userId, user.id), eq(emailProposals.status, "pending")))
    .orderBy(desc(emailProposals.createdAt));

  // Résout les noms des projets / catégories / contacts / entités matchés
  // pour affichage. On bucket par kind (matchedId pointe sur des tables
  // différentes selon le kind, donc pas de jointure polymorphique).
  const projectIds = new Set<string>();
  const tagIds = new Set<string>();
  const contactIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const r of rows) {
    if (r.matchedId) {
      if (r.kind === "project_link" || r.kind === "project") projectIds.add(r.matchedId);
      else if (r.kind === "category_tag") tagIds.add(r.matchedId);
      else if (r.kind === "contact") contactIds.add(r.matchedId);
      else if (r.kind === "entity") entityIds.add(r.matchedId);
    }
    if (r.kind === "task") {
      const pid = (r.payload as Record<string, unknown>).projectId as string | null;
      if (pid) projectIds.add(pid);
    }
  }

  const [projectNamesById, tagNamesById, contactNamesById, entityNamesById] = await Promise.all([
    projectIds.size > 0
      ? conn
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, [...projectIds]))
      : Promise.resolve([]),
    tagIds.size > 0
      ? conn
          .select({ id: gmailTags.id, labelName: gmailTags.labelName })
          .from(gmailTags)
          .where(inArray(gmailTags.id, [...tagIds]))
      : Promise.resolve([]),
    contactIds.size > 0
      ? conn
          .select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
          })
          .from(contacts)
          .where(inArray(contacts.id, [...contactIds]))
      : Promise.resolve([]),
    entityIds.size > 0
      ? conn
          .select({ id: entities.id, name: entities.name })
          .from(entities)
          .where(inArray(entities.id, [...entityIds]))
      : Promise.resolve([]),
  ]);

  const projectNameMap = new Map(projectNamesById.map((p) => [p.id, p.name]));
  const tagLabelMap = new Map(tagNamesById.map((t) => [t.id, t.labelName]));
  const contactNameMap = new Map(
    contactNamesById.map((c) => [c.id, `${c.firstName} ${c.lastName}`.trim()]),
  );
  const entityNameMap = new Map(entityNamesById.map((e) => [e.id, e.name]));

  // Group par message pour un affichage compact.
  const groupedByMessage = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = groupedByMessage.get(r.messageId) ?? [];
    arr.push(r);
    groupedByMessage.set(r.messageId, arr);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Breadcrumbs items={[{ label: "Emails", href: "/emails" }, { label: "Propositions" }]} />
        }
        title="Propositions LLM"
        description="Tâches et catégories à valider, extraites par le LLM depuis les emails matchés CRM. Les liens projet inférés s'appliquent automatiquement (pas de validation requise)."
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Aucune proposition en attente"
          description="Les emails matchant un contact CRM sont analysés au prochain sync (cron quotidien ou bouton 'Sync now')."
        />
      ) : (
        <ul className="space-y-4">
          {[...groupedByMessage.entries()].map(([messageId, proposals]) => {
            const first = proposals[0];
            if (!first) return null;
            return (
              <li key={messageId}>
                <ProposalCard
                  message={{
                    subject: first.messageSubject,
                    fromEmail: first.messageFrom,
                    fromName: first.messageFromName,
                    date: first.messageDate?.toISOString() ?? null,
                    threadId: first.threadId,
                    gmailThreadId: first.threadGmailId,
                  }}
                  proposals={proposals.map((p) => {
                    const pl = p.payload as Record<string, unknown>;
                    const taskProjectId = (pl.projectId as string | null) ?? null;
                    const projectName =
                      p.kind === "task" && taskProjectId
                        ? (projectNameMap.get(taskProjectId) ?? null)
                        : (p.kind === "project_link" || p.kind === "project") && p.matchedId
                          ? (projectNameMap.get(p.matchedId) ?? null)
                          : null;
                    return {
                      id: p.id,
                      kind: p.kind,
                      payload: pl,
                      matchedId: p.matchedId,
                      matchConfidence: p.matchConfidence,
                      matchedProjectName: projectName,
                      matchedTagLabel:
                        p.kind === "category_tag" && p.matchedId
                          ? (tagLabelMap.get(p.matchedId) ?? null)
                          : null,
                      matchedContactName:
                        p.kind === "contact" && p.matchedId
                          ? (contactNameMap.get(p.matchedId) ?? null)
                          : null,
                      matchedEntityName:
                        p.kind === "entity" && p.matchedId
                          ? (entityNameMap.get(p.matchedId) ?? null)
                          : null,
                    };
                  })}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
