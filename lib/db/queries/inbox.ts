import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { emailProposals, gmailMessages, gmailTags } from "@/db/schema/gmail";
import { invoiceFilings } from "@/db/schema/invoice-filings";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { DougsAuthError } from "@/lib/dougs/client";
import { getInvoiceSuggestions, getQuoteSuggestions } from "@/lib/dougs/reconciliation";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { formatPersonName } from "@/lib/format";
/**
 * L'inbox liste chaque extraction IA à valider individuellement, tous
 * sources confondues (email / meeting / classement de facture). La
 * source est portée par chaque item pour qu'on puisse filtrer par type
 * d'extraction ET voir d'où ça vient.
 */
export type InboxSource = "email" | "meeting" | "filing" | "reconciliation";

export type InboxExtractionKind =
  // Extractions email + meeting partagées
  | "task"
  | "contact"
  | "entity"
  | "project"
  // Extractions email uniquement
  | "category_tag"
  | "project_link"
  | "entity_link"
  | "project_contact_link"
  | "draft_reply"
  // Extractions meeting uniquement
  | "opportunity"
  // Source facture fournisseur
  | "invoice_filing"
  // Rapprochements Dougs — factures clients
  | "invoice_reconciliation"
  | "quote_reconciliation";

export type InboxReconciliationAction =
  | "link_invoice_to_dougs"
  | "link_project_quote_to_dougs"
  | "link_project_as_new_milestone";

/**
 * Payload embarqué sur un item de rapprochement — `decideInboxItem`
 * l'utilise pour dispatcher vers la bonne action serveur (Dougs).
 */
export type InboxReconciliation = {
  action: InboxReconciliationAction;
  dougsId: string;
  targetId: string;
  detectedPercent?: number | null;
};

/**
 * Un candidat de rattachement affiché dans l'éditeur inline d'un
 * rapprochement — permet au user de choisir un autre projet/facture
 * que celui pré-sélectionné (le top score).
 */
export type InboxReconciliationCandidate = {
  reconciliation: InboxReconciliation;
  label: string;
  entityName: string | null;
  amountHt: number;
  score: number;
};

export type InboxItem = {
  /** ID stable, unique tous kinds confondus (`<source>:<uuid>`). */
  id: string;
  /** UUID de la proposition côté source (pour l'accept/reject). */
  sourceId: string;
  source: InboxSource;
  kind: InboxExtractionKind;
  title: string;
  /** Détail de l'extraction (ex. dueDate, projet, email…). */
  detail: string | null;
  /** D'où vient l'extraction — "Email : Devis signé" / "Meeting : Kickoff" / "Facture fournisseur". */
  sourceLabel: string;
  /** URL cible : ouvre la page où on peut accepter/rejeter la proposition. */
  href: string;
  /** Confiance du match LLM si applicable (0..1). */
  matchConfidence: number | null;
  /** ISO date pour tri chronologique. */
  dateSort: string;
  /** Label lisible (ex. "il y a 3 j"). */
  dateLabel: string | null;
  /** Contexte projet (pastille couleur si dispo). */
  projectId?: string | null;
  projectColor?: string | null;
  /** Meta chips affichés sur la ligne — dépendent du kind. */
  meta: InboxItemMeta;
  /**
   * Autres propositions pending qui portent la même action (dédup). L'accept
   * ou reject de la ligne les traitera aussi côté serveur pour éviter que
   * la même action revienne en boucle après validation.
   */
  duplicates: { source: InboxSource; sourceId: string }[];
  /**
   * Uniquement pour source="reconciliation" : payload utilisé côté action
   * pour lier la ressource Dougs au bon target Paradeos.
   */
  reconciliation?: InboxReconciliation | null;
  /**
   * Candidats alternatifs pour un rapprochement — permet à l'éditeur
   * inline de proposer un autre target que le top-scoré par défaut.
   */
  reconciliationCandidates?: InboxReconciliationCandidate[] | null;
};

export type InboxItemMeta = {
  /** Nom projet à afficher en chip (task ou meta contextuel). */
  projectName?: string | null;
  /** Nom assigné pour tâche. */
  assigneeName?: string | null;
  /** Priorité pour tâche. */
  priority?: string | null;
  /** Date d'échéance pour tâche. */
  dueDate?: string | null;
  /** Email pour contact. */
  contactEmail?: string | null;
  /** Nom d'entité pour contact/entity_link. */
  entityName?: string | null;
};

