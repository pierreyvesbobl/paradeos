import { MessageCard } from "@/components/emails/message-card";
import { ProjectLinkBadge } from "@/components/emails/project-link-badge";
import { EmailProposalsPanel } from "@/components/emails/proposals-panel";
import { type ThreadLinkItem, ThreadLinks } from "@/components/emails/thread-links";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import type { EmailProposal } from "@/db/schema/gmail";
import { emailProposals } from "@/db/schema/gmail";
import { invoiceFilings } from "@/db/schema/invoice-filings";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { getThreadDetail } from "@/lib/gmail/queries";
import { ArrowDownLeft, ArrowSquareOut, ArrowUpRight } from "@phosphor-icons/react/dist/ssr";
import { asc, eq, inArray } from "drizzle-orm";

import { formatPersonName } from "@/lib/format";
export async function EmailThreadDetail({ threadId }: { threadId: string }) {
  // Garde d'auth : le détail d'un thread n'est jamais rendu anonymement.
  await requireUser();
  const conn = await db();
  // Étape 1 : queries indépendantes du thread, toutes lancées en parallèle
  // (options globales de rattachement, détail du thread).
  const [detail, projectOptions, userOptions, entityOptions, contactOptions] = await Promise.all([
    getThreadDetail(threadId),
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
  const projectLink = detail.links.find((l) => l.kind === "project" && l.targetId);

  const messageIds = detail.messages.map((m) => m.id);
  // Étape 2 : propositions du thread + lookup du projet lié, en parallèle
  // (indépendants entre eux, tous deux dépendent seulement de `detail`).
  const [proposalRowsRaw, linkedProjectRow, filingRows] = await Promise.all([
    messageIds.length > 0
      ? conn.select().from(emailProposals).where(inArray(emailProposals.messageId, messageIds))
      : Promise.resolve([] as (typeof emailProposals.$inferSelect)[]),
    projectLink?.targetId
      ? conn
          .select({ status: projects.status, name: projects.name })
          .from(projects)
          .where(eq(projects.id, projectLink.targetId))
          .limit(1)
      : Promise.resolve([]),
    messageIds.length > 0
      ? conn
          .select({
            id: invoiceFilings.id,
            direction: invoiceFilings.direction,
            status: invoiceFilings.status,
            originalFilename: invoiceFilings.originalFilename,
            generatedFilename: invoiceFilings.generatedFilename,
            supplierRaw: invoiceFilings.supplierRaw,
            customerRaw: invoiceFilings.customerRaw,
            prestationType: invoiceFilings.prestationType,
            invoiceDate: invoiceFilings.invoiceDate,
            driveFileId: invoiceFilings.driveFileId,
            errorMessage: invoiceFilings.errorMessage,
          })
          .from(invoiceFilings)
          .where(inArray(invoiceFilings.messageId, messageIds))
      : Promise.resolve([]),
  ]);

  const projectIds = new Set<string>();
  const contactIds = new Set<string>();
  const entityIds = new Set<string>();
  for (const r of proposalRowsRaw) {
    if (!r.matchedId) continue;
    if (r.kind === "project_link" || r.kind === "project") projectIds.add(r.matchedId);
    else if (r.kind === "contact") contactIds.add(r.matchedId);
    else if (r.kind === "entity") entityIds.add(r.matchedId);
  }

  const contactOptionsFmt = contactOptions.map((c) => ({
    id: c.id,
    fullName: formatPersonName(c.firstName, c.lastName),
    entityName: c.entityName,
  }));

  const [projectRows, contactRows, entityRows] = await Promise.all([
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
  ]);

  const projectNameById = new Map(projectRows.map((r) => [r.id, r.name]));
  const contactNameById = new Map(
    contactRows.map((r) => [r.id, formatPersonName(r.firstName, r.lastName)]),
  );
  const entityNameById = new Map(entityRows.map((r) => [r.id, r.name]));

  // `category_tag` : kind historique, sans surface depuis la suppression
  // de la taxonomie libre — on ne l'affiche plus.
  const proposalRows = proposalRowsRaw.flatMap((p) => {
    if (p.kind === "category_tag") return [];
    return [
      {
        ...(p as EmailProposal),
        kind: p.kind,
        matchedProjectName: (p.matchedId && projectNameById.get(p.matchedId)) || null,
        matchedContactName: (p.matchedId && contactNameById.get(p.matchedId)) || null,
        matchedEntityName: (p.matchedId && entityNameById.get(p.matchedId)) || null,
      },
    ];
  });

  // Rattachements affichés à part : le projet a sa propre carte, et les
  // libellés système de facture apparaissent avec les factures détectées.
  // Reste l'entité et le contact — montrés uniquement pour pouvoir les
  // invalider, jamais pour en ajouter.
  const allEntityNameById = new Map(entityOptions.map((e) => [e.id, e.name]));
  const allContactNameById = new Map(contactOptionsFmt.map((c) => [c.id, c.fullName]));
  const otherLinks: ThreadLinkItem[] = detail.links.flatMap((l) => {
    if ((l.kind !== "entity" && l.kind !== "contact") || !l.targetId) return [];
    const name =
      l.kind === "entity" ? allEntityNameById.get(l.targetId) : allContactNameById.get(l.targetId);
    if (!name) return [];
    return [
      {
        linkId: l.linkId,
        labelId: l.labelId,
        kind: l.kind,
        name,
        href: l.kind === "entity" ? `/entites/${l.targetId}` : `/contacts/${l.targetId}`,
        source: l.source,
        manuallyOverridden: l.manuallyOverridden,
      },
    ];
  });

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
          projectLink?.targetId && linkedProjectName
            ? {
                id: projectLink.targetId,
                name: linkedProjectName,
                source: projectLink.source,
                manuallyOverridden: projectLink.manuallyOverridden,
              }
            : null
        }
        projects={projectOptions}
      />

      {filingRows.length > 0 ? <InvoiceFilingsCard filings={filingRows} /> : null}

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

      <ThreadLinks threadId={threadId} links={otherLinks} />
    </div>
  );
}

