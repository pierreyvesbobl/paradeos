import "server-only";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { gmailMessages, gmailTags, gmailThreadTags, gmailThreads } from "@/db/schema/gmail";
import { projectContacts } from "@/db/schema/project-contacts";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import { createLabel, listLabels, modifyThreadLabels, updateLabel } from "@/lib/google/gmail-api";
import { and, eq, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { GENERIC_EMAIL_DOMAINS, domainFromEmail, extractDomain } from "./domain";

/**
 * Liaisons d'un thread email — et leur projection en labels Gmail.
 *
 * Modèle : un thread n'est jamais « tagué » pour lui-même. Il est LIÉ à
 * des records CRM, et chaque liaison est la conséquence de l'une de ces
 * trois choses :
 *   1. un signal auto non ambigu (participant = contact connu, domaine =
 *      entité connue, un seul projet actif candidat) ;
 *   2. une décision validée par l'utilisateur sur une proposition ;
 *   3. un fait détecté par Paradeos (sens d'une facture en PJ).
 *
 * Le label Gmail n'est qu'un miroir de ces liaisons : posé quand la
 * liaison naît, retiré quand elle est invalidée. Il n'existe aucune
 * taxonomie libre — rien ne se crée « à la main ».
 */

/**
 * Préfixe sous lequel Paradeos crée ses labels dans Gmail, pour
 * cohabiter avec les labels existants de l'utilisateur sans les polluer.
 *   Paradeos/Projets/Avenir Focus
 *   Paradeos/Contacts/Jean Dupont
 *   Paradeos/Entités/Acme Corp
 *   Paradeos/Facture achat       (libellé système, niveau 2)
 */
const LABEL_PREFIX = "Paradeos";

const KIND_LABEL_SEGMENT: Record<"project" | "contact" | "entity", string> = {
  project: "Projets",
  contact: "Contacts",
  entity: "Entités",
};

export type LinkKind = "project" | "contact" | "entity";

/**
 * Sanitize un nom pour qu'il soit valide en composant de label Gmail :
 *   - pas de `/` (séparateur de hiérarchie)
 *   - trim
 *   - tronqué à 80 chars (pour rester sous la limite Gmail de 225 chars
 *     sur le label complet)
 */
function sanitizeLabelSegment(name: string): string {
  return name.trim().replace(/\//g, " ").replace(/\s+/g, " ").slice(0, 80);
}

export function buildLabelName(kind: LinkKind | "category", name: string): string {
  const safe = sanitizeLabelSegment(name);
  if (kind === "category") return `${LABEL_PREFIX}/${safe}`;
  return `${LABEL_PREFIX}/${KIND_LABEL_SEGMENT[kind]}/${safe}`;
}

// ─── Cache labels.list par run ─────────────────────────────────────────

type LabelCache = Map<string, string>; // name → labelId

/**
 * Lit tous les labels Gmail et retourne un map name → id. À cacher au
 * niveau de l'appelant (un sync run, un push, etc.) pour éviter N appels.
 */
export async function loadGmailLabelCache(accessToken: string): Promise<LabelCache> {
  const labels = await listLabels(accessToken);
  const cache: LabelCache = new Map();
  for (const l of labels) cache.set(l.name, l.id);
  return cache;
}

/**
 * Idempotent : si le label existe déjà côté Gmail, retourne son id.
 * Sinon crée et retourne le nouvel id.
 */
async function getOrCreateGmailLabel(
  accessToken: string,
  labelName: string,
  cache: LabelCache,
): Promise<string> {
  const cached = cache.get(labelName);
  if (cached) return cached;
  try {
    const created = await createLabel(accessToken, { name: labelName });
    cache.set(labelName, created.id);
    return created.id;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 409 = déjà existe → refetch.
    if (msg.includes("409")) {
      const labels = await listLabels(accessToken);
      for (const l of labels) cache.set(l.name, l.id);
      const id = cache.get(labelName);
      if (id) return id;
    }
    throw err;
  }
}

// ─── Libellés ──────────────────────────────────────────────────────────

/**
 * Get-or-create du libellé Paradeos d'un record CRM (projet/contact/
 * entité). Ne crée PAS le label Gmail correspondant — c'est
 * `ensureGmailLabel` qui le fait à la demande (au premier push).
 */
export async function ensureCrmLabel(args: {
  userId: string;
  kind: LinkKind;
  targetId: string;
  displayName: string;
}): Promise<{ id: string; labelName: string; gmailLabelId: string | null }> {
  const conn = await db();
  const labelName = buildLabelName(args.kind, args.displayName);

  const [existing] = await conn
    .select({
      id: gmailTags.id,
      labelName: gmailTags.labelName,
      gmailLabelId: gmailTags.gmailLabelId,
    })
    .from(gmailTags)
    .where(
      and(
        eq(gmailTags.userId, args.userId),
        eq(gmailTags.kind, args.kind),
        eq(gmailTags.targetId, args.targetId),
      ),
    )
    .limit(1);

  if (existing) {
    // Le record CRM a pu être renommé depuis : on resynchronise le nom
    // en base. Le label Gmail, lui, garde son ancien nom — le renommer à
    // chaque édition coûterait un appel API par sauvegarde ; c'est
    // `backfillCrmLabels` qui rattrape l'écart (« Recalculer les liens »).
    if (existing.labelName !== labelName) {
      await conn.update(gmailTags).set({ labelName }).where(eq(gmailTags.id, existing.id));
      return { ...existing, labelName };
    }
    return existing;
  }

  const [inserted] = await conn
    .insert(gmailTags)
    .values({
      userId: args.userId,
      kind: args.kind,
      targetId: args.targetId,
      labelName,
    })
    .returning({
      id: gmailTags.id,
      labelName: gmailTags.labelName,
      gmailLabelId: gmailTags.gmailLabelId,
    });
  if (!inserted) throw new Error("Échec ensureCrmLabel");
  return inserted;
}

// ─── Libellés système : sens des factures ──────────────────────────────

/**
 * Libellés posés par le détecteur de factures pour distinguer les achats
 * des ventes. Ce sont les SEULS libellés qui ne pointent pas vers un
 * record CRM : ils projettent un fait vérifiable (`invoice_filings`), pas
 * une catégorie choisie par quelqu'un. Aucune taxonomie libre n'existe
 * plus à côté.
 */
export const INVOICE_DIRECTION_LABEL = {
  purchase: "Facture achat",
  sale: "Facture vente",
} as const;

export type InvoiceDirection = keyof typeof INVOICE_DIRECTION_LABEL;

export function invoiceDirectionLabelName(direction: InvoiceDirection): string {
  return buildLabelName("category", INVOICE_DIRECTION_LABEL[direction]);
}

/** Get-or-create d'un libellé système. Idempotent par `label_name`. */
async function ensureSystemLabel(args: {
  userId: string;
  name: string;
}): Promise<{ id: string; labelName: string }> {
  const conn = await db();
  const labelName = buildLabelName("category", args.name);

  const [existing] = await conn
    .select({ id: gmailTags.id, labelName: gmailTags.labelName })
    .from(gmailTags)
    .where(and(eq(gmailTags.userId, args.userId), eq(gmailTags.labelName, labelName)))
    .limit(1);
  if (existing) return existing;

  const [inserted] = await conn
    .insert(gmailTags)
    .values({ userId: args.userId, kind: "category", labelName })
    .returning({ id: gmailTags.id, labelName: gmailTags.labelName });
  if (!inserted) throw new Error("Échec ensureSystemLabel");
  return inserted;
}

/**
 * Marque un thread comme portant une facture d'achat / de vente, et
 * pousse le label correspondant dans Gmail. Idempotent.
 *
 * On ne retire jamais le sens opposé : un même thread peut légitimement
 * porter les deux (ex. un mail comptable avec une facture fournisseur et
 * une facture client en PJ).
 */
export async function markThreadInvoiceDirection(args: {
  userId: string;
  threadIdLocal: string;
  direction: InvoiceDirection;
}): Promise<{ labelId: string; labelName: string }> {
  const label = await ensureSystemLabel({
    userId: args.userId,
    name: INVOICE_DIRECTION_LABEL[args.direction],
  });
  await linkThread({
    userId: args.userId,
    threadIdLocal: args.threadIdLocal,
    labelId: label.id,
    source: "auto",
  });
  return { labelId: label.id, labelName: label.labelName };
}

/**
 * Pousse la création du label côté Gmail si pas encore fait, et met à
 * jour `gmail_label_id` en base. Idempotent.
 */
export async function ensureGmailLabel(
  userId: string,
  labelId: string,
  cache?: LabelCache,
): Promise<string> {
  const conn = await db();
  const [label] = await conn.select().from(gmailTags).where(eq(gmailTags.id, labelId)).limit(1);
  if (!label) throw new Error("Libellé introuvable");
  if (label.gmailLabelId) return label.gmailLabelId;

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new Error("Pas d'access token Google");

  const c = cache ?? (await loadGmailLabelCache(accessToken));
  const gmailLabelId = await getOrCreateGmailLabel(accessToken, label.labelName, c);
  await conn.update(gmailTags).set({ gmailLabelId }).where(eq(gmailTags.id, label.id));
  return gmailLabelId;
}

// ─── Sync : label IDs Gmail → liaisons ─────────────────────────────────

/**
 * À chaque sync de message, on reçoit `labelIds: string[]`. On résout
 * chaque labelId via le cache Gmail label → name → ligne `gmail_tags`.
 * Insère les liaisons manquantes.
 *
 * Convention : labels managés par Paradeos uniquement. Les autres labels
 * Gmail (Inbox, labels perso) sont ignorés. Une liaison invalidée par
 * l'utilisateur n'est jamais ressuscitée ici — l'`onConflictDoNothing`
 * bute sur la ligne « dismissed » qui scelle le refus.
 */
export async function syncThreadLabelsFromGmail(args: {
  userId: string;
  threadIdLocal: string;
  gmailLabelIds: string[];
  cache: LabelCache; // map name → id (on a besoin de l'inverse, voir ci-dessous)
}): Promise<void> {
  if (args.gmailLabelIds.length === 0) return;
  const conn = await db();

  // Inverse map id → name pour résoudre les labelIds.
  const idToName = new Map<string, string>();
  for (const [name, id] of args.cache.entries()) idToName.set(id, name);

  // Filtre : on ne considère que les labels qui commencent par "Paradeos/".
  const paradeosLabelNames = args.gmailLabelIds
    .map((id) => idToName.get(id))
    .filter((n): n is string => !!n && n.startsWith(`${LABEL_PREFIX}/`));
  if (paradeosLabelNames.length === 0) return;

  const labelRows = await conn
    .select({ id: gmailTags.id, labelName: gmailTags.labelName })
    .from(gmailTags)
    .where(
      and(eq(gmailTags.userId, args.userId), inArray(gmailTags.labelName, paradeosLabelNames)),
    );
  if (labelRows.length === 0) return;

  await conn
    .insert(gmailThreadTags)
    .values(
      labelRows.map((t) => ({
        threadId: args.threadIdLocal,
        tagId: t.id,
        source: "gmail",
      })),
    )
    .onConflictDoNothing();

  // Met à jour gmail_label_id si manquant côté gmail_tags.
  for (const labelRow of labelRows) {
    const idForName = args.cache.get(labelRow.labelName);
    if (idForName) {
      await conn
        .update(gmailTags)
        .set({ gmailLabelId: idForName })
        .where(and(eq(gmailTags.id, labelRow.id), isNull(gmailTags.gmailLabelId)));
    }
  }
}

// ─── Signaux d'auto-liaison ────────────────────────────────────────────

/**
 * Signaux de liaison d'un thread — utilisés par le sync (pour poser les
 * liens non ambigus) et par l'extraction LLM (pour générer des
 * propositions à valider sur les cas ambigus).
 */
export type ThreadLinkSignals = {
  userId: string;
  involvedEmails: string[];
  matchedContactIds: string[];
  matchedEntityIds: string[];
  /** Projets actifs candidats — union de (via contacts) ∪ (via entités). */
  candidateProjectIds: string[];
  /**
   * L'utilisateur a déjà tranché la dimension projet sur ce thread —
   * qu'il ait choisi un projet ou explicitement dit « aucun ». Dans les
   * deux cas, plus rien d'automatique ne doit y toucher.
   */
  projectDimensionLocked: boolean;
};

export async function computeThreadLinkSignals(
  threadIdLocal: string,
): Promise<ThreadLinkSignals | null> {
  const conn = await db();

  const [thread] = await conn
    .select({ userId: gmailThreads.userId })
    .from(gmailThreads)
    .where(eq(gmailThreads.id, threadIdLocal))
    .limit(1);
  if (!thread) return null;
  const userId = thread.userId;

  const msgs = await conn
    .select({
      fromEmail: gmailMessages.fromEmail,
      toEmails: gmailMessages.toEmails,
      ccEmails: gmailMessages.ccEmails,
    })
    .from(gmailMessages)
    .where(eq(gmailMessages.threadId, threadIdLocal));

  const involved = new Set<string>();
  for (const m of msgs) {
    if (m.fromEmail) involved.add(m.fromEmail.toLowerCase());
    for (const e of m.toEmails ?? []) involved.add(e.toLowerCase());
    for (const e of m.ccEmails ?? []) involved.add(e.toLowerCase());
  }
  const involvedEmails = [...involved];

  const matchedContacts =
    involvedEmails.length === 0
      ? []
      : await conn
          .select({ id: contacts.id, entityId: contacts.entityId })
          .from(contacts)
          .where(inArray(contacts.email, involvedEmails));
  const matchedContactIds = matchedContacts.map((c) => c.id);
  // L'entité rattachée au contact matché est aussi un signal fort (couvre
  // le cas où entities.website est null → le match par domaine ne
  // s'active pas, mais on connaît quand même l'entité).
  const contactDerivedEntityIds = matchedContacts
    .map((c) => c.entityId)
    .filter((id): id is string => !!id);

  // Note : on ne filtre PAS `dismissedAt is null` ici. Une liaison projet
  // invalidée compte autant qu'une liaison validée pour verrouiller la
  // dimension — c'est justement le « non » qu'il faut respecter.
  const decidedProjectLink = await conn
    .select({ tagId: gmailThreadTags.tagId })
    .from(gmailThreadTags)
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(
      and(
        eq(gmailThreadTags.threadId, threadIdLocal),
        eq(gmailThreadTags.manuallyOverridden, true),
        eq(gmailTags.kind, "project"),
      ),
    )
    .limit(1);
  const projectDimensionLocked = decidedProjectLink.length > 0;

  const candidateProjectIds = new Set<string>();
  if (matchedContactIds.length > 0) {
    const projRows = await conn
      .select({ id: projects.id })
      .from(projectContacts)
      .innerJoin(projects, eq(projects.id, projectContacts.projectId))
      .where(
        and(inArray(projectContacts.contactId, matchedContactIds), ne(projects.status, "archived")),
      );
    for (const p of projRows) candidateProjectIds.add(p.id);
  }

  const involvedDomains = new Set<string>();
  for (const e of involved) {
    const d = domainFromEmail(e);
    if (d && !GENERIC_EMAIL_DOMAINS.has(d)) involvedDomains.add(d);
  }
  const matchedEntityIds = new Set<string>();
  for (const id of contactDerivedEntityIds) matchedEntityIds.add(id);
  if (involvedDomains.size > 0) {
    const entityRows = await conn
      .select({ id: entities.id, website: entities.website })
      .from(entities)
      .where(isNotNull(entities.website));
    for (const e of entityRows) {
      const d = extractDomain(e.website);
      if (d && involvedDomains.has(d)) matchedEntityIds.add(e.id);
    }
  }

  if (matchedEntityIds.size > 0) {
    const entityProjRows = await conn
      .select({ id: projects.id })
      .from(projects)
      .where(
        and(inArray(projects.entityId, [...matchedEntityIds]), ne(projects.status, "archived")),
      );
    for (const p of entityProjRows) candidateProjectIds.add(p.id);
  }

  return {
    userId,
    involvedEmails,
    matchedContactIds,
    matchedEntityIds: [...matchedEntityIds],
    candidateProjectIds: [...candidateProjectIds],
    projectDimensionLocked,
  };
}

/**
 * Pose les liaisons non ambiguës d'un thread à partir de ses
 * participants. Ne pousse PAS les labels dans Gmail (économie d'API :
 * le push se fait dans la foulée du sync via `pushThreadLabelsToGmail`).
 *
 * L'insert est `onConflictDoNothing` : une liaison invalidée par
 * l'utilisateur bloque donc la repose automatique du même lien.
 */
export async function autoLinkThreadByParticipants(threadIdLocal: string): Promise<void> {
  const signals = await computeThreadLinkSignals(threadIdLocal);
  if (!signals) return;
  const { userId, matchedEntityIds, candidateProjectIds, projectDimensionLocked } = signals;

  const conn = await db();
  const labelIdsToApply: string[] = [];

  // Entités matchées par domaine : liaison toujours posée (safe, 1 domaine
  // = 1 entité en pratique). Les cas ambigus (multi-entités par domaine)
  // partent en proposition — voir extract-and-save.
  if (matchedEntityIds.length > 0) {
    const entityRows = await conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(inArray(entities.id, matchedEntityIds));
    for (const e of entityRows) {
      const label = await ensureCrmLabel({
        userId,
        kind: "entity",
        targetId: e.id,
        displayName: e.name,
      });
      labelIdsToApply.push(label.id);
    }
  }

  // Projets : liaison auto seulement quand un seul candidat actif est
  // identifié (contact + entité). Les cas ambigus (N candidats) partent
  // en proposition à valider — voir extract-and-save.
  if (!projectDimensionLocked && candidateProjectIds.length === 1 && candidateProjectIds[0]) {
    const projectId = candidateProjectIds[0];
    const [p] = await conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    if (p) {
      const label = await ensureCrmLabel({
        userId,
        kind: "project",
        targetId: p.id,
        displayName: p.name,
      });
      labelIdsToApply.push(label.id);
    }
  }

  if (labelIdsToApply.length > 0) {
    await conn
      .insert(gmailThreadTags)
      .values(labelIdsToApply.map((tagId) => ({ threadId: threadIdLocal, tagId, source: "auto" })))
      .onConflictDoNothing();
  }
}

/**
 * Pousse les liaisons ACTIVES d'un thread vers Gmail (threads.modify).
 * À appeler après `autoLinkThreadByParticipants` pour que les labels
 * apparaissent dans Gmail.
 *
 * Idempotent. Le cache labels est passé en arg pour éviter des
 * labels.list répétés sur un même run de sync.
 */
export async function pushThreadLabelsToGmail(args: {
  userId: string;
  threadIdLocal: string;
  cache: LabelCache;
  accessToken: string;
}): Promise<void> {
  const conn = await db();

  const labelRows = await conn
    .select({
      labelId: gmailTags.id,
      labelName: gmailTags.labelName,
      gmailLabelId: gmailTags.gmailLabelId,
    })
    .from(gmailThreadTags)
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(
      and(eq(gmailThreadTags.threadId, args.threadIdLocal), isNull(gmailThreadTags.dismissedAt)),
    );
  if (labelRows.length === 0) return;

  const gmailLabelIds: string[] = [];
  for (const t of labelRows) {
    let gmailLabelId = t.gmailLabelId;
    if (!gmailLabelId) {
      gmailLabelId = await getOrCreateGmailLabel(args.accessToken, t.labelName, args.cache);
      await conn.update(gmailTags).set({ gmailLabelId }).where(eq(gmailTags.id, t.labelId));
    }
    gmailLabelIds.push(gmailLabelId);
  }

  const [thread] = await conn
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(eq(gmailThreads.id, args.threadIdLocal))
    .limit(1);
  if (!thread) return;

  try {
    await modifyThreadLabels(args.accessToken, thread.gmailThreadId, {
      addLabelIds: gmailLabelIds,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404 = thread disparu côté Gmail — ignore.
    if (!msg.includes("404") && !msg.includes("notFound")) throw err;
  }
}

// ─── Décisions : lier / délier ─────────────────────────────────────────

/**
 * Lie un thread à un libellé et pousse le label dans Gmail.
 *
 * `seal: true` marque la liaison comme décidée par un humain : elle
 * survit à l'auto-link, et lève une éventuelle invalidation antérieure
 * (l'utilisateur change d'avis).
 */
export async function linkThread(args: {
  userId: string;
  threadIdLocal: string;
  labelId: string;
  source: "manual" | "auto" | "gmail";
  decidedBy?: string;
  seal?: boolean;
}): Promise<void> {
  const conn = await db();
  const seal = args.seal ?? false;

  await conn
    .insert(gmailThreadTags)
    .values({
      threadId: args.threadIdLocal,
      tagId: args.labelId,
      source: args.source,
      manuallyOverridden: seal,
      dismissedAt: null,
      decidedBy: seal ? (args.decidedBy ?? null) : null,
      createdBy: args.decidedBy ?? null,
    })
    .onConflictDoUpdate({
      target: [gmailThreadTags.threadId, gmailThreadTags.tagId],
      set: seal
        ? {
            source: args.source,
            manuallyOverridden: true,
            dismissedAt: null,
            decidedBy: args.decidedBy ?? null,
          }
        : // Sans décision humaine on ne réactive PAS une liaison invalidée :
          // seul le `source` est rafraîchi.
          { source: args.source },
    });

  // Push Gmail — best-effort : la liaison est déjà en base.
  const accessToken = await getValidAccessToken(args.userId);
  if (!accessToken) return;
  const [row] = await conn
    .select({ dismissedAt: gmailThreadTags.dismissedAt })
    .from(gmailThreadTags)
    .where(
      and(
        eq(gmailThreadTags.threadId, args.threadIdLocal),
        eq(gmailThreadTags.tagId, args.labelId),
      ),
    )
    .limit(1);
  if (row?.dismissedAt) return; // liaison invalidée : pas de label Gmail.

  const gmailLabelId = await ensureGmailLabel(args.userId, args.labelId);
  const [thread] = await conn
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(eq(gmailThreads.id, args.threadIdLocal))
    .limit(1);
  if (!thread) return;
  await modifyThreadLabels(accessToken, thread.gmailThreadId, { addLabelIds: [gmailLabelId] });
}

/**
 * Retire une liaison et le label Gmail correspondant.
 *
 * `seal: true` (défaut) enregistre une décision NÉGATIVE : la ligne est
 * conservée avec `dismissed_at`, ce qui empêche l'auto-link de reposer le
 * même lien au prochain sync. `seal: false` efface la ligne — à réserver
 * aux annulations techniques (revert d'une proposition), où l'on veut
 * précisément que les signaux automatiques reprennent la main.
 */
export async function unlinkThread(args: {
  userId: string;
  threadIdLocal: string;
  labelId: string;
  seal?: boolean;
  decidedBy?: string;
}): Promise<void> {
  const conn = await db();
  const seal = args.seal ?? true;

  if (seal) {
    await conn
      .insert(gmailThreadTags)
      .values({
        threadId: args.threadIdLocal,
        tagId: args.labelId,
        source: "manual",
        manuallyOverridden: true,
        dismissedAt: new Date(),
        decidedBy: args.decidedBy ?? null,
        createdBy: args.decidedBy ?? null,
      })
      .onConflictDoUpdate({
        target: [gmailThreadTags.threadId, gmailThreadTags.tagId],
        set: {
          manuallyOverridden: true,
          dismissedAt: new Date(),
          decidedBy: args.decidedBy ?? null,
        },
      });
  } else {
    await conn
      .delete(gmailThreadTags)
      .where(
        and(
          eq(gmailThreadTags.threadId, args.threadIdLocal),
          eq(gmailThreadTags.tagId, args.labelId),
        ),
      );
  }

  // Retire le label côté Gmail (best-effort).
  const accessToken = await getValidAccessToken(args.userId);
  if (!accessToken) return;
  const [label] = await conn
    .select({ gmailLabelId: gmailTags.gmailLabelId })
    .from(gmailTags)
    .where(eq(gmailTags.id, args.labelId))
    .limit(1);
  if (!label?.gmailLabelId) return;
  const [thread] = await conn
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(eq(gmailThreads.id, args.threadIdLocal))
    .limit(1);
  if (!thread) return;
  try {
    await modifyThreadLabels(accessToken, thread.gmailThreadId, {
      removeLabelIds: [label.gmailLabelId],
    });
  } catch (err) {
    // Si Gmail dit "label introuvable", on s'en fout — déjà retiré côté Gmail.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("404") && !msg.includes("notFound")) throw err;
  }
}

/**
 * Invalide toute une dimension sur un thread : « aucun projet », « aucune
 * de ces entités ». Utilisé quand l'utilisateur rejette une proposition
 * de rattachement — le refus porte sur la question posée, pas seulement
 * sur le candidat affiché.
 *
 * `extraLabelIds` permet de sceller aussi des candidats qui n'avaient pas
 * encore de liaison posée (proposition rejetée avant tout auto-link).
 */
export async function dismissThreadLinksOfKind(args: {
  userId: string;
  threadIdLocal: string;
  kind: LinkKind;
  decidedBy?: string;
  extraLabelIds?: string[];
}): Promise<number> {
  const conn = await db();
  const active = await conn
    .select({ labelId: gmailTags.id })
    .from(gmailThreadTags)
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(
      and(
        eq(gmailThreadTags.threadId, args.threadIdLocal),
        eq(gmailTags.kind, args.kind),
        isNull(gmailThreadTags.dismissedAt),
      ),
    );

  const labelIds = new Set<string>([
    ...active.map((r) => r.labelId),
    ...(args.extraLabelIds ?? []),
  ]);
  for (const labelId of labelIds) {
    await unlinkThread({
      userId: args.userId,
      threadIdLocal: args.threadIdLocal,
      labelId,
      seal: true,
      decidedBy: args.decidedBy,
    });
  }
  return labelIds.size;
}

/**
 * Efface toute décision (positive comme négative) sur une dimension d'un
 * thread : les liaisons sont supprimées et les labels Gmail retirés, si
 * bien que l'auto-link repart de zéro au prochain sync. C'est l'inverse
 * exact de `dismissThreadLinksOfKind` — utilisé quand on remet une
 * proposition en attente, où l'on veut justement re-poser la question.
 */
export async function clearThreadLinkDecisions(args: {
  userId: string;
  threadIdLocal: string;
  kind: LinkKind;
}): Promise<number> {
  const conn = await db();
  const rows = await conn
    .select({ labelId: gmailTags.id })
    .from(gmailThreadTags)
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(and(eq(gmailThreadTags.threadId, args.threadIdLocal), eq(gmailTags.kind, args.kind)));
  for (const r of rows) {
    await unlinkThread({
      userId: args.userId,
      threadIdLocal: args.threadIdLocal,
      labelId: r.labelId,
      seal: false,
    });
  }
  return rows.length;
}

// ─── Backfill ──────────────────────────────────────────────────────────

/**
 * Crée les libellés Paradeos pour tous les projets/entités existants et
 * pousse les labels correspondants côté Gmail. Idempotent — joué par
 * « Recalculer les liens » dans /settings/integrations.
 */
export async function backfillCrmLabels(userId: string): Promise<{
  projectsLabeled: number;
  entitiesLabeled: number;
  labelsCreated: number;
  labelsRenamed: number;
  errors: string[];
}> {
  const stats = {
    projectsLabeled: 0,
    entitiesLabeled: 0,
    labelsCreated: 0,
    labelsRenamed: 0,
    errors: [] as string[],
  };
  const conn = await db();
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    stats.errors.push("Pas d'access token Google.");
    return stats;
  }
  const cache = await loadGmailLabelCache(accessToken);
  // Inverse du cache : permet de repérer un label Gmail resté sur
  // l'ancien nom d'un projet/entité renommé depuis.
  const nameByGmailId = new Map<string, string>();
  for (const [name, id] of cache.entries()) nameByGmailId.set(id, name);

  /**
   * Aligne le nom du label Gmail sur celui du record CRM. Best-effort :
   * un renommage refusé (label supprimé côté Gmail, conflit de nom) ne
   * doit pas faire échouer le backfill.
   */
  async function syncLabelName(gmailLabelId: string, labelName: string): Promise<void> {
    const current = nameByGmailId.get(gmailLabelId);
    if (!current || current === labelName) return;
    try {
      await updateLabel(accessToken as string, gmailLabelId, { name: labelName });
      cache.delete(current);
      cache.set(labelName, gmailLabelId);
      nameByGmailId.set(gmailLabelId, labelName);
      stats.labelsRenamed++;
    } catch (err) {
      stats.errors.push(
        `rename ${current} → ${labelName}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  // 1. Projets
  const projectRows = await conn.select({ id: projects.id, name: projects.name }).from(projects);
  for (const p of projectRows) {
    try {
      const label = await ensureCrmLabel({
        userId,
        kind: "project",
        targetId: p.id,
        displayName: p.name,
      });
      stats.projectsLabeled++;
      if (label.gmailLabelId) {
        await syncLabelName(label.gmailLabelId, label.labelName);
      } else {
        const gmailLabelId = await getOrCreateGmailLabel(accessToken, label.labelName, cache);
        await conn.update(gmailTags).set({ gmailLabelId }).where(eq(gmailTags.id, label.id));
        stats.labelsCreated++;
      }
    } catch (err) {
      stats.errors.push(`project ${p.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 2. Contacts : volontairement skippés. Les contacts servent à
  // dériver les liaisons projet (via project_contacts) au moment du sync,
  // mais on ne crée pas un label Gmail par contact (risque de
  // saturation : un CRM avec 200 contacts = 200 labels supplémentaires).

  // 3. Entités
  const entityRows = await conn.select({ id: entities.id, name: entities.name }).from(entities);
  for (const e of entityRows) {
    try {
      const label = await ensureCrmLabel({
        userId,
        kind: "entity",
        targetId: e.id,
        displayName: e.name,
      });
      stats.entitiesLabeled++;
      if (label.gmailLabelId) {
        await syncLabelName(label.gmailLabelId, label.labelName);
      } else {
        const gmailLabelId = await getOrCreateGmailLabel(accessToken, label.labelName, cache);
        await conn.update(gmailTags).set({ gmailLabelId }).where(eq(gmailTags.id, label.id));
        stats.labelsCreated++;
      }
    } catch (err) {
      stats.errors.push(`entity ${e.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return stats;
}
