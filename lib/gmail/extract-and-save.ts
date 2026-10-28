import "server-only";

import { and, eq, inArray, ne } from "drizzle-orm";
import { entities } from "@/db/schema/entities";
import { emailProposals, gmailMessages, gmailTags } from "@/db/schema/gmail";
import { projectContacts } from "@/db/schema/project-contacts";
import { projects } from "@/db/schema/projects";
import {
  fuzzyMatchContact,
  fuzzyMatchEntity,
  fuzzyMatchProject,
  fuzzyMatchTaskInProject,
  isCertainMatch,
  isGenericProjectName,
} from "@/lib/crm/match";
import { compactNameKey } from "@/lib/crm/name-key";
import { hasPendingProposalElsewhere, proposalDedupeKey } from "@/lib/crm/proposal-dedupe";
import { DecidedProposals } from "@/lib/crm/proposal-keys";
import { db } from "@/lib/db/server";
import { sanitizeNameInput } from "@/lib/format";
import { isAutomatedSender } from "@/lib/gmail/automated-sender";
import { extractEmail } from "@/lib/gmail/extract";
import { computeThreadLinkSignals, linkThread } from "@/lib/gmail/links";
import { getProjectsForThreads } from "@/lib/gmail/queries";
import {
  buildCompletionProposal,
  isTaskAutocompleteEnabled,
  planTaskCompletions,
} from "@/lib/tasks/completion-proposals";
import { clearExtractedTaskSources, recordTaskSources } from "@/lib/tasks/record-sources";
import { excerptsFromPayload } from "@/lib/tasks/task-sources";

type ProposalKind =
  | "task"
  | "project_link"
  | "entity_link"
  | "project_contact_link"
  | "contact"
  | "entity"
  | "project"
  | "draft_reply"
  | "task_completion";

/**
 * Au-delà, une proposition de rattachement sans projet nommé dans le mail
 * ne se tranche jamais : le fil se rattache à la main depuis sa page.
 */
const MAX_PROJECT_LINK_CANDIDATES = 5;

type ProposalRow = {
  messageId: string;
  kind: ProposalKind;
  payload: Record<string, unknown>;
  matchedId: string | null;
  matchConfidence: string | null;
  /** Clôture appliquée d'office : la ligne naît déjà décidée. */
  status?: "pending" | "accepted";
  decidedAt?: Date | null;
  createdEntityId?: string | null;
};

