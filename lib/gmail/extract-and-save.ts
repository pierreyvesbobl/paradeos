import "server-only";

import { entities } from "@/db/schema/entities";
import { emailProposals, gmailMessages, gmailTags, gmailThreads } from "@/db/schema/gmail";
import { projectContacts } from "@/db/schema/project-contacts";
import { projects } from "@/db/schema/projects";
import { findContactByEmail } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/server";
import { extractEmail } from "@/lib/gmail/extract";
import { computeThreadLinkSignals, linkThread } from "@/lib/gmail/links";
import {
  fuzzyMatchContact,
  fuzzyMatchEntity,
  fuzzyMatchProject,
  fuzzyMatchTaskInProject,
} from "@/lib/meetings/extract";
import { and, eq, inArray } from "drizzle-orm";

import { sanitizeNameInput } from "@/lib/format";
type ProposalKind =
  | "task"
  | "project_link"
  | "entity_link"
  | "project_contact_link"
  | "contact"
  | "entity"
  | "project"
  | "draft_reply";

type ProposalRow = {
  messageId: string;
  kind: ProposalKind;
  payload: Record<string, unknown>;
  matchedId: string | null;
  matchConfidence: string | null;
};

/**
 * Pipeline d'extraction email : lit le message, appelle LLM, persiste
 * les propositions. Idempotent : delete + insert.
 *
 * Statut du message :
 *   - `pending` → on tente l'extraction
 *   - succès → `extracted`
 *   - échec  → `failed` + dougs_status laissé tel quel
 */
