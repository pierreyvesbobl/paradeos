import { MessageCard } from "@/components/emails/message-card";
import { ProjectLinkBadge } from "@/components/emails/project-link-badge";
import { EmailProposalsPanel } from "@/components/emails/proposals-panel";
import { TagChip } from "@/components/emails/tag-chip";
import { TagPicker } from "@/components/emails/tag-picker";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import type { EmailProposal } from "@/db/schema/gmail";
import { emailProposals, gmailTags } from "@/db/schema/gmail";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { getThreadDetail, listAllTags } from "@/lib/gmail/queries";
import { ArrowSquareOut } from "@phosphor-icons/react/dist/ssr";
import { asc, eq, inArray } from "drizzle-orm";

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

export async function EmailThreadDetail({ threadId }: { threadId: string }) {
  const user = await requireUser();
  const conn = await db();
  // Étape 1 : queries indépendantes du thread, toutes lancées en parallèle
  // (options globales, listing des tags, détail du thread).
  const [detail, allTags, projectOptions, userOptions, entityOptions, contactOptions] =
    await Promise.all([
      getThreadDetail(threadId),
      listAllTags(user.id),
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

  if (!detail) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-[var(--ds-text-tertiary)] text-sm">
        Thread introuvable.
      </div>
    );
  }

  const lastMessage = detail.messages.at(-1) ?? null;
  const projectTag = detail.tags.find((t) => t.kind === "project" && t.targetId);

  const messageIds = detail.messages.map((m) => m.id);
  // Étape 2 : propositions du thread + lookup du projet lié, en parallèle
  // (indépendants entre eux, tous deux dépendent seulement de `detail`).
  const [proposalRowsRaw, linkedProjectRow] = await Promise.all([
    messageIds.length > 0
      ? conn
          .select()
          .from(emailProposals)
          .where(inArray(emailProposals.messageId, messageIds))
      : Promise.resolve([] as (typeof emailProposals.$inferSelect)[]),
    projectTag?.targetId
      ? conn
          .select({ status: projects.status, name: projects.name })
          .from(projects)
          .where(eq(projects.id, projectTag.targetId))
          .limit(1)
      : Promise.resolve([]),
  ]);

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

  const linkedProjectStatus = linkedProjectRow[0]?.status ?? null;
  const linkedProjectName = linkedProjectRow[0]?.name ?? null;

  return (
    <div className="mx-auto max-w-[840px] space-y-6 px-[30px] py-6">
      <header className="flex items-start justify-between gap-4">
        <h2
          className="min-w-0 flex-1 font-semibold text-[23px] leading-[1.22] tracking-tight"
          style={{ fontFamily: "var(--font-brand)", color: "var(--ds-text)" }}
        >
          {detail.thread.subject || "(sans objet)"}
        </h2>
        <a
          href={`https://mail.google.com/mail/u/0/#inbox/${detail.thread.gmailThreadId}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px] text-[var(--ds-text-muted)] hover:bg-[var(--ds-bg-hover)]"
          style={{ borderColor: "var(--ds-border)" }}
        >
          Ouvrir sur Gmail
          <ArrowSquareOut size={13} weight="bold" />
        </a>
      </header>

      <ProjectLinkBadge
        threadId={threadId}
        currentProject={
          projectTag?.targetId && linkedProjectName
            ? {
                id: projectTag.targetId,
                name: linkedProjectName,
                source: projectTag.source,
                manuallyOverridden: projectTag.manuallyOverridden,
              }
            : null
        }
        projects={projectOptions}
      />

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

      <section className="space-y-3">
        {detail.messages.map((m) => (
          <MessageCard key={m.id} m={m} />
        ))}
      </section>

      <section
        className="space-y-2 rounded-xl border bg-card p-4"
        style={{ borderColor: "var(--ds-border)" }}
      >
        <h3 className="font-semibold text-[14px]">Tags</h3>
        {detail.tags.filter((t) => t.kind !== "project").length === 0 ? (
          <p className="text-muted-foreground text-xs italic">Aucun tag.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {detail.tags
              .filter((t) => t.kind !== "project")
              .map((t) => (
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
          allTags={allTags.map((t) => ({ id: t.id, kind: t.kind, labelName: t.labelName }))}
          appliedTagIds={detail.tags.map((t) => t.tagId)}
        />
      </section>
    </div>
  );
}
