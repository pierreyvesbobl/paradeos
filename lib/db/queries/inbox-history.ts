import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { emailProposals, gmailMessages, gmailTags } from "@/db/schema/gmail";
import { invoiceFilings } from "@/db/schema/invoice-filings";
import { linkedinConnections } from "@/db/schema/linkedin";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { formatPersonName } from "@/lib/format";
import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { InboxExtractionKind, InboxItemMeta } from "./inbox";

/**
 * Historique de l'inbox : ce qui a déjà été décidé, avec de quoi
 * corriger après coup.
 *
 * Les rapprochements Dougs n'y figurent pas : ils ne sont pas des
 * décisions persistées mais des suggestions recalculées à chaque
 * lecture — une fois la ressource liée, la suggestion disparaît d'elle
 * -même. Leur historique, c'est le lien lui-même (cf. /compta).
 */
export type InboxHistorySource = "email" | "meeting" | "filing" | "linkedin";

/**
 * Statut normalisé, tous sources confondues :
 *   - accepted : la proposition a été validée (record créé ou liaison posée)
 *   - rejected : refusée — pour un rattachement, la liaison est invalidée
 *   - error    : classement de facture parti en erreur
 */
export type InboxHistoryStatus = "accepted" | "rejected" | "error";

export type InboxHistoryItem = {
  /** ID stable, unique tous sources confondues (`<source>:<uuid>`). */
  id: string;
  sourceId: string;
  source: InboxHistorySource;
  kind: InboxExtractionKind;
  status: InboxHistoryStatus;
  title: string;
  detail: string | null;
  /** D'où venait l'extraction — même libellé que dans « À traiter ». */
  sourceLabel: string;
  /** Retour au contexte source (thread email, meeting, page compta). */
  sourceHref: string;
  /** Fiche du record créé/lié, quand il y en a un d'ouvrable. */
  recordHref: string | null;
  recordLabel: string | null;
  /** ISO de la décision (fallback : création) pour le tri. */
  decidedSort: string;
  decidedLabel: string | null;
  decidedByName: string | null;
  projectId?: string | null;
  projectColor?: string | null;
  meta: InboxItemMeta;
  /**
   * Le record lié est éditable depuis l'historique (corriger un titre,
   * un email, une entité…) sans repasser par un revert + re-accept.
   */
  editable: boolean;
  /** La décision peut être remise en attente (retour dans « À traiter »). */
  revertible: boolean;
};

export type InboxHistoryFilters = {
  status?: "all" | InboxHistoryStatus;
  source?: "all" | InboxHistorySource;
  kind?: "all" | InboxExtractionKind;
  /** Recherche plein texte sur titre / détail / source. */
  q?: string;
  limit?: number;
  offset?: number;
};

export type InboxHistoryData = {
  items: InboxHistoryItem[];
  /** Nombre d'items correspondant aux filtres (avant pagination). */
  total: number;
  hasMore: boolean;
  /** Compteurs par statut, filtres source/kind/q appliqués. */
  byStatus: Record<InboxHistoryStatus, number>;
  bySource: Record<InboxHistorySource, number>;
  byKind: Partial<Record<InboxExtractionKind, number>>;
};

/**
 * Fenêtre max lue par source. L'historique sert à retrouver une décision
 * récente pour la corriger, pas à archiver : au-delà, on remonte par la
 * recherche plutôt que par le scroll.
 */
const MAX_WINDOW = 400;
const DEFAULT_LIMIT = 40;

/** Kinds dont le record lié est éditable (cf. updateAccepted*Proposal). */
const EDITABLE_KINDS = new Set<InboxExtractionKind>([
  "task",
  "contact",
  "entity",
  "project",
  "opportunity",
]);