export type InboxCounts = {
  total: number;
  bySource: Record<InboxSource, number>;
  byKind: Partial<Record<InboxExtractionKind, number>>;
};

export type InboxData = {
  items: InboxItem[];
  counts: InboxCounts;
};

export async function getInboxItems(userId: string): Promise<InboxData> {
  const conn = await db();

  const [emailRows, meetingRows, filingRows] = await Promise.all([
    conn
      .select({
        id: emailProposals.id,
        kind: emailProposals.kind,
        payload: emailProposals.payload,
        matchedId: emailProposals.matchedId,
        matchConfidence: emailProposals.matchConfidence,
        createdAt: emailProposals.createdAt,
        messageId: emailProposals.messageId,
        subject: gmailMessages.subject,
        fromName: gmailMessages.fromName,
        fromEmail: gmailMessages.fromEmail,
        internalDate: gmailMessages.internalDate,
        threadId: gmailMessages.threadId,
      })
      .from(emailProposals)
      .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
      .where(
        and(
          eq(gmailMessages.userId, userId),
          eq(emailProposals.status, "pending"),
          // Les brouillons de réponse se valident depuis le thread mail
          // — pas depuis l'inbox où on ne peut pas lire le corps.
          ne(emailProposals.kind, "draft_reply"),
        ),
      )
      .orderBy(desc(emailProposals.createdAt)),

    conn
      .select({
        id: meetingProposals.id,
        kind: meetingProposals.kind,
        payload: meetingProposals.payload,
        matchedId: meetingProposals.matchedId,
        matchConfidence: meetingProposals.matchConfidence,
        createdAt: meetingProposals.createdAt,
        meetingId: meetingProposals.meetingId,
        meetingTitle: meetings.title,
        meetingOccurredAt: meetings.occurredAt,
        projectId: projects.id,
        projectColor: projects.color,
      })
      .from(meetingProposals)
      .innerJoin(meetings, eq(meetings.id, meetingProposals.meetingId))
      .leftJoin(projects, eq(projects.id, meetings.projectId))
      .where(eq(meetingProposals.status, "pending"))
      .orderBy(desc(meetingProposals.createdAt)),

    conn
      .select({
        id: invoiceFilings.id,
        originalFilename: invoiceFilings.originalFilename,
        supplierRaw: invoiceFilings.supplierRaw,
        supplierSanitized: invoiceFilings.supplierSanitized,
        prestationType: invoiceFilings.prestationType,
        invoiceDate: invoiceFilings.invoiceDate,
        confidence: invoiceFilings.confidence,
        createdAt: invoiceFilings.createdAt,
      })
      .from(invoiceFilings)
      .where(and(eq(invoiceFilings.userId, userId), eq(invoiceFilings.status, "pending")))
      .orderBy(desc(invoiceFilings.createdAt)),
  ]);

  // Rapprochement Dougs (best-effort — l'API Dougs peut être down ou
  // sans auth ; on retourne des listes vides sans casser l'inbox).
  // Cache Dougs = 5 min (cf. lib/dougs/cache.ts), donc l'impact perf
  // est concentré sur le premier hit toutes les 5 min.
  const [quoteSuggestions, invoiceResult] = await Promise.all([
    getQuoteSuggestions(userId).catch((err) => {
      if (!(err instanceof DougsAuthError))
        console.warn(
          "[inbox] getQuoteSuggestions failed:",
          err instanceof Error ? err.message : err,
        );
      return [] as Awaited<ReturnType<typeof getQuoteSuggestions>>;
    }),
    getInvoiceSuggestions(userId).catch((err) => {
      if (!(err instanceof DougsAuthError))
        console.warn(
          "[inbox] getInvoiceSuggestions failed:",
          err instanceof Error ? err.message : err,
        );
      return { invoices: [], creditNotes: [], invoiceOptions: [] } as Awaited<
        ReturnType<typeof getInvoiceSuggestions>
      >;
    }),
  ]);

  // ── Résolution des noms des records matchés (email proposals) ──────
  // matchedId est polymorphique selon kind → on bucket puis on résout
  // en 4 requêtes seulement.
  const emailProjectIds = new Set<string>();
  const emailContactIds = new Set<string>();
  const emailEntityIds = new Set<string>();
  const emailTagIds = new Set<string>();
  for (const r of emailRows) {
    // Ajoute aussi `payload.projectId` pour task/opportunity/project_contact_link :
    // c'est là que le LLM stocke le projet rattaché de la tâche, sans passer par matchedId.
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const payloadProjectId = typeof payload.projectId === "string" ? payload.projectId : null;
    if (payloadProjectId) emailProjectIds.add(payloadProjectId);
    if (!r.matchedId) continue;
    if (r.kind === "project_link" || r.kind === "project") emailProjectIds.add(r.matchedId);
    else if (r.kind === "contact" || r.kind === "project_contact_link")
      emailContactIds.add(r.matchedId);
    else if (r.kind === "entity" || r.kind === "entity_link") emailEntityIds.add(r.matchedId);
    else if (r.kind === "category_tag") emailTagIds.add(r.matchedId);
  }
  for (const r of meetingRows) {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const payloadProjectId = typeof payload.projectId === "string" ? payload.projectId : null;
    if (payloadProjectId) emailProjectIds.add(payloadProjectId);
  }

  const [projectNames, contactNames, entityNames, tagNames] = await Promise.all([
    emailProjectIds.size > 0
      ? conn
          .select({ id: projects.id, name: projects.name, color: projects.color })
          .from(projects)
          .where(inArray(projects.id, [...emailProjectIds]))
      : Promise.resolve([] as { id: string; name: string; color: string | null }[]),
    emailContactIds.size > 0
      ? conn
          .select({
            id: contacts.id,
            firstName: contacts.firstName,
            lastName: contacts.lastName,
          })
          .from(contacts)
          .where(inArray(contacts.id, [...emailContactIds]))
      : Promise.resolve([] as { id: string; firstName: string; lastName: string }[]),
    emailEntityIds.size > 0
      ? conn
          .select({ id: entities.id, name: entities.name })
          .from(entities)
          .where(inArray(entities.id, [...emailEntityIds]))
      : Promise.resolve([] as { id: string; name: string }[]),
    emailTagIds.size > 0
      ? conn
          .select({ id: gmailTags.id, labelName: gmailTags.labelName })
          .from(gmailTags)
          .where(inArray(gmailTags.id, [...emailTagIds]))
      : Promise.resolve([] as { id: string; labelName: string }[]),
  ]);

  const projectMap = new Map(projectNames.map((p) => [p.id, p]));
  const contactMap = new Map(
    contactNames.map((c) => [c.id, formatPersonName(c.firstName, c.lastName)]),
  );
  const entityMap = new Map(entityNames.map((e) => [e.id, e.name]));
  const tagMap = new Map(tagNames.map((t) => [t.id, t.labelName]));

  // Dedup cross-sources : plusieurs messages d'un même thread ou plusieurs
  // meetings peuvent générer la même proposition (ex. "rattacher contact X
  // au projet Y" 4×). On garde 1 seule ligne par action équivalente en
  // conservant la plus récente ; les autres sont mémorisées dans
  // `duplicates` pour être traitées en même temps côté serveur.
  const dedupGroups = new Map<string, InboxItem[]>();
  function pushDedup(item: InboxItem, dedupKey: string) {
    const list = dedupGroups.get(dedupKey) ?? [];
    list.push(item);
    dedupGroups.set(dedupKey, list);
  }
  const norm = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

  // Extractions "déjà connu" à masquer : le LLM a trouvé un record
  // existant qui matche → pas de décision humaine "créer ou lier" à
  // prendre, donc pas de raison de polluer l'inbox. Les proposals de
  // type link (`project_link`, `entity_link`, `project_contact_link`)
  // restent visibles : elles portent l'action de liaison elle-même.
  const AUTO_MATCH_KINDS = new Set<string>(["contact", "entity", "project"]);
  function isAutoMatched(kind: string, matchedId: string | null): boolean {
    return matchedId !== null && AUTO_MATCH_KINDS.has(kind);
  }

  // ── Email extractions ─────────────────────────────────────────────
  for (const r of emailRows) {
    if (isAutoMatched(r.kind, r.matchedId)) continue;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const bestDate = r.internalDate ?? r.createdAt;
    const senderLabel = r.fromName ?? r.fromEmail ?? "Expéditeur inconnu";
    const sourceLabel = `Email : ${r.subject?.trim() || "(sans objet)"} — ${senderLabel}`;
    const matchedProject = r.matchedId ? projectMap.get(r.matchedId) : undefined;
    // Projet lié à l'extraction : matchedProject (pour kind=project*)
    // OU payload.projectId (pour task/opportunity/project_contact_link
    // qui embarquent le projet dans leur payload).
    const payloadProjectId = typeof payload.projectId === "string" ? payload.projectId : null;
    const payloadProject = payloadProjectId ? projectMap.get(payloadProjectId) : undefined;
    const linkedProject = matchedProject ?? payloadProject;

    let title = "";
    let detail: string | null = null;
    const kind = r.kind as InboxExtractionKind;

    const meta: InboxItemMeta = {};

    if (r.kind === "task") {
      title = String(payload.title ?? "Tâche sans titre");
      meta.dueDate = (payload.dueDate as string) ?? null;
      meta.priority = (payload.priority as string) ?? null;
      meta.assigneeName = (payload.assigneeName as string) ?? null;
      meta.projectName = linkedProject?.name ?? (payload.projectName as string) ?? null;
    } else if (r.kind === "contact") {
      title = formatPersonName(
        payload.firstName as string | null,
        payload.lastName as string | null,
        "Contact sans nom",
      );
      meta.contactEmail = (payload.email as string) ?? null;
      meta.entityName = (payload.entityName as string) ?? null;
    } else if (r.kind === "entity") {
      title = String(payload.name ?? "Entité sans nom");
    } else if (r.kind === "project") {
      title = String(payload.name ?? "Projet");
    } else if (r.kind === "project_link") {
      title = matchedProject?.name ?? String(payload.projectName ?? "Projet");
      detail = "Rattachement thread → projet";
    } else if (r.kind === "entity_link") {
      title = (r.matchedId && entityMap.get(r.matchedId)) ?? String(payload.entityName ?? "Entité");
      detail = "Rattachement thread → entité";
    } else if (r.kind === "project_contact_link") {
      const contactName = r.matchedId ? contactMap.get(r.matchedId) : undefined;
      title = contactName ?? String(payload.contactName ?? "Contact");
      detail = "Ajout comme contact projet";
      meta.projectName = linkedProject?.name ?? (payload.projectName as string) ?? null;
    } else if (r.kind === "category_tag") {
      title = (r.matchedId && tagMap.get(r.matchedId)) ?? String(payload.name ?? "Tag");
      detail = "Catégorisation du thread";
    } else if (r.kind === "draft_reply") {
      title = String(payload.subject ?? "Re: (sans objet)");
      const preview = typeof payload.body === "string" ? payload.body.slice(0, 80) : null;
      detail = preview ? `${preview}…` : "Brouillon de réponse";
    } else {
      title = String(payload.name ?? payload.title ?? "Proposition");
    }

    // Clé de dédup : basée sur la sémantique de l'action, pas sur l'id
    // de la proposition. Same email extraction → same key → 1 seule ligne.
    let dedupKey = `email:${r.id}`;
    if (r.kind === "task") {
      dedupKey = `task:${norm(payload.title)}:${payloadProjectId ?? ""}`;
    } else if (r.kind === "contact") {
      const emailPart = norm(payload.email);
      const namePart = norm(
        formatPersonName(payload.firstName as string | null, payload.lastName as string | null, ""),
      );
      dedupKey = `contact:${emailPart || namePart}`;
    } else if (r.kind === "entity") {
      dedupKey = `entity:${norm(payload.name)}`;
    } else if (r.kind === "project") {
      dedupKey = `project:${norm(payload.name)}`;
    } else if (r.kind === "project_link") {
      dedupKey = `project_link:${r.matchedId ?? norm(payload.projectName)}:${r.threadId}`;
    } else if (r.kind === "entity_link") {
      dedupKey = `entity_link:${r.matchedId ?? norm(payload.entityName)}:${r.threadId}`;
    } else if (r.kind === "project_contact_link") {
      dedupKey = `project_contact_link:${r.matchedId ?? norm(payload.contactName)}:${
        payloadProjectId ?? ""
      }`;
    } else if (r.kind === "category_tag") {
      dedupKey = `category_tag:${r.matchedId ?? norm(payload.name)}:${r.threadId}`;
    } else if (r.kind === "draft_reply") {
      dedupKey = `draft_reply:${r.threadId}`;
    }

    pushDedup(
      {
        id: `email:${r.id}`,
        sourceId: r.id,
        source: "email",
        kind,
        title,
        detail,
        sourceLabel,
        href: r.threadId ? `/emails/${r.threadId}` : "/emails/propositions",
        matchConfidence: r.matchConfidence ? Number(r.matchConfidence) : null,
        dateSort: toIso(bestDate),
        dateLabel: relativeAgoLabel(bestDate),
        projectId: linkedProject?.id ?? null,
        projectColor: linkedProject?.color ?? null,
        meta,
        duplicates: [],
      },
      dedupKey,
    );
  }

  // ── Meeting extractions ───────────────────────────────────────────
  for (const r of meetingRows) {
    if (isAutoMatched(r.kind, r.matchedId)) continue;
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const bestDate = r.meetingOccurredAt ?? r.createdAt;
    const sourceLabel = `Meeting : ${r.meetingTitle}`;

    // Projet lié : soit celui du meeting (r.projectId), soit celui embarqué
    // dans le payload (task explicitement rattachée à un autre projet).
    const payloadProjectId = typeof payload.projectId === "string" ? payload.projectId : null;
    const payloadProject = payloadProjectId ? projectMap.get(payloadProjectId) : undefined;
    const linkedProjectId = payloadProject?.id ?? r.projectId ?? null;
    const linkedProjectColor = payloadProject?.color ?? r.projectColor ?? null;
    const linkedProjectName = payloadProject?.name ?? null;

    let title = "";
    const detail: string | null = null;
    const kind = r.kind as InboxExtractionKind;

    const meta: InboxItemMeta = {};

    if (r.kind === "task") {
      title = String(payload.title ?? "Tâche sans titre");
      meta.dueDate = (payload.dueDate as string) ?? null;
      meta.priority = (payload.priority as string) ?? null;
      meta.assigneeName = (payload.assigneeName as string) ?? null;
      meta.projectName = linkedProjectName ?? (payload.projectName as string) ?? null;
    } else if (r.kind === "contact") {
      title = formatPersonName(
        payload.firstName as string | null,
        payload.lastName as string | null,
        "Contact sans nom",
      );
      meta.contactEmail = (payload.email as string) ?? null;
      meta.entityName = (payload.entityName as string) ?? null;
    } else if (r.kind === "entity") {
      title = String(payload.name ?? "Entité sans nom");
    } else if (r.kind === "project") {
      title = String(payload.name ?? "Projet");
    } else if (r.kind === "opportunity") {
      title = String(payload.title ?? "Opportunité");
    } else {
      title = String(payload.title ?? payload.name ?? "Proposition");
    }

    let dedupKey = `meeting:${r.id}`;
    if (r.kind === "task") {
      dedupKey = `task:${norm(payload.title)}:${payloadProjectId ?? r.projectId ?? ""}`;
    } else if (r.kind === "contact") {
      const emailPart = norm(payload.email);
      const namePart = norm(
        formatPersonName(payload.firstName as string | null, payload.lastName as string | null, ""),
      );
      dedupKey = `contact:${emailPart || namePart}`;
    } else if (r.kind === "entity") {
      dedupKey = `entity:${norm(payload.name)}`;
    } else if (r.kind === "project") {
      dedupKey = `project:${norm(payload.name)}`;
    } else if (r.kind === "opportunity") {
      dedupKey = `opportunity:${norm(payload.title)}`;
    }

    pushDedup(
      {
        id: `meeting:${r.id}`,
        sourceId: r.id,
        source: "meeting",
        kind,
        title,
        detail,
        sourceLabel,
        href: `/meetings/${r.meetingId}`,
        matchConfidence: r.matchConfidence ? Number(r.matchConfidence) : null,
        dateSort: toIso(bestDate),
        dateLabel: relativeAgoLabel(bestDate),
        projectId: linkedProjectId,
        projectColor: linkedProjectColor,
        meta,
        duplicates: [],
      },
      dedupKey,
    );
  }

  // ── Factures fournisseurs en attente ──────────────────────────────
  for (const r of filingRows) {
    const supplier = r.supplierSanitized ?? r.supplierRaw ?? "Fournisseur inconnu";
    const detailParts: string[] = [];
    if (r.prestationType) detailParts.push(r.prestationType);
    if (r.originalFilename) detailParts.push(r.originalFilename);
    const bestDate = r.invoiceDate ?? r.createdAt;
    pushDedup(
      {
        id: `filing:${r.id}`,
        sourceId: r.id,
        source: "filing",
        kind: "invoice_filing",
        title: supplier,
        detail: detailParts.join(" · ") || null,
        sourceLabel: "Facture fournisseur",
        href: "/compta?tab=factures",
        matchConfidence: r.confidence ? Number(r.confidence) : null,
        dateSort: toIso(bestDate),
        dateLabel: relativeAgoLabel(bestDate),
        meta: {},
        duplicates: [],
      },
      `filing:${r.id}`,
    );
  }

  // ── Rapprochement Dougs — devis ──────────────────────────────────
  // 1 item par devis/facture Dougs non lié qui a au moins un candidat.
  // Aligné avec le seuil "pertinent" de reconciliation.ts (>= 0.3) : si
  // c'est bon pour /compta, c'est bon pour l'inbox. La pastille de
  // confiance colore ensuite selon la solidité du match.
  const RECO_MIN_SCORE = 0.3;
  const eurFmt = new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });
  for (const s of quoteSuggestions) {
    const top = s.candidates[0];
    if (!top || top.score.total < RECO_MIN_SCORE) continue;
    const amountLabel = s.dougs.totalHt != null ? `${eurFmt.format(s.dougs.totalHt)} HT` : "";
    const dougsRef = s.dougs.reference ?? "Sans référence";
    const title = `Devis ${dougsRef}${amountLabel ? ` · ${amountLabel}` : ""} — ${s.dougs.clientName}`;
    const candidates: InboxReconciliationCandidate[] = s.candidates
      .filter((c) => c.score.total >= RECO_MIN_SCORE)
      .map((c) => ({
        reconciliation: {
          action: "link_project_quote_to_dougs",
          dougsId: s.dougs.id,
          targetId: c.projectId,
        },
        label: c.projectName,
        entityName: c.entityName,
        amountHt: Number(c.valueAmount ?? 0),
        score: c.score.total,
      }));
    pushDedup(
      {
        id: `reconciliation:quote:${s.dougs.id}`,
        sourceId: s.dougs.id,
        source: "reconciliation",
        kind: "quote_reconciliation",
        title,
        detail: `→ Rattacher au projet ${top.projectName}`,
        sourceLabel: "Devis Dougs",
        href: "/compta?tab=rapprochement",
        matchConfidence: top.score.total,
        dateSort: toIso(s.dougs.createdAt ?? new Date().toISOString()),
        dateLabel: relativeAgoLabel(s.dougs.createdAt),
        projectId: top.projectId,
        projectColor: null,
        meta: {
          projectName: top.projectName,
          entityName: top.entityName,
        },
        duplicates: [],
        reconciliation: {
          action: "link_project_quote_to_dougs",
          dougsId: s.dougs.id,
          targetId: top.projectId,
        },
        reconciliationCandidates: candidates,
      },
      `reco:quote:${s.dougs.id}`,
    );
  }

  // ── Rapprochement Dougs — factures clients ───────────────────────
  for (const s of invoiceResult.invoices) {
    const top = s.candidates[0];
    if (!top || top.score.total < RECO_MIN_SCORE) continue;
    const amountLabel = s.dougs.totalHt != null ? `${eurFmt.format(s.dougs.totalHt)} HT` : "";
    const dougsRef = s.dougs.reference ?? "Sans référence";
    const title = `Facture ${dougsRef}${amountLabel ? ` · ${amountLabel}` : ""} — ${s.dougs.clientName}`;
    let detail = "";
    let reconciliation: InboxReconciliation;
    let projectId: string | null = null;
    let projectName: string | null = null;
    let entityName: string | null = null;
    if (top.kind === "invoice") {
      detail = `→ Rattacher à ${top.label}${top.projectName ? ` · ${top.projectName}` : ""}`;
      projectName = top.projectName;
      entityName = top.entityName;
      reconciliation = {
        action: "link_invoice_to_dougs",
        dougsId: s.dougs.id,
        targetId: top.invoiceId,
      };
    } else {
      // new_project_milestone
      const pctLabel = top.detectedPercent != null ? ` (${top.detectedPercent}%)` : "";
      detail = `→ Créer un jalon${pctLabel} sur ${top.projectName}`;
      projectId = top.projectId;
      projectName = top.projectName;
      entityName = top.entityName;
      reconciliation = {
        action: "link_project_as_new_milestone",
        dougsId: s.dougs.id,
        targetId: top.projectId,
        detectedPercent: top.detectedPercent,
      };
    }
    // Tous les candidats retenus (pas juste le top) pour l'éditeur.
    const invoiceCandidates: InboxReconciliationCandidate[] = s.candidates
      .filter((c) => c.score.total >= RECO_MIN_SCORE)
      .map((c) =>
        c.kind === "invoice"
          ? {
              reconciliation: {
                action: "link_invoice_to_dougs",
                dougsId: s.dougs.id,
                targetId: c.invoiceId,
              },
              label: c.label,
              entityName: c.entityName,
              amountHt: c.amountHt,
              score: c.score.total,
            }
          : {
              reconciliation: {
                action: "link_project_as_new_milestone",
                dougsId: s.dougs.id,
                targetId: c.projectId,
                detectedPercent: c.detectedPercent,
              },
              label: `${c.projectName} — nouveau jalon${
                c.detectedPercent != null ? ` (${c.detectedPercent}%)` : ""
              }`,
              entityName: c.entityName,
              amountHt: c.amountHt,
              score: c.score.total,
            },
      );
    pushDedup(
      {
        id: `reconciliation:invoice:${s.dougs.id}`,
        sourceId: s.dougs.id,
        source: "reconciliation",
        kind: "invoice_reconciliation",
        title,
        detail,
        sourceLabel: "Facture client Dougs",
        href: "/compta?tab=rapprochement",
        matchConfidence: top.score.total,
        dateSort: toIso(s.dougs.createdAt ?? new Date().toISOString()),
        dateLabel: relativeAgoLabel(s.dougs.createdAt),
        projectId,
        projectColor: null,
        meta: {
          projectName,
          entityName,
        },
        duplicates: [],
        reconciliation,
        reconciliationCandidates: invoiceCandidates,
      },
      `reco:invoice:${s.dougs.id}`,
    );
  }

  // Collapse chaque groupe de duplicats en 1 item : garde le plus récent
  // comme représentant, remplit `duplicates` avec les autres. Comme ça
  // l'accept/reject côté UI peut traiter le groupe entier d'un coup.
  const items: InboxItem[] = [];
  for (const group of dedupGroups.values()) {
    group.sort((a, b) => b.dateSort.localeCompare(a.dateSort));
    const primary = group[0];
    if (!primary) continue;
    primary.duplicates = group.slice(1).map((it) => ({ source: it.source, sourceId: it.sourceId }));
    items.push(primary);
  }
  items.sort((a, b) => b.dateSort.localeCompare(a.dateSort));

  const counts: InboxCounts = {
    total: items.length,
    bySource: { email: 0, meeting: 0, filing: 0, reconciliation: 0 },
    byKind: {},
  };
  for (const it of items) {
    counts.bySource[it.source]++;
    counts.byKind[it.kind] = (counts.byKind[it.kind] ?? 0) + 1;
  }

  return { items, counts };
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

/**
 * Compteur unread léger pour le badge sidebar. Somme des 3 sources
 * (pending) : chaque proposition et chaque filing compte pour 1.
 */
export async function getInboxTotalCount(userId: string): Promise<number> {
  const conn = await db();

  const [emailRow, meetingRow, filingRow] = await Promise.all([
    conn
      .select({ count: sql<number>`count(*)::int` })
      .from(emailProposals)
      .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
      .where(
        and(
          eq(gmailMessages.userId, userId),
          eq(emailProposals.status, "pending"),
          ne(emailProposals.kind, "draft_reply"),
        ),
      ),
    conn
      .select({ count: sql<number>`count(*)::int` })
      .from(meetingProposals)
      .where(eq(meetingProposals.status, "pending")),
    conn
      .select({ count: sql<number>`count(*)::int` })
      .from(invoiceFilings)
      .where(and(eq(invoiceFilings.userId, userId), eq(invoiceFilings.status, "pending"))),
  ]);

  return (emailRow[0]?.count ?? 0) + (meetingRow[0]?.count ?? 0) + (filingRow[0]?.count ?? 0);
}
