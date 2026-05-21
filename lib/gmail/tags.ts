import "server-only";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { gmailMessages, gmailTags, gmailThreadTags, gmailThreads } from "@/db/schema/gmail";
import { projectContacts } from "@/db/schema/project-contacts";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { getValidAccessToken } from "@/lib/google/account";
import {
  createLabel,
  deleteLabel,
  listLabels,
  modifyThreadLabels,
  updateLabel,
} from "@/lib/google/gmail-api";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { GENERIC_EMAIL_DOMAINS, domainFromEmail, extractDomain } from "./domain";

/**
 * Préfixe sous lequel Paradeos crée ses labels dans Gmail, pour
 * cohabiter avec les labels existants de l'utilisateur sans les polluer.
 *   Paradeos/Projets/Avenir Focus
 *   Paradeos/Contacts/Jean Dupont
 *   Paradeos/Entités/Acme Corp
 *   Paradeos/Compta              (catégorie libre, niveau 2)
 */
const LABEL_PREFIX = "Paradeos";

const KIND_LABEL_SEGMENT: Record<"project" | "contact" | "entity", string> = {
  project: "Projets",
  contact: "Contacts",
  entity: "Entités",
};

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

export function buildLabelName(
  kind: "project" | "contact" | "entity" | "category",
  name: string,
): string {
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

// ─── DB helpers ────────────────────────────────────────────────────────

/**
 * Get-or-create d'un tag Paradeos pour un record CRM (projet/contact/entity).
 * Ne crée PAS le label Gmail correspondant — c'est `ensureGmailLabelForTag`
 * qui le fait à la demande (au premier sync ou push).
 */
export async function ensureCrmTag(args: {
  userId: string;
  kind: "project" | "contact" | "entity";
  targetId: string;
  displayName: string;
}): Promise<{ id: string; labelName: string; gmailLabelId: string | null }> {
  const conn = await db();
  const labelName = buildLabelName(args.kind, args.displayName);

  // Cherche par (user_id, kind, target_id).
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
    // Renomme si le display a changé.
    if (existing.labelName !== labelName) {
      await conn.update(gmailTags).set({ labelName }).where(eq(gmailTags.id, existing.id));
      return { id: existing.id, labelName, gmailLabelId: existing.gmailLabelId };
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
  if (!inserted) throw new Error("Échec ensureCrmTag");
  return inserted;
}

/**
 * Crée un tag catégorie libre ("Compta", "Annexe"…). Idempotent par
 * label_name (lower-case).
 */
export async function createCategoryTag(args: {
  userId: string;
  name: string;
  color?: string;
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
    .values({
      userId: args.userId,
      kind: "category",
      labelName,
      color: args.color ?? null,
    })
    .returning({ id: gmailTags.id, labelName: gmailTags.labelName });
  if (!inserted) throw new Error("Échec createCategoryTag");
  return inserted;
}

/**
 * Pousse la création du label côté Gmail si pas encore fait, et met à
 * jour `gmail_label_id` en base. Idempotent.
 */
export async function ensureGmailLabelForTag(
  userId: string,
  tagId: string,
  cache?: LabelCache,
): Promise<string> {
  const conn = await db();
  const [tag] = await conn.select().from(gmailTags).where(eq(gmailTags.id, tagId)).limit(1);
  if (!tag) throw new Error("Tag introuvable");
  if (tag.gmailLabelId) return tag.gmailLabelId;

  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) throw new Error("Pas d'access token Google");

  const c = cache ?? (await loadGmailLabelCache(accessToken));
  const labelId = await getOrCreateGmailLabel(accessToken, tag.labelName, c);
  await conn.update(gmailTags).set({ gmailLabelId: labelId }).where(eq(gmailTags.id, tag.id));
  return labelId;
}

// ─── Sync : label IDs Gmail → thread_tags ──────────────────────────────

/**
 * À chaque sync de message, on reçoit `labelIds: string[]`. On résout
 * chaque labelId via le cache Gmail label → name → gmail_tags row.
 * Insère les associations manquantes dans `gmail_thread_tags`.
 *
 * Convention : tags managés par Paradeos uniquement. Les autres labels
 * Gmail (Inbox, custom user labels) sont ignorés.
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

  // Cherche les gmail_tags rows correspondants.
  const tagRows = await conn
    .select({ id: gmailTags.id, labelName: gmailTags.labelName })
    .from(gmailTags)
    .where(
      and(eq(gmailTags.userId, args.userId), inArray(gmailTags.labelName, paradeosLabelNames)),
    );
  if (tagRows.length === 0) return;

  // Insère les thread_tags manquants (source='gmail').
  await conn
    .insert(gmailThreadTags)
    .values(
      tagRows.map((t) => ({
        threadId: args.threadIdLocal,
        tagId: t.id,
        source: "gmail",
      })),
    )
    .onConflictDoNothing();

  // Met à jour gmail_label_id si manquant côté gmail_tags.
  for (const tagRow of tagRows) {
    const idForName = args.cache.get(tagRow.labelName);
    if (idForName) {
      await conn
        .update(gmailTags)
        .set({ gmailLabelId: idForName })
        .where(and(eq(gmailTags.id, tagRow.id), isNull(gmailTags.gmailLabelId)));
    }
  }
}

// ─── Auto-tag par contact match (remplace l'ancien autoLinkThread) ────

/**
 * Match les participants du thread aux contacts CRM par email. Pour
 * chaque match :
 *   - ensure le tag contact existe
 *   - ensure les tags des projets liés au contact existent
 *   - insère thread_tags avec source='auto'
 * Ne pousse PAS encore le label dans Gmail (économie d'API : le push
 * réel se fait à la demande via applyTagToThread).
 */
export async function autoTagThreadByParticipants(threadIdLocal: string): Promise<void> {
  const conn = await db();

  // Récupère thread + user_id + emails impliqués.
  const [thread] = await conn
    .select({ userId: gmailThreads.userId })
    .from(gmailThreads)
    .where(eq(gmailThreads.id, threadIdLocal))
    .limit(1);
  if (!thread) return;
  const userId = thread.userId;

  // Liste des emails impliqués via les messages du thread.
  const msgs = await conn
    .select({
      fromEmail: gmailMessages.fromEmail,
      toEmails: gmailMessages.toEmails,
      ccEmails: gmailMessages.ccEmails,
    })
    .from(gmailMessages)
    .where(eq(gmailMessages.threadId, threadIdLocal));

  const involvedEmails = new Set<string>();
  for (const m of msgs) {
    if (m.fromEmail) involvedEmails.add(m.fromEmail.toLowerCase());
    for (const e of m.toEmails ?? []) involvedEmails.add(e.toLowerCase());
    for (const e of m.ccEmails ?? []) involvedEmails.add(e.toLowerCase());
  }
  if (involvedEmails.size === 0) return;
  const involvedList = [...involvedEmails];

  // Match contacts.
  const matchedContacts = await conn
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .where(inArray(contacts.email, involvedList));

  // Ensure tag contact + tag entité éventuelle + tag projets.
  const tagIdsToApply: string[] = [];
  for (const c of matchedContacts) {
    const tag = await ensureCrmTag({
      userId,
      kind: "contact",
      targetId: c.id,
      displayName: `${c.firstName} ${c.lastName}`,
    });
    tagIdsToApply.push(tag.id);
  }

  // Projets via project_contacts.
  if (matchedContacts.length > 0) {
    const projRows = await conn
      .select({ id: projects.id, name: projects.name })
      .from(projectContacts)
      .innerJoin(projects, eq(projects.id, projectContacts.projectId))
      .where(
        inArray(
          projectContacts.contactId,
          matchedContacts.map((c) => c.id),
        ),
      );
    for (const p of projRows) {
      const tag = await ensureCrmTag({
        userId,
        kind: "project",
        targetId: p.id,
        displayName: p.name,
      });
      tagIdsToApply.push(tag.id);
    }
  }

  // Entités via domaine d'email (hors domaines génériques).
  const involvedDomains = new Set<string>();
  for (const e of involvedEmails) {
    const d = domainFromEmail(e);
    if (d && !GENERIC_EMAIL_DOMAINS.has(d)) involvedDomains.add(d);
  }
  if (involvedDomains.size > 0) {
    const entityRows = await conn
      .select({ id: entities.id, name: entities.name, website: entities.website })
      .from(entities)
      .where(isNotNull(entities.website));
    for (const e of entityRows) {
      const d = extractDomain(e.website);
      if (d && involvedDomains.has(d)) {
        const tag = await ensureCrmTag({
          userId,
          kind: "entity",
          targetId: e.id,
          displayName: e.name,
        });
        tagIdsToApply.push(tag.id);
      }
    }
  }

  // Insère thread_tags (idempotent).
  if (tagIdsToApply.length > 0) {
    await conn
      .insert(gmailThreadTags)
      .values(tagIdsToApply.map((tagId) => ({ threadId: threadIdLocal, tagId, source: "auto" })))
      .onConflictDoNothing();
  }
}

/**
 * Pousse tous les tags d'un thread vers Gmail (modifies labels). À
 * appeler après autoTagThreadByParticipants pour que les labels auto
 * apparaissent dans Gmail.
 *
 * Idempotent. Le cache labels est passé en arg pour éviter des
 * labels.list répétés sur un même run de sync.
 */
export async function pushThreadTagsToGmail(args: {
  userId: string;
  threadIdLocal: string;
  cache: LabelCache;
  accessToken: string;
}): Promise<void> {
  const conn = await db();

  // Récupère tous les tags du thread + leur gmail_label_id (ou ensure).
  const tagRows = await conn
    .select({
      tagId: gmailTags.id,
      labelName: gmailTags.labelName,
      gmailLabelId: gmailTags.gmailLabelId,
    })
    .from(gmailThreadTags)
    .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
    .where(eq(gmailThreadTags.threadId, args.threadIdLocal));
  if (tagRows.length === 0) return;

  const labelIds: string[] = [];
  for (const t of tagRows) {
    let labelId = t.gmailLabelId;
    if (!labelId) {
      labelId = await getOrCreateGmailLabel(args.accessToken, t.labelName, args.cache);
      await conn.update(gmailTags).set({ gmailLabelId: labelId }).where(eq(gmailTags.id, t.tagId));
    }
    labelIds.push(labelId);
  }

  const [thread] = await conn
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(eq(gmailThreads.id, args.threadIdLocal))
    .limit(1);
  if (!thread) return;

  try {
    await modifyThreadLabels(args.accessToken, thread.gmailThreadId, { addLabelIds: labelIds });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // 404 = thread disparu côté Gmail — ignore.
    if (!msg.includes("404") && !msg.includes("notFound")) throw err;
  }
}

// ─── Push UI → Gmail ───────────────────────────────────────────────────

/**
 * Applique un tag à un thread : insère thread_tag + push à Gmail
 * (threads.modify addLabelIds). Crée le label Gmail s'il n'existe pas.
 */
export async function applyTagToThread(args: {
  userId: string;
  threadIdLocal: string;
  tagId: string;
  source: "manual" | "auto" | "gmail";
  createdBy?: string;
}): Promise<void> {
  const conn = await db();

  // 1. Insère thread_tag (idempotent).
  await conn
    .insert(gmailThreadTags)
    .values({
      threadId: args.threadIdLocal,
      tagId: args.tagId,
      source: args.source,
      createdBy: args.createdBy ?? null,
    })
    .onConflictDoNothing();

  // 2. Push à Gmail.
  const accessToken = await getValidAccessToken(args.userId);
  if (!accessToken) return; // soft fail : le tag est en base, push différé
  const labelId = await ensureGmailLabelForTag(args.userId, args.tagId);
  const [thread] = await conn
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(eq(gmailThreads.id, args.threadIdLocal))
    .limit(1);
  if (!thread) return;
  await modifyThreadLabels(accessToken, thread.gmailThreadId, { addLabelIds: [labelId] });
}

export async function removeTagFromThread(args: {
  userId: string;
  threadIdLocal: string;
  tagId: string;
}): Promise<void> {
  const conn = await db();

  // 1. Supprime thread_tag (idempotent).
  await conn
    .delete(gmailThreadTags)
    .where(
      and(eq(gmailThreadTags.threadId, args.threadIdLocal), eq(gmailThreadTags.tagId, args.tagId)),
    );

  // 2. Push à Gmail (best-effort).
  const accessToken = await getValidAccessToken(args.userId);
  if (!accessToken) return;
  const [tag] = await conn
    .select({ gmailLabelId: gmailTags.gmailLabelId })
    .from(gmailTags)
    .where(eq(gmailTags.id, args.tagId))
    .limit(1);
  if (!tag?.gmailLabelId) return;
  const [thread] = await conn
    .select({ gmailThreadId: gmailThreads.gmailThreadId })
    .from(gmailThreads)
    .where(eq(gmailThreads.id, args.threadIdLocal))
    .limit(1);
  if (!thread) return;
  try {
    await modifyThreadLabels(accessToken, thread.gmailThreadId, {
      removeLabelIds: [tag.gmailLabelId],
    });
  } catch (err) {
    // Si Gmail dit "label introuvable", on s'en fout — déjà retiré côté Gmail.
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("404") && !msg.includes("notFound")) throw err;
  }
}

// ─── CRUD tag (catégories) ─────────────────────────────────────────────

export async function deleteTag(userId: string, tagId: string): Promise<void> {
  const conn = await db();
  const [tag] = await conn
    .select({ gmailLabelId: gmailTags.gmailLabelId })
    .from(gmailTags)
    .where(and(eq(gmailTags.id, tagId), eq(gmailTags.userId, userId)))
    .limit(1);
  if (!tag) return;

  // Supprime côté Gmail (best-effort).
  if (tag.gmailLabelId) {
    const accessToken = await getValidAccessToken(userId);
    if (accessToken) {
      try {
        await deleteLabel(accessToken, tag.gmailLabelId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("404")) throw err;
      }
    }
  }
  // Cascade supprime les thread_tags via FK.
  await conn.delete(gmailTags).where(eq(gmailTags.id, tagId));
}

export async function renameTag(args: {
  userId: string;
  tagId: string;
  newName: string;
}): Promise<void> {
  const conn = await db();
  const [tag] = await conn
    .select()
    .from(gmailTags)
    .where(and(eq(gmailTags.id, args.tagId), eq(gmailTags.userId, args.userId)))
    .limit(1);
  if (!tag) return;
  const newLabelName = buildLabelName(tag.kind, args.newName);
  if (newLabelName === tag.labelName) return;

  await conn.update(gmailTags).set({ labelName: newLabelName }).where(eq(gmailTags.id, tag.id));

  if (tag.gmailLabelId) {
    const accessToken = await getValidAccessToken(args.userId);
    if (accessToken) {
      try {
        await updateLabel(accessToken, tag.gmailLabelId, { name: newLabelName });
      } catch (err) {
        // ignore rename fail (label peut être renommé côté Gmail directement).
        console.warn("[gmail tags] rename label failed", err);
      }
    }
  }
}

// ─── Backfill ──────────────────────────────────────────────────────────

/**
 * Crée les tags Paradeos pour tous les projets/contacts/entités existants
 * et pousse les labels correspondants côté Gmail. Idempotent. À appeler
 * une fois après le déploiement (bouton "Initialiser les tags" dans
 * /settings/integrations).
 */
export async function backfillCrmTags(userId: string): Promise<{
  projectsTagged: number;
  contactsTagged: number;
  entitiesTagged: number;
  labelsCreated: number;
  errors: string[];
}> {
  const stats = {
    projectsTagged: 0,
    contactsTagged: 0,
    entitiesTagged: 0,
    labelsCreated: 0,
    errors: [] as string[],
  };
  const conn = await db();
  const accessToken = await getValidAccessToken(userId);
  if (!accessToken) {
    stats.errors.push("Pas d'access token Google.");
    return stats;
  }
  const cache = await loadGmailLabelCache(accessToken);

  // 1. Projets
  const projectRows = await conn.select({ id: projects.id, name: projects.name }).from(projects);
  for (const p of projectRows) {
    try {
      const tag = await ensureCrmTag({
        userId,
        kind: "project",
        targetId: p.id,
        displayName: p.name,
      });
      stats.projectsTagged++;
      if (!tag.gmailLabelId) {
        const labelId = await getOrCreateGmailLabel(accessToken, tag.labelName, cache);
        await conn.update(gmailTags).set({ gmailLabelId: labelId }).where(eq(gmailTags.id, tag.id));
        stats.labelsCreated++;
      }
    } catch (err) {
      stats.errors.push(`project ${p.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 2. Contacts
  const contactRows = await conn
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts);
  for (const c of contactRows) {
    try {
      const tag = await ensureCrmTag({
        userId,
        kind: "contact",
        targetId: c.id,
        displayName: `${c.firstName} ${c.lastName}`,
      });
      stats.contactsTagged++;
      if (!tag.gmailLabelId) {
        const labelId = await getOrCreateGmailLabel(accessToken, tag.labelName, cache);
        await conn.update(gmailTags).set({ gmailLabelId: labelId }).where(eq(gmailTags.id, tag.id));
        stats.labelsCreated++;
      }
    } catch (err) {
      stats.errors.push(`contact ${c.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // 3. Entités
  const entityRows = await conn.select({ id: entities.id, name: entities.name }).from(entities);
  for (const e of entityRows) {
    try {
      const tag = await ensureCrmTag({
        userId,
        kind: "entity",
        targetId: e.id,
        displayName: e.name,
      });
      stats.entitiesTagged++;
      if (!tag.gmailLabelId) {
        const labelId = await getOrCreateGmailLabel(accessToken, tag.labelName, cache);
        await conn.update(gmailTags).set({ gmailLabelId: labelId }).where(eq(gmailTags.id, tag.id));
        stats.labelsCreated++;
      }
    } catch (err) {
      stats.errors.push(`entity ${e.id}: ${err instanceof Error ? err.message : err}`);
    }
  }

  return stats;
}
