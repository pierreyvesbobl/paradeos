import { Breadcrumbs } from "@/components/breadcrumbs";
import { MessageCard } from "@/components/emails/message-card";
import { TagChip } from "@/components/emails/tag-chip";
import { TagPicker } from "@/components/emails/tag-picker";
import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import type { EmailProposal } from "@/db/schema/gmail";
import { emailProposals, gmailTags } from "@/db/schema/gmail";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { getThreadDetail, listAllTags } from "@/lib/gmail/queries";
import { and, asc, eq, inArray } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { EmailProposalsPanel } from "./proposals-panel";

// Extraction + propositions changent au fil des sync — pas de cache statique.
export const dynamic = "force-dynamic";

type Params = Promise<{ threadId: string }>;

function targetHrefFor(
  kind: "project" | "contact" | "entity" | "category",
  targetId: string | null,
): string | null {
  if (!targetId) return null;
  if (kind === "project") return `/projets/${targetId}`;
  if (kind === "contact") return `/contacts/${targetId}`;
  if (kind === "entity") return `/entites/${targetId}`;
  return null;
}

export default async function ThreadDetailPage({ params }: { params: Params }) {
  const { threadId } = await params;
  const user = await requireUser();
  const detail = await getThreadDetail(threadId);
  if (!detail) notFound();

  const conn = await db();
  const allTags = await listAllTags(user.id);

  // Le dernier message porte l'extraction pertinente (résumé + intent +
  // stage + propositions à valider). Les messages précédents peuvent
  // aussi avoir des propositions, mais l'UI se concentre sur la dernière
  // — c'est la conversation actuelle.
  const lastMessage = detail.messages.at(-1) ?? null;

  // Récupère les propositions pour TOUS les messages du thread, pas
  // seulement le dernier — permet de voir l'historique des décisions
  // (accepted/rejected) accumulé au fil du thread.
  const messageIds = detail.messages.map((m) => m.id);
  const proposalRowsRaw =
    messageIds.length > 0
      ? await conn
          .select()
          .from(emailProposals)
          .where(inArray(emailProposals.messageId, messageIds))
      : [];

  // Enrichit les propositions avec les libellés des matches.
  const projectIds = new Set<string>();
  const contactIds = new Set<string>();
  const entityIds = new Set<string>();
  const tagIds = new Set<string>();
  for (const r of proposalRowsRaw) {
    if (!r.matchedId) continue;
    if (r.kind === "project_link" || r.kind === "project") projectIds.add(r.matchedId);
    else if (r.kind === "contact") contactIds.add(r.matchedId);
    else if (r.kind === "entity") entityIds.add(r.matchedId);
    else if (r.kind === "category_tag") tagIds.add(r.matchedId);
  }

  // Options complètes pour les FkCombobox de l'éditeur inline (link-to-
  // existing + résolution entité). On les charge ici plutôt que côté
  // client pour éviter un round-trip par proposition.
  const [projectOptions, userOptions, entityOptions, contactOptions] = await Promise.all([
    conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .orderBy(asc(projects.name)),
    conn
      .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
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
  ]);

  const contactOptionsFmt = contactOptions.map((c) => ({
    id: c.id,
    fullName: `${c.firstName} ${c.lastName}`.trim(),
    entityName: c.entityName,
  }));

  const [projectRows, contactRows, entityRows, tagRows] = await Promise.all([
    projectIds.size > 0
      ? conn
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, [...projectIds]))
      : Promise.resolve([]),
    contactIds.size > 0
      ? conn
          .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
          .from(contacts)
          .where(inArray(contacts.id, [...contactIds]))
      : Promise.resolve([]),
    entityIds.size > 0
      ? conn
          .select({ id: entities.id, name: entities.name })
          .from(entities)
          .where(inArray(entities.id, [...entityIds]))
      : Promise.resolve([]),
    tagIds.size > 0
      ? conn
          .select({ id: gmailTags.id, labelName: gmailTags.labelName })
          .from(gmailTags)
          .where(inArray(gmailTags.id, [...tagIds]))
      : Promise.resolve([]),
  ]);

  const projectNameById = new Map(projectRows.map((r) => [r.id, r.name]));
  const contactNameById = new Map(
    contactRows.map((r) => [r.id, `${r.firstName} ${r.lastName}`.trim()]),
  );
  const entityNameById = new Map(entityRows.map((r) => [r.id, r.name]));
  const tagLabelById = new Map(tagRows.map((r) => [r.id, r.labelName]));

  const proposalRows = proposalRowsRaw.map((p) => ({
    ...(p as EmailProposal),
    matchedProjectName: (p.matchedId && projectNameById.get(p.matchedId)) || null,
    matchedContactName: (p.matchedId && contactNameById.get(p.matchedId)) || null,
    matchedEntityName: (p.matchedId && entityNameById.get(p.matchedId)) || null,
    matchedTagLabel: (p.matchedId && tagLabelById.get(p.matchedId)) || null,
  }));

  // Si un tag projet est appliqué, on regarde son status pour comparer
  // avec le pipelineStage suggéré ("l'IA suggère de passer en X").
  const projectTag = detail.tags.find((t) => t.kind === "project" && t.targetId);
  let linkedProjectStatus: string | null = null;
  let linkedProjectName: string | null = null;
  if (projectTag?.targetId) {
    const [row] = await conn
      .select({ status: projects.status, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectTag.targetId))
      .limit(1);
    linkedProjectStatus = row?.status ?? null;
    linkedProjectName = row?.name ?? null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Breadcrumbs
            items={[
              { label: "Emails", href: "/emails" },
              { label: detail.thread.subject || "(sans objet)" },
            ]}
          />
        }
        title={detail.thread.subject || "(sans objet)"}
        actions={
          <a
            href={`https://mail.google.com/mail/u/0/#inbox/${detail.thread.gmailThreadId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Ouvrir sur Gmail
            <ExternalLink className="size-3" />
          </a>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="space-y-3">
          {detail.messages.map((m) => (
            <MessageCard key={m.id} m={m} />
          ))}
        </section>

        <aside className="space-y-4">
          <EmailProposalsPanel
            proposals={proposalRows}
            extractionMeta={lastMessage?.extractionMeta ?? null}
            extractionStatus={lastMessage?.extractionStatus ?? "skipped"}
            linkedProjectStatus={linkedProjectStatus}
            linkedProjectName={linkedProjectName}
            projects={projectOptions}
            usersList={userOptions}
            entities={entityOptions}
            contacts={contactOptionsFmt}
          />

          <section className="space-y-2 rounded-xl border bg-card p-4">
            <h3 className="font-semibold text-[14px]">Tags</h3>
            {detail.tags.length === 0 ? (
              <p className="text-muted-foreground text-xs italic">Aucun tag.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.map((t) => (
                  <TagChip
                    key={t.threadTagId}
                    threadId={threadId}
                    tagId={t.tagId}
                    kind={t.kind}
                    labelName={t.labelName}
                    source={t.source}
                    targetHref={targetHrefFor(t.kind, t.targetId)}
                  />
                ))}
              </div>
            )}
            <TagPicker
              threadId={threadId}
              allTags={allTags.map((t) => ({
                id: t.id,
                kind: t.kind,
                labelName: t.labelName,
              }))}
              appliedTagIds={detail.tags.map((t) => t.tagId)}
            />
          </section>

          <section className="space-y-2 rounded-xl border bg-card p-4">
            <h3 className="font-semibold text-[14px]">Participants</h3>
            <ul className="space-y-0.5 text-muted-foreground text-xs">
              {Array.isArray(detail.thread.participants)
                ? (detail.thread.participants as Array<{ email: string; name?: string }>).map(
                    (p) => (
                      <li key={p.email}>
                        {p.name ? `${p.name} ` : ""}
                        <span className="font-mono text-[10px]">{p.email}</span>
                      </li>
                    ),
                  )
                : null}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

// Empêche un warning "and imported but not used" si drizzle-orm re-exporte and.
void and;