export async function getInboxHistory(
  userId: string,
  filters: InboxHistoryFilters = {},
): Promise<InboxHistoryData> {
  const conn = await db();
  const limit = filters.limit ?? DEFAULT_LIMIT;
  const offset = filters.offset ?? 0;
  const wantSource = filters.source ?? "all";

  const [emailRows, meetingRows, filingRows, linkedinRows] = await Promise.all([
    wantSource === "all" || wantSource === "email"
      ? conn
          .select({
            id: emailProposals.id,
            kind: emailProposals.kind,
            payload: emailProposals.payload,
            matchedId: emailProposals.matchedId,
            createdEntityId: emailProposals.createdEntityId,
            status: emailProposals.status,
            decidedAt: emailProposals.decidedAt,
            decidedByName: users.fullName,
            createdAt: emailProposals.createdAt,
            subject: gmailMessages.subject,
            fromName: gmailMessages.fromName,
            fromEmail: gmailMessages.fromEmail,
            threadId: gmailMessages.threadId,
          })
          .from(emailProposals)
          .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
          .leftJoin(users, eq(users.id, emailProposals.decidedBy))
          .where(
            and(
              eq(gmailMessages.userId, userId),
              ne(emailProposals.status, "pending"),
              // Les brouillons se décident depuis le thread — ils ne sont
              // jamais passés par l'inbox, ils n'y ont pas d'historique.
              ne(emailProposals.kind, "draft_reply"),
              // `category_tag` : taxonomie libre supprimée (migration
              // 0015), qui a clos d'office les propositions restantes.
              // Ces lignes ne sont pas des décisions humaines et rien ne
              // sait plus les rejouer — hors historique.
              ne(emailProposals.kind, "category_tag"),
            ),
          )
          .orderBy(desc(sql`coalesce(${emailProposals.decidedAt}, ${emailProposals.createdAt})`))
          .limit(MAX_WINDOW)
      : Promise.resolve([]),

    wantSource === "all" || wantSource === "meeting"
      ? conn
          .select({
            id: meetingProposals.id,
            kind: meetingProposals.kind,
            payload: meetingProposals.payload,
            createdEntityId: meetingProposals.createdEntityId,
            status: meetingProposals.status,
            decidedAt: meetingProposals.decidedAt,
            decidedByName: users.fullName,
            createdAt: meetingProposals.createdAt,
            meetingId: meetingProposals.meetingId,
            meetingTitle: meetings.title,
            projectId: projects.id,
            projectColor: projects.color,
          })
          .from(meetingProposals)
          .innerJoin(meetings, eq(meetings.id, meetingProposals.meetingId))
          .leftJoin(projects, eq(projects.id, meetings.projectId))
          .leftJoin(users, eq(users.id, meetingProposals.decidedBy))
          .where(ne(meetingProposals.status, "pending"))
          .orderBy(
            desc(sql`coalesce(${meetingProposals.decidedAt}, ${meetingProposals.createdAt})`),
          )
          .limit(MAX_WINDOW)
      : Promise.resolve([]),

    wantSource === "all" || wantSource === "filing"
      ? conn
          .select({
            id: invoiceFilings.id,
            originalFilename: invoiceFilings.originalFilename,
            supplierRaw: invoiceFilings.supplierRaw,
            supplierSanitized: invoiceFilings.supplierSanitized,
            customerRaw: invoiceFilings.customerRaw,
            direction: invoiceFilings.direction,
            prestationType: invoiceFilings.prestationType,
            generatedFilename: invoiceFilings.generatedFilename,
            driveFileId: invoiceFilings.driveFileId,
            errorMessage: invoiceFilings.errorMessage,
            status: invoiceFilings.status,
            updatedAt: invoiceFilings.updatedAt,
            createdAt: invoiceFilings.createdAt,
          })
          .from(invoiceFilings)
          .where(and(eq(invoiceFilings.userId, userId), ne(invoiceFilings.status, "pending")))
          .orderBy(desc(invoiceFilings.updatedAt))
          .limit(MAX_WINDOW)
      : Promise.resolve([]),

    // Relations LinkedIn dont le rapprochement a été tranché. On ne
    // garde que les décisions humaines (`decided_by` non nul) : les
    // fusions automatiques sur email ou URL ne sont pas des choix qu'on
    // « corrige », et les faire remonter noierait l'historique.
    wantSource === "all" || wantSource === "linkedin"
      ? conn
          .select({
            id: linkedinConnections.id,
            firstName: linkedinConnections.firstName,
            lastName: linkedinConnections.lastName,
            headline: linkedinConnections.headline,
            company: linkedinConnections.company,
            profileUrl: linkedinConnections.profileUrl,
            matchStatus: linkedinConnections.matchStatus,
            matchedContactId: linkedinConnections.matchedContactId,
            decidedAt: linkedinConnections.decidedAt,
            decidedByName: users.fullName,
            createdAt: linkedinConnections.createdAt,
          })
          .from(linkedinConnections)
          .leftJoin(users, eq(users.id, linkedinConnections.decidedBy))
          .where(
            and(
              eq(linkedinConnections.userId, userId),
              ne(linkedinConnections.matchStatus, "pending"),
              isNotNull(linkedinConnections.decidedBy),
            ),
          )
          .orderBy(desc(linkedinConnections.decidedAt))
          .limit(MAX_WINDOW)
      : Promise.resolve([]),
  ]);

  // ── Résolution des noms des records créés/liés ────────────────────
  // `createdEntityId` est polymorphique selon le kind → on bucket, puis
  // 4 requêtes. Pour project_link / entity_link il pointe sur un libellé
  // (gmail_tags), pas sur le record CRM : on résout aussi ces libellés
  // pour afficher « rattaché à … ».
  const projectIds = new Set<string>();
  const contactIds = new Set<string>();
  const entityIds = new Set<string>();
  const tagIds = new Set<string>();

  for (const r of linkedinRows) {
    if (r.matchedContactId) contactIds.add(r.matchedContactId);
  }

  function bucketCreated(kind: string, id: string | null) {
    if (!id) return;
    if (kind === "task") return; // le titre suffit, pas de lookup
    if (kind === "project" || kind === "opportunity") projectIds.add(id);
    else if (kind === "contact" || kind === "project_contact_link") contactIds.add(id);
    else if (kind === "entity") entityIds.add(id);
    else if (kind === "project_link" || kind === "entity_link") tagIds.add(id);
  }

  for (const r of emailRows) {
    bucketCreated(r.kind, r.createdEntityId);
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.projectId === "string") projectIds.add(payload.projectId);
    if (r.matchedId && (r.kind === "project_link" || r.kind === "project"))
      projectIds.add(r.matchedId);
    if (r.matchedId && (r.kind === "entity_link" || r.kind === "entity"))
      entityIds.add(r.matchedId);
  }
  for (const r of meetingRows) {
    bucketCreated(r.kind, r.createdEntityId);
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    if (typeof payload.projectId === "string") projectIds.add(payload.projectId);
  }

  const [projectRows, contactRows, entityRows, tagRows] = await Promise.all([
    projectIds.size > 0
      ? conn
          .select({ id: projects.id, name: projects.name, color: projects.color })
          .from(projects)
          .where(inArray(projects.id, [...projectIds]))
      : Promise.resolve([] as { id: string; name: string; color: string | null }[]),
    contactIds.size > 0
      ? conn
          .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
          .from(contacts)
          .where(inArray(contacts.id, [...contactIds]))
      : Promise.resolve([] as { id: string; firstName: string; lastName: string }[]),
    entityIds.size > 0
      ? conn
          .select({ id: entities.id, name: entities.name })
          .from(entities)
          .where(inArray(entities.id, [...entityIds]))
      : Promise.resolve([] as { id: string; name: string }[]),
    tagIds.size > 0
      ? conn
          .select({ id: gmailTags.id, labelName: gmailTags.labelName })
          .from(gmailTags)
          .where(inArray(gmailTags.id, [...tagIds]))
      : Promise.resolve([] as { id: string; labelName: string }[]),
  ]);

  const projectMap = new Map(projectRows.map((p) => [p.id, p]));
  const contactMap = new Map(
    contactRows.map((c) => [c.id, formatPersonName(c.firstName, c.lastName)]),
  );
  const entityMap = new Map(entityRows.map((e) => [e.id, e.name]));
  const tagMap = new Map(tagRows.map((t) => [t.id, t.labelName]));

  /** Fiche ouvrable du record créé, quand le kind en a une. */
  function recordLink(
    kind: string,
    createdEntityId: string | null,
  ): { href: string | null; label: string | null } {
    if (!createdEntityId) return { href: null, label: null };
    if (kind === "task") return { href: `/taches/${createdEntityId}`, label: "Voir la tâche" };
    if (kind === "project" || kind === "opportunity")
      return {
        href: `/projets/${createdEntityId}`,
        label: projectMap.get(createdEntityId)?.name ?? "Voir le projet",
      };
    if (kind === "contact" || kind === "project_contact_link")
      return {
        href: `/contacts/${createdEntityId}`,
        label: contactMap.get(createdEntityId) ?? "Voir le contact",
      };
    if (kind === "entity")
      return {
        href: `/entites/${createdEntityId}`,
        label: entityMap.get(createdEntityId) ?? "Voir l'entité",
      };
    return { href: null, label: null };
  }

  const items: InboxHistoryItem[] = [];

  // ── Propositions email décidées ───────────────────────────────────
  for (const r of emailRows) {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const kind = r.kind as InboxExtractionKind;
    const status: InboxHistoryStatus = r.status === "accepted" ? "accepted" : "rejected";
    const senderLabel = r.fromName ?? r.fromEmail ?? "Expéditeur inconnu";
    const payloadProjectId = typeof payload.projectId === "string" ? payload.projectId : null;
    const linkedProject =
      (payloadProjectId ? projectMap.get(payloadProjectId) : undefined) ??
      (r.matchedId ? projectMap.get(r.matchedId) : undefined);

    const meta: InboxItemMeta = {};
    let title = "";
    let detail: string | null = null;

    if (kind === "task") {
      title = String(payload.title ?? "Tâche sans titre");
      meta.dueDate = (payload.dueDate as string) ?? null;
      meta.priority = (payload.priority as string) ?? null;
      meta.assigneeName = (payload.assigneeName as string) ?? null;
      meta.projectName = linkedProject?.name ?? (payload.projectName as string) ?? null;
    } else if (kind === "contact") {
      title = formatPersonName(
        payload.firstName as string | null,
        payload.lastName as string | null,
        "Contact sans nom",
      );
      meta.contactEmail = (payload.email as string) ?? null;
      meta.entityName = (payload.entityName as string) ?? null;
    } else if (kind === "entity" || kind === "project") {
      title = String(payload.name ?? (kind === "entity" ? "Entité" : "Projet"));
    } else if (kind === "project_link") {
      const label = r.createdEntityId ? tagMap.get(r.createdEntityId) : null;
      title =
        (r.matchedId ? projectMap.get(r.matchedId)?.name : null) ??
        String(payload.projectName ?? label ?? "Projet");
      detail = status === "accepted" ? "Thread rattaché au projet" : "Rattachement projet refusé";
    } else if (kind === "entity_link") {
      title =
        (r.matchedId ? entityMap.get(r.matchedId) : null) ?? String(payload.entityName ?? "Entité");
      detail = status === "accepted" ? "Thread rattaché à l'entité" : "Rattachement entité refusé";
    } else if (kind === "project_contact_link") {
      title =
        (r.createdEntityId ? contactMap.get(r.createdEntityId) : null) ??
        String(payload.contactName ?? "Contact");
      detail = status === "accepted" ? "Ajouté aux contacts du projet" : "Ajout refusé";
      meta.projectName = linkedProject?.name ?? (payload.projectName as string) ?? null;
    } else {
      title = String(payload.name ?? payload.title ?? "Proposition");
    }

    const decidedAt = r.decidedAt ?? r.createdAt;
    const record =
      status === "accepted"
        ? recordLink(kind, r.createdEntityId)
        : {
            href: null,
            label: null,
          };
    items.push({
      id: `email:${r.id}`,
      sourceId: r.id,
      source: "email",
      kind,
      status,
      title,
      detail,
      sourceLabel: `Email : ${r.subject?.trim() || "(sans objet)"} — ${senderLabel}`,
      sourceHref: r.threadId ? `/emails/${r.threadId}` : "/emails",
      recordHref: record.href,
      recordLabel: record.label,
      decidedSort: toIso(decidedAt),
      decidedLabel: relativeAgoLabel(decidedAt),
      decidedByName: r.decidedByName ?? null,
      projectId: linkedProject?.id ?? null,
      projectColor: linkedProject?.color ?? null,
      meta,
      editable: status === "accepted" && EDITABLE_KINDS.has(kind) && !!r.createdEntityId,
      revertible: true,
    });
  }

  // ── Propositions meeting décidées ─────────────────────────────────
  for (const r of meetingRows) {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const kind = r.kind as InboxExtractionKind;
    const status: InboxHistoryStatus = r.status === "accepted" ? "accepted" : "rejected";
    const payloadProjectId = typeof payload.projectId === "string" ? payload.projectId : null;
    const payloadProject = payloadProjectId ? projectMap.get(payloadProjectId) : undefined;

    const meta: InboxItemMeta = {};
    let title = "";

    if (kind === "task") {
      title = String(payload.title ?? "Tâche sans titre");
      meta.dueDate = (payload.dueDate as string) ?? null;
      meta.priority = (payload.priority as string) ?? null;
      meta.assigneeName = (payload.assigneeName as string) ?? null;
      meta.projectName = payloadProject?.name ?? (payload.projectName as string) ?? null;
    } else if (kind === "contact") {
      title = formatPersonName(
        payload.firstName as string | null,
        payload.lastName as string | null,
        "Contact sans nom",
      );
      meta.contactEmail = (payload.email as string) ?? null;
      meta.entityName = (payload.entityName as string) ?? null;
    } else if (kind === "opportunity") {
      title = String(payload.title ?? payload.name ?? "Opportunité");
    } else {
      title = String(payload.name ?? payload.title ?? "Proposition");
    }

    const decidedAt = r.decidedAt ?? r.createdAt;
    const record =
      status === "accepted"
        ? recordLink(kind, r.createdEntityId)
        : {
            href: null,
            label: null,
          };
    items.push({
      id: `meeting:${r.id}`,
      sourceId: r.id,
      source: "meeting",
      kind,
      status,
      title,
      detail: null,
      sourceLabel: `Meeting : ${r.meetingTitle}`,
      sourceHref: `/meetings/${r.meetingId}`,
      recordHref: record.href,
      recordLabel: record.label,
      decidedSort: toIso(decidedAt),
      decidedLabel: relativeAgoLabel(decidedAt),
      decidedByName: r.decidedByName ?? null,
      projectId: payloadProject?.id ?? r.projectId ?? null,
      projectColor: payloadProject?.color ?? r.projectColor ?? null,
      meta,
      editable: status === "accepted" && EDITABLE_KINDS.has(kind) && !!r.createdEntityId,
      revertible: true,
    });
  }

  // ── Factures fournisseurs classées / rejetées / en erreur ─────────
  for (const r of filingRows) {
    const status: InboxHistoryStatus =
      r.status === "filed" ? "accepted" : r.status === "error" ? "error" : "rejected";
    // Côté vente, le fournisseur c'est nous : le nom parlant est le client.
    const who =
      r.direction === "sale"
        ? (r.customerRaw ?? "Client inconnu")
        : (r.supplierSanitized ?? r.supplierRaw ?? "Fournisseur inconnu");
    const detailParts: string[] = [];
    if (r.direction === "sale") detailParts.push("Facture de vente");
    if (r.prestationType) detailParts.push(r.prestationType);
    if (status === "accepted" && r.generatedFilename) detailParts.push(r.generatedFilename);
    else if (r.originalFilename) detailParts.push(r.originalFilename);
    if (status === "error" && r.errorMessage) detailParts.push(r.errorMessage);

    items.push({
      id: `filing:${r.id}`,
      sourceId: r.id,
      source: "filing",
      kind: "invoice_filing",
      status,
      title: who,
      detail: detailParts.join(" · ") || null,
      sourceLabel: r.direction === "sale" ? "Facture client (copie)" : "Facture fournisseur",
      sourceHref: "/compta?tab=achats",
      recordHref: r.driveFileId ? `https://drive.google.com/file/d/${r.driveFileId}/view` : null,
      recordLabel: r.driveFileId ? "Ouvrir dans Drive" : null,
      decidedSort: toIso(r.updatedAt ?? r.createdAt),
      decidedLabel: relativeAgoLabel(r.updatedAt ?? r.createdAt),
      decidedByName: null,
      meta: {},
      // Le classement n'a pas de payload éditable : on le relance.
      editable: false,
      revertible: true,
    });
  }

  // ── Relations LinkedIn rapprochées ────────────────────────────────
  for (const r of linkedinRows) {
    const name = formatPersonName(r.firstName, r.lastName) || "Relation sans nom";
    const contactName = r.matchedContactId ? contactMap.get(r.matchedContactId) : undefined;
    // `ignored` = « ce n'est aucun de mes contacts » : un refus, pas un
    // rattachement. Les deux autres statuts ont produit un lien.
    const status: InboxHistoryStatus = r.matchStatus === "ignored" ? "rejected" : "accepted";

    items.push({
      id: `linkedin:${r.id}`,
      sourceId: r.id,
      source: "linkedin",
      kind: "contact_match",
      status,
      title: name,
      detail:
        status === "rejected"
          ? "Écartée du CRM"
          : r.matchStatus === "created"
            ? `Nouveau contact créé${r.company ? ` · ${r.company}` : ""}`
            : `Rattachée à ${contactName ?? "un contact"}`,
      sourceLabel: "Relation LinkedIn",
      sourceHref: r.profileUrl ?? "/inbox",
      recordHref: r.matchedContactId ? `/contacts/${r.matchedContactId}` : null,
      recordLabel: contactName ?? null,
      decidedSort: toIso(r.decidedAt ?? r.createdAt),
      decidedLabel: relativeAgoLabel(r.decidedAt ?? r.createdAt),
      decidedByName: r.decidedByName ?? null,
      meta: { entityName: r.company, contactName: contactName ?? null },
      // Le rapprochement n'a pas de payload éditable : on le remet en
      // attente pour le refaire, comme un classement de facture.
      editable: false,
      revertible: true,
    });
  }

  // ── Filtres + tri + pagination ────────────────────────────────────
  const bySourceFiltered = items.filter(
    (it) =>
      filters.source === undefined || filters.source === "all" || it.source === filters.source,
  );

  const q = (filters.q ?? "").trim().toLowerCase();
  const searched = q
    ? bySourceFiltered.filter((it) =>
        `${it.title} ${it.detail ?? ""} ${it.sourceLabel} ${it.meta.projectName ?? ""} ${
          it.meta.entityName ?? ""
        } ${it.meta.contactEmail ?? ""}`
          .toLowerCase()
          .includes(q),
      )
    : bySourceFiltered;

  // Compteurs calculés AVANT les filtres statut/kind, pour que les
  // pastilles des onglets restent lisibles quand on en sélectionne un.
  const byStatus: Record<InboxHistoryStatus, number> = { accepted: 0, rejected: 0, error: 0 };
  const bySource: Record<InboxHistorySource, number> = {
    email: 0,
    meeting: 0,
    filing: 0,
    linkedin: 0,
  };
  const byKind: Partial<Record<InboxExtractionKind, number>> = {};
  for (const it of searched) {
    byStatus[it.status]++;
    bySource[it.source]++;
    byKind[it.kind] = (byKind[it.kind] ?? 0) + 1;
  }

  const filtered = searched
    .filter(
      (it) =>
        filters.status === undefined || filters.status === "all" || it.status === filters.status,
    )
    .filter(
      (it) => filters.kind === undefined || filters.kind === "all" || it.kind === filters.kind,
    )
    .sort((a, b) => b.decidedSort.localeCompare(a.decidedSort));

  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    hasMore: offset + limit < filtered.length,
    byStatus,
    bySource,
    byKind,
  };
}

function relativeAgoLabel(date: Date | string | null | undefined): string | null {
  const d = toDate(date);
  if (!d) return null;
  const todayStr = new Date().toISOString().slice(0, 10);
  const dateStr = d.toISOString().slice(0, 10);
  if (dateStr === todayStr) return "Auj.";
  const diffDays = Math.round(
    (new Date(todayStr).getTime() - new Date(dateStr).getTime()) / 86_400_000,
  );
  if (diffDays > 0) return `il y a ${diffDays} j`;
  return `dans ${Math.abs(diffDays)} j`;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIso(value: Date | string | null | undefined): string {
  return (toDate(value) ?? new Date()).toISOString();
}