export async function extractAndSaveEmailProposals(messageId: string): Promise<{
  count: number;
  /** Liaisons projet posées directement (sans proposition à valider). */
  autoAppliedProjectLinks: number;
  skipped: boolean;
  reason?: string;
}> {
  const conn = await db();
  const [msg] = await conn
    .select()
    .from(gmailMessages)
    .where(eq(gmailMessages.id, messageId))
    .limit(1);
  if (!msg)
    return { count: 0, autoAppliedProjectLinks: 0, skipped: true, reason: "message introuvable" };

  // On a besoin d'un body pour extraire — un message en `skipped` n'a
  // pas de body stocké.
  if (!msg.bodyText && !msg.bodyHtml) {
    await conn
      .update(gmailMessages)
      .set({ extractionStatus: "failed" })
      .where(eq(gmailMessages.id, messageId));
    return { count: 0, autoAppliedProjectLinks: 0, skipped: true, reason: "pas de body" };
  }

  let result: Awaited<ReturnType<typeof extractEmail>>;
  try {
    result = await extractEmail({
      subject: msg.subject,
      fromEmail: msg.fromEmail,
      fromName: msg.fromName,
      toEmails: msg.toEmails,
      ccEmails: msg.ccEmails,
      bodyText: msg.bodyText,
      bodyHtml: msg.bodyHtml,
    });
  } catch (err) {
    await conn
      .update(gmailMessages)
      .set({ extractionStatus: "failed" })
      .where(eq(gmailMessages.id, messageId));
    throw err;
  }

  // Si du sensitive a fui malgré le sanitize, on ne persiste rien et
  // on log juste — éviter la propagation de secrets en proposition.
  if (result.sensitiveDetected) {
    await conn
      .update(gmailMessages)
      .set({ extractionStatus: "failed" })
      .where(eq(gmailMessages.id, messageId));
    return { count: 0, autoAppliedProjectLinks: 0, skipped: true, reason: "sensitive detected" };
  }

  // Wipe les anciennes propositions du message + ré-injecte.
  await conn.delete(emailProposals).where(eq(emailProposals.messageId, messageId));

  const rows: ProposalRow[] = [];

  // 1. Tâches — avec dédup contre les tâches déjà en base sur le projet
  //    matché. Évite de re-suggérer une action déjà tracée (l'utilisateur
  //    l'a peut-être déjà créée à partir d'un mail précédent).
  const TASK_DEDUP_THRESHOLD = 0.5;
  let skippedDupTasks = 0;
  for (const t of result.proposedTasks) {
    const projectMatch = t.projectName ? await fuzzyMatchProject(t.projectName) : null;
    const dupTask = await fuzzyMatchTaskInProject(
      t.title,
      projectMatch?.id ?? null,
      TASK_DEDUP_THRESHOLD,
    );
    if (dupTask) {
      skippedDupTasks++;
      continue;
    }
    rows.push({
      messageId,
      kind: "task",
      payload: {
        title: t.title,
        dueDate: t.dueDate,
        priority: t.priority,
        projectName: t.projectName,
        projectId: projectMatch?.id ?? null,
        assigneeName: t.assigneeName,
      },
      matchedId: null,
      matchConfidence: null,
    });
  }
  if (skippedDupTasks > 0) {
    console.info(
      `[extract email ${messageId}] ${skippedDupTasks} tâche(s) LLM ignorée(s) : déjà en base sur le projet.`,
    );
  }

  // 2. Rattachement projet — signaux combinés :
  //    - candidateProjectIds : projets actifs matchés par contact ∪ entité (calc côté links.ts)
  //    - LLM proposedProjectName : projet mentionné explicitement dans le contenu
  // Décision :
  //    - projectDimensionLocked → skip (l'humain a tranché, dans un sens
  //      ou dans l'autre)
  //    - 1 seul candidat clair (LLM match + 0 candidats côté serveur, ou 1 seul candidat = LLM match)
  //      → liaison posée directement
  //    - N candidats ambigus → proposition project_link à valider avec candidateProjectIds[]
  let autoAppliedProjectLinks = 0;
  let autoLinkedProjectId: string | null = null;
  const signals = await computeThreadLinkSignals(msg.threadId);
  const candidateProjectIds = new Set<string>(signals?.candidateProjectIds ?? []);
  // Scope le match par l'entité du thread si elle est univoque : évite de
  // rattacher "GpasPlus - Nouveau X" à "GpasPlus - Autre Y" sur le seul
  // préfixe de nom.
  const threadEntityId =
    signals?.matchedEntityIds.length === 1 ? signals.matchedEntityIds[0] : undefined;
  const llmProjectMatch = result.proposedProjectName
    ? await fuzzyMatchProject(
        result.proposedProjectName,
        threadEntityId !== undefined ? { entityId: threadEntityId } : undefined,
      )
    : null;
  if (llmProjectMatch) candidateProjectIds.add(llmProjectMatch.id);
  const candidateList = [...candidateProjectIds];

  if (!signals?.projectDimensionLocked && candidateList.length > 0) {
    // Récupère les infos des candidats pour le payload (nom lisible côté UI).
    const projectRows = await conn
      .select({ id: projects.id, name: projects.name, status: projects.status })
      .from(projects)
      .where(inArray(projects.id, candidateList));
    const candidatesPayload = projectRows.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      llmMatched: llmProjectMatch?.id === p.id,
    }));

    // Cas trivial : 1 seul candidat clair → liaison posée si le libellé projet existe déjà.
    if (candidateList.length === 1 && candidateList[0]) {
      const projectId = candidateList[0];
      autoLinkedProjectId = projectId;
      const [projectLabel] = await conn
        .select({ id: gmailTags.id })
        .from(gmailTags)
        .where(
          and(
            eq(gmailTags.userId, msg.userId),
            eq(gmailTags.kind, "project"),
            eq(gmailTags.targetId, projectId),
          ),
        )
        .limit(1);
      if (projectLabel) {
        try {
          await linkThread({
            userId: msg.userId,
            threadIdLocal: msg.threadId,
            labelId: projectLabel.id,
            source: "auto",
          });
          autoAppliedProjectLinks++;
        } catch {
          // Push Gmail peut échouer (token/quota) — la liaison reste posée.
        }
      }
    } else {
      // N candidats → proposition à valider.
      // suggested = LLM match si présent, sinon premier candidat (le user pourra changer).
      // Fallback vide impossible : le branche else n'est atteinte qu'avec candidateList.length >= 2.
      const suggested = llmProjectMatch?.id ?? candidateList[0] ?? "";
      const suggestedRow = projectRows.find((p) => p.id === suggested);
      rows.push({
        messageId,
        kind: "project_link",
        payload: {
          candidates: candidatesPayload,
          suggestedProjectId: suggested,
          suggestedProjectName: suggestedRow?.name ?? null,
          llmMentionedName: result.proposedProjectName ?? null,
        },
        matchedId: suggested,
        matchConfidence: llmProjectMatch ? llmProjectMatch.confidence.toFixed(3) : null,
      });
    }
  }

  // 2b. entity_link : entités matchées par domaine — sync a déjà auto-appliqué
  // le tag entité, mais si N entités matchent un même domaine (rare mais
  // possible), on émet une proposition pour laisser l'humain trancher.
  if (signals && signals.matchedEntityIds.length > 1) {
    const entityRows = await conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(inArray(entities.id, signals.matchedEntityIds));
    const candidatesPayload = entityRows.map((e) => ({ id: e.id, name: e.name }));
    rows.push({
      messageId,
      kind: "entity_link",
      payload: {
        candidates: candidatesPayload,
        suggestedEntityId: entityRows[0]?.id ?? null,
      },
      matchedId: entityRows[0]?.id ?? null,
      matchConfidence: null,
    });
  }

  // 2c. project_contact_link : pour chaque contact CRM matché du thread
  // qui n'est pas rattaché à un des projets candidats, propose le
  // rattachement. Rend visible le trou "contact connu mais absent de
  // project_contacts" qui est la cause #1 des projets vides.
  if (
    signals &&
    signals.matchedContactIds.length > 0 &&
    candidateList.length > 0 &&
    !signals.projectDimensionLocked
  ) {
    const existingLinks = await conn
      .select({
        contactId: projectContacts.contactId,
        projectId: projectContacts.projectId,
      })
      .from(projectContacts)
      .where(
        and(
          inArray(projectContacts.contactId, signals.matchedContactIds),
          inArray(projectContacts.projectId, candidateList),
        ),
      );
    const linkedPairs = new Set(existingLinks.map((l) => `${l.contactId}:${l.projectId}`));
    // Ne proposer que sur le projet suggéré (celui que l'user va accepter en priorité)
    // pour éviter d'exploser la file de propositions.
    // candidateList.length > 0 (garanti par le if outer) → [0] est défini.
    const targetProjectId = llmProjectMatch?.id ?? (candidateList[0] as string);
    for (const contactId of signals.matchedContactIds) {
      if (linkedPairs.has(`${contactId}:${targetProjectId}`)) continue;
      rows.push({
        messageId,
        kind: "project_contact_link",
        payload: {
          contactId,
          projectId: targetProjectId,
        },
        matchedId: contactId,
        matchConfidence: null,
      });
    }
  }

  // 4. Entités proposées (nouvelles) — fuzzy match côté serveur en
  // défense en profondeur, même si le LLM est consigné de ne pas
  // re-proposer ce qui est dans le vocabulaire.
  //
  // On mémorise les correspondances pour scoper le match projet (étape 6)
  // et éviter le faux positif "MêmeClient - Nouveau X" ↔ "MêmeClient -
  // Ancien Y" sur le seul préfixe entité.
  const entityMatchByName = new Map<string, string | null>();
  for (const e of result.proposedEntities) {
    const name = e.name.trim();
    if (!name) continue;
    const match = await fuzzyMatchEntity(name);
    entityMatchByName.set(name.toLowerCase(), match?.id ?? null);
    rows.push({
      messageId,
      kind: "entity",
      payload: { name, kind: e.kind },
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }

  // 5. Contacts proposés (nouveaux). Pour chaque contact :
  //   - Si email fourni → lookup exact. Si match, SKIP (contact connu).
  //   - Sinon fuzzy match par nom (comme meetings).
  // Le match exact par email court-circuite la proposition : c'est plus
  // précis et évite de polluer la file de propositions avec des contacts
  // qu'on a déjà.
  for (const c of result.proposedContacts) {
    const firstName = sanitizeNameInput(c.firstName);
    const lastName = sanitizeNameInput(c.lastName);
    if (!firstName && !lastName) continue;
    const email = c.email?.trim() ?? null;
    if (email) {
      const exact = await findContactByEmail(email);
      if (exact) continue; // contact déjà connu, rien à proposer
    }
    const match = firstName || lastName ? await fuzzyMatchContact(firstName, lastName) : null;
    rows.push({
      messageId,
      kind: "contact",
      payload: {
        firstName,
        lastName,
        email,
        jobTitle: c.jobTitle,
        entityName: c.entityName,
      },
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }

  // 6. Projets proposés (nouveaux). Garde-fou : si le projet correspond
  // à celui déjà auto-lié via `proposedProjectName` plus haut, on ne le
  // propose pas une seconde fois (double signal LLM).
  for (const p of result.proposedProjects) {
    const name = p.name.trim();
    if (!name) continue;
    const entityId = await resolveProjectEntityIdForMatch(
      p.entityName,
      entityMatchByName,
      signals?.matchedEntityIds ?? [],
    );
    const match = await fuzzyMatchProject(name, entityId !== undefined ? { entityId } : undefined);
    if (match && match.id === autoLinkedProjectId) continue;
    rows.push({
      messageId,
      kind: "project",
      payload: {
        name,
        kind: p.kind,
        entityName: p.entityName,
        status: p.status,
        valueAmount: p.valueAmount,
        // Le pipelineStage global vient influencer l'UI du panneau
        // d'extraction ; il est aussi remonté au niveau du message
        // via extractionMeta plus bas.
        pipelineStage: result.pipelineStage,
      },
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }

  // 7. Brouillon de réponse — seulement si le LLM a détecté un besoin
  //    d'action et fourni un draft. Le push vers Gmail se fait à
  //    l'acceptation (cf. acceptEmailProposal).
  if (result.needsReply && result.replyDraft) {
    const [thread] = await conn
      .select({ gmailThreadId: gmailThreads.gmailThreadId })
      .from(gmailThreads)
      .where(eq(gmailThreads.id, msg.threadId))
      .limit(1);
    rows.push({
      messageId,
      kind: "draft_reply",
      payload: {
        subject: result.replyDraft.subject,
        body: result.replyDraft.body,
        gmailThreadId: thread?.gmailThreadId ?? null,
        gmailMessageId: msg.gmailMessageId,
      },
      matchedId: null,
      matchConfidence: null,
    });
  }

  if (rows.length > 0) {
    await conn.insert(emailProposals).values(rows);
  }

  // Met à jour extractionMeta (summary + intent + stage + needsReply)
  // au niveau du message pour que la vue thread puisse l'afficher
  // sans avoir à re-parcourir les propositions.
  await conn
    .update(gmailMessages)
    .set({
      extractionStatus: "extracted",
      extractionMeta: {
        summary: result.summary,
        intent: result.intent,
        pipelineStage: result.pipelineStage,
        needsReply: result.needsReply,
      },
    })
    .where(eq(gmailMessages.id, messageId));

  return { count: rows.length, autoAppliedProjectLinks, skipped: false };
}

/**
 * Résout l'entité cible d'un projet proposé pour scoper le fuzzy match.
 * Ordre de priorité :
 *   1. Le LLM a nommé une entité → on cherche l'id (via la mémoire d'étape
 *      4, puis fuzzyMatch en fallback).
 *   2. Sinon, si le thread matche EXACTEMENT une entité côté domaine → on
 *      utilise ce contexte.
 * Sinon : `undefined` (pas de scope). Le seuil global 0.55 filtre.
 */
async function resolveProjectEntityIdForMatch(
  entityName: string | null,
  entityMatchByName: Map<string, string | null>,
  matchedEntityIdsFromThread: string[],
): Promise<string | null | undefined> {
  if (entityName) {
    const key = entityName.trim().toLowerCase();
    if (entityMatchByName.has(key)) {
      const cached = entityMatchByName.get(key);
      if (cached !== null && cached !== undefined) return cached;
      // cached === null → entité déclarée nouvelle par le LLM → pas de scope
      return undefined;
    }
    const match = await fuzzyMatchEntity(entityName);
    if (match) return match.id;
    return undefined;
  }
  if (matchedEntityIdsFromThread.length === 1) {
    return matchedEntityIdsFromThread[0];
  }
  return undefined;
}