const DIRECTION_META = {
  purchase: {
    label: "Facture d'achat",
    hint: "Reçue d'un fournisseur — classée dans Drive.",
    icon: ArrowUpRight,
    bg: "var(--ds-tint-orange-bg)",
    fg: "var(--ds-tint-orange-text)",
  },
  sale: {
    label: "Facture de vente",
    hint: "Émise par Parade — suivie via Dougs, pas classée ici.",
    icon: ArrowDownLeft,
    bg: "var(--ds-tint-green-bg)",
    fg: "var(--ds-tint-green-text)",
  },
} as const;

type FilingRow = {
  id: string;
  direction: "purchase" | "sale" | "unknown";
  status: string;
  originalFilename: string | null;
  generatedFilename: string | null;
  supplierRaw: string | null;
  customerRaw: string | null;
  prestationType: string | null;
  invoiceDate: string | null;
  driveFileId: string | null;
  errorMessage: string | null;
};

/**
 * Ce qu'a détecté l'agent facture sur les PJ du thread. Les PJ encore
 * `unknown` (en attente de traitement, ou écartées comme non-factures)
 * sont listées sans badge de sens plutôt que masquées — sinon on ne
 * comprend pas pourquoi une facture visible n'est pas classée.
 */
function InvoiceFilingsCard({ filings }: { filings: FilingRow[] }) {
  return (
    <section
      className="space-y-2 rounded-xl border bg-card p-4"
      style={{ borderColor: "var(--ds-border)" }}
    >
      <h3 className="font-semibold text-[14px]">Factures détectées</h3>
      <ul className="space-y-2">
        {filings.map((f) => {
          const meta = f.direction === "unknown" ? null : DIRECTION_META[f.direction];
          const Icon = meta?.icon;
          const counterparty = f.direction === "sale" ? f.customerRaw : f.supplierRaw;
          return (
            <li key={f.id} className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                {meta && Icon ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium text-[11px]"
                    style={{ background: meta.bg, color: meta.fg }}
                  >
                    <Icon size={11} weight="bold" />
                    {meta.label}
                  </span>
                ) : (
                  <span className="text-[11px] text-[var(--ds-text-tertiary)]">Non classée</span>
                )}
                <span className="min-w-0 truncate text-[12px] text-[var(--ds-text-muted)]">
                  {f.generatedFilename ?? f.originalFilename ?? "(sans nom)"}
                </span>
                {f.driveFileId ? (
                  <a
                    href={`https://drive.google.com/file/d/${f.driveFileId}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] text-[var(--ds-text-tertiary)] hover:underline"
                  >
                    Drive
                    <ArrowSquareOut size={10} weight="bold" />
                  </a>
                ) : null}
              </div>
              <p className="text-[11px] text-[var(--ds-text-tertiary)]">
                {counterparty ? <span>{counterparty}</span> : null}
                {f.prestationType ? ` · ${f.prestationType}` : ""}
                {f.invoiceDate ? ` · ${f.invoiceDate}` : ""}
                {meta ? ` — ${meta.hint}` : f.errorMessage ? ` — ${f.errorMessage}` : ""}
              </p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