/**
 * Pipeline d'extraction email : lit le message, appelle LLM, persiste
 * les propositions. Idempotent : les propositions encore `pending` du
 * message sont effacées puis réinjectées ; celles déjà tranchées restent et
 * rien d'équivalent n'est reposé (relancer un mail déjà trié est sans risque).
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
  /** Tâches passées en done sans clic (réglage TASK_AUTOCOMPLETE_ENABLED). */
  autoCompletedTasks: number;
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
    return {
      count: 0,
      autoAppliedProjectLinks: 0,
      autoCompletedTasks: 0,
      skipped: true,
      reason: "message introuvable",
    };

  // On a besoin d'un body pour extraire — un message en `skipped` n'a
  // pas de body stocké.
  if (!msg.bodyText && !msg.bodyHtml) {
    await conn
      .update(gmailMessages)
      .set({ extractionStatus: "failed" })
      .where(eq(gmailMessages.id, messageId));
    return {
      count: 0,
      autoAppliedProjectLinks: 0,
      autoCompletedTasks: 0,
      skipped: true,
      reason: "pas de body",
    };
  }

  // Un expéditeur machine (reçu, alerte, notes automatiques) ne porte rien
  // à proposer au CRM : pas d'appel LLM, le message est marqué `skipped`.
  // Le classement des factures, lui, a déjà lu ses pièces jointes.
  if (isAutomatedSender(msg)) {
    await conn
      .update(gmailMessages)
      .set({ extractionStatus: "skipped" })
      .where(eq(gmailMessages.id, messageId));
    return {
      count: 0,
      autoAppliedProjectLinks: 0,
      autoCompletedTasks: 0,
      skipped: true,
      reason: "expéditeur automatique",
    };
  }

  // Signaux de liaison du fil, calculés avant l'appel LLM : le projet du
  // fil (lié, ou seul candidat par contacts/entité) fait remonter ses
  // tâches ouvertes en tête du vocabulaire.
  const signals = await computeThreadLinkSignals(msg.threadId);
  const linkedProjects = (await getProjectsForThreads([msg.threadId])).get(msg.threadId) ?? [];
  const priorityProjectId =
    linkedProjects.length === 1
      ? (linkedProjects[0]?.id ?? null)
      : signals?.candidateProjectIds.length === 1
        ? (signals.candidateProjectIds[0] ?? null)
        : null;

  let result: Awaited<ReturnType<typeof extractEmail>>;
  try {
    result = await extractEmail(
      {
        subject: msg.subject,
        fromEmail: msg.fromEmail,
        fromName: msg.fromName,
        toEmails: msg.toEmails,
        ccEmails: msg.ccEmails,
        bodyText: msg.bodyText,
        bodyHtml: msg.bodyHtml,
      },
      { priorityProjectId },
    );
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
    return {
      count: 0,
      autoAppliedProjectLinks: 0,
      autoCompletedTasks: 0,
      skipped: true,
      reason: "sensitive detected",
    };
  }

  // Les clôtures de tâche déjà vues par ce message, avant le wipe : une
  // question déjà tranchée (ou déjà posée) ne se repose pas à l'identique.
  const existingCompletions = await conn
    .select({ taskId: emailProposals.matchedId, status: emailProposals.status })
    .from(emailProposals)
    .where(
      and(eq(emailProposals.messageId, messageId), eq(emailProposals.kind, "task_completion")),
    );

  // Ce que le message a déjà tranché, toutes natures confondues : ces
  // lignes restent, et rien d'équivalent ne sera reposé (cf. le filtre
  // avant insertion). Seules les propositions encore en attente, ou
  // périmées sans décision, sont effacées puis réinjectées.
  const decided = new DecidedProposals(
    await conn
      .select({
        kind: emailProposals.kind,
        payload: emailProposals.payload,
        matchedId: emailProposals.matchedId,
        status: emailProposals.status,
        createdEntityId: emailProposals.createdEntityId,
      })
      .from(emailProposals)
      .where(and(eq(emailProposals.messageId, messageId), ne(emailProposals.status, "pending"))),
  );
  await conn
    .delete(emailProposals)
    .where(
      and(
        eq(emailProposals.messageId, messageId),
        inArray(emailProposals.status, ["pending", "expired"]),
      ),
    );

  const rows: ProposalRow[] = [];

  // 1. Tâches — trois filtres avant de proposer : doublon dans la même
  //    extraction, tâche équivalente déjà ouverte en base, proposition
  //    équivalente déjà en attente sur un autre message ou une réunion.
  const skipped = {
    pendingElsewhere: 0,
    dupTask: 0,
    alreadyKnown: 0,
    decidedHere: 0,
    completionDone: 0,
    completionDecided: 0,
    completionPendingElsewhere: 0,
    tooManyCandidates: 0,
  };
  // Ce que le mail dit des tâches (lib/tasks/task-sources.ts) : on repart
  // de zéro pour ce message, les lignes `origin` posées à l'acceptation
  // d'une proposition restent.
  await clearExtractedTaskSources(conn, { messageId });
  let sourcesWritten = 0;
  for (const m of result.mentionedTasks) {
    sourcesWritten += await recordTaskSources(conn, {
      taskId: m.taskId,
      source: { messageId },
      // Une tâche née de cette source : ce qu'elle en dit est son origine.
      relation: decided.acceptedTaskIds.has(m.taskId) ? "origin" : "mention",
      excerpts: m.excerpts,
    });
  }
  for (const c of result.completedTasks) {
    if (!c.evidence) continue;
    sourcesWritten += await recordTaskSources(conn, {
      taskId: c.taskId,
      source: { messageId },
      relation: "completion",
      excerpts: [{ quote: c.evidence, speaker: msg.fromName ?? msg.fromEmail ?? null }],
    });
  }

  const seenTaskKeys = new Set<string>();
  for (const t of result.proposedTasks) {
    const projectMatch = t.projectName ? await fuzzyMatchProject(t.projectName) : null;
    const taskProjectId = projectMatch?.id ?? null;

    const taskKey = proposalDedupeKey.task(t.title, taskProjectId);
    if (taskKey && seenTaskKeys.has(taskKey)) {
      skipped.dupTask++;
      continue;
    }
    if (taskKey) seenTaskKeys.add(taskKey);

    const dupTask = await fuzzyMatchTaskInProject(t.title, taskProjectId, undefined, {
      // Sans projet cible, on compare à toutes les tâches ouvertes : un
      // mail qui ne nomme pas le projet re-proposait sinon une action
      // déjà tracée.
      anyProject: taskProjectId === null,
    });
    if (dupTask) {
      // L'action est déjà tracée : ce que le mail en dit va sur la tâche
      // existante au lieu d'être perdu avec la proposition écartée.
      skipped.dupTask++;
      sourcesWritten += await recordTaskSources(conn, {
        taskId: dupTask.id,
        source: { messageId },
        // Si c'est ce mail qui a fait naître la tâche, ses passages sont
        // son origine, pas une simple réévocation.
        relation: decided.acceptedTaskIds.has(dupTask.id) ? "origin" : "mention",
        excerpts: t.excerpts,
      });
      continue;
    }
    if (
      await hasPendingProposalElsewhere({
        kind: "task",
        key: taskKey,
        excludeMessageId: messageId,
      })
    ) {
      skipped.pendingElsewhere++;
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
        projectId: taskProjectId,
        assigneeName: t.assigneeName,
        kind: t.kind,
        excerpts: t.excerpts,
      },
      matchedId: null,
      matchConfidence: null,
    });
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

    // Liaison posée sans proposition quand le projet est sûr : un seul
    // candidat, ou bien le projet que le mail nomme en toutes lettres est
    // aussi l'un de ceux que les participants désignent (deux signaux
    // indépendants d'accord). Une liaison se défait en un clic depuis le
    // fil ; une proposition parmi vingt candidats ne se tranchait jamais.
    const doubleSignalProjectId =
      llmProjectMatch &&
      isCertainMatch(llmProjectMatch) &&
      (signals?.candidateProjectIds ?? []).includes(llmProjectMatch.id)
        ? llmProjectMatch.id
        : null;
    const sureProjectId =
      candidateList.length === 1 ? (candidateList[0] ?? null) : doubleSignalProjectId;
    if (sureProjectId) {
      const projectId = sureProjectId;
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
    } else if (!llmProjectMatch && candidateList.length > MAX_PROJECT_LINK_CANDIDATES) {
      // Le mail ne nomme aucun projet et les participants en désignent
      // trop (un contact actif sur vingt projets) : personne ne choisit
      // dans une telle liste.
      skipped.tooManyCandidates++;
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
    entityMatchByName.set(compactNameKey(name), match?.id ?? null);
    if (isCertainMatch(match)) {
      skipped.alreadyKnown++;
      continue;
    }
    if (
      await hasPendingProposalElsewhere({
        kind: "entity",
        key: proposalDedupeKey.entity(name),
        excludeMessageId: messageId,
      })
    ) {
      skipped.pendingElsewhere++;
      continue;
    }
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
    const match = await fuzzyMatchContact(firstName, lastName, { email });
    // Contact déjà en base avec preuve forte (email identique, ou nom
    // strictement équivalent) : rien à proposer du tout, on n'encombre pas
    // la file avec une ligne « déjà en base ».
    if (isCertainMatch(match)) {
      skipped.alreadyKnown++;
      continue;
    }
    if (
      await hasPendingProposalElsewhere({
        kind: "contact",
        key: proposalDedupeKey.contact({ firstName, lastName, email }),
        excludeMessageId: messageId,
      })
    ) {
      skipped.pendingElsewhere++;
      continue;
    }
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
    // Même garde-fou que côté réunion : un nom de remplissage ne crée rien.
    if (isGenericProjectName(name, p.entityName)) {
      skipped.alreadyKnown++;
      continue;
    }
    const entityId = await resolveProjectEntityIdForMatch(
      p.entityName,
      entityMatchByName,
      signals?.matchedEntityIds ?? [],
    );
    const match = await fuzzyMatchProject(name, entityId !== undefined ? { entityId } : undefined);
    if (match && match.id === autoLinkedProjectId) continue;
    if (isCertainMatch(match)) {
      skipped.alreadyKnown++;
      continue;
    }
    if (
      await hasPendingProposalElsewhere({
        kind: "project",
        key: proposalDedupeKey.project(name),
        excludeMessageId: messageId,
      })
    ) {
      skipped.pendingElsewhere++;
      continue;
    }
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

  // 7. Plus de brouillon de réponse généré d'office : quarante-trois
  //    attendaient sans qu'aucun ne soit jamais tranché. `needsReply`
  //    reste porté par le message (badge « Réponse attendue »).

  // 1b. Clôtures de tâches : la tâche doit être encore ouverte, ce message
  //     ne doit pas l'avoir déjà tranchée, aucune autre source ne doit
  //     l'avoir déjà en attente.
  const completions = await planTaskCompletions(conn, result.completedTasks, {
    existing: existingCompletions,
    excludeMessageId: messageId,
  });
  skipped.completionDone = completions.skipped.alreadyDone;
  skipped.completionDecided = completions.skipped.alreadyDecided;
  skipped.completionPendingElsewhere = completions.skipped.pendingElsewhere;
  const autoEnabled = completions.plans.length > 0 ? await isTaskAutocompleteEnabled() : false;
  let autoCompletedTasks = 0;
  for (const plan of completions.plans) {
    const built = await buildCompletionProposal(conn, plan, autoEnabled);
    if (built.auto) autoCompletedTasks++;
    rows.push({
      messageId,
      kind: "task_completion",
      payload: built.payload,
      matchedId: built.matchedId,
      matchConfidence: built.matchConfidence,
      status: built.status,
      decidedAt: built.decidedAt,
      createdEntityId: built.createdEntityId,
    });
  }

  // Rien d'équivalent à une proposition déjà tranchée sur ce message : un
  // refus ne revient pas dans l'inbox, une acceptation n'est pas reposée.
  // La tâche née d'une acceptation reçoit tout de même ce que cette passe
  // en dit.
  const rowsToInsert: ProposalRow[] = [];
  for (const row of rows) {
    const prior = decided.find(row.kind, row.payload, row.matchedId);
    if (!prior) {
      rowsToInsert.push(row);
      continue;
    }
    skipped.decidedHere++;
    if (row.kind === "task" && prior.status === "accepted" && prior.createdEntityId) {
      sourcesWritten += await recordTaskSources(conn, {
        taskId: prior.createdEntityId,
        source: { messageId },
        relation: "origin",
        excerpts: excerptsFromPayload(row.payload),
      });
    }
  }

  if (sourcesWritten > 0) {
    console.info(
      `[extract email ${messageId}] ${sourcesWritten} passage(s) attaché(s) à des tâches.`,
    );
  }
  if (Object.values(skipped).some((n) => n > 0)) {
    console.info(
      `[extract email ${messageId}] propositions écartées : ${skipped.alreadyKnown} déjà en base à coup sûr, ${skipped.dupTask} tâche(s) déjà ouverte(s), ${skipped.pendingElsewhere} déjà en attente ailleurs, ${skipped.decidedHere} déjà tranchée(s) sur ce message, ${skipped.tooManyCandidates} rattachement(s) sans projet nommé parmi trop de candidats ; clôtures : ${skipped.completionDone} tâche(s) déjà fermée(s), ${skipped.completionDecided} déjà tranchée(s) ici, ${skipped.completionPendingElsewhere} déjà en attente ailleurs.`,
    );
  }

  if (rowsToInsert.length > 0) {
    await conn.insert(emailProposals).values(rowsToInsert);
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

  return { count: rows.length, autoAppliedProjectLinks, autoCompletedTasks, skipped: false };
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
    const key = compactNameKey(entityName);
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
