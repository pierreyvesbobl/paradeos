import "server-only";

import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projects } from "@/db/schema/projects";
import {
  fuzzyMatchContact,
  fuzzyMatchEntity,
  fuzzyMatchProject,
  fuzzyMatchTaskInProject,
  fuzzyMatchUser,
  isCertainMatch,
  isGenericProjectName,
} from "@/lib/crm/match";
import { compactNameKey, personCompactKey } from "@/lib/crm/name-key";
import { loadPendingTaskProposals, resolvePendingProposals } from "@/lib/crm/pending-proposals";
import { hasPendingProposalElsewhere, proposalDedupeKey } from "@/lib/crm/proposal-dedupe";
import { DecidedProposals } from "@/lib/crm/proposal-keys";
import { db } from "@/lib/db/server";
import { formatPersonName, sanitizeNameInput } from "@/lib/format";
import { extractMeeting, type ProjectContext } from "@/lib/meetings/extract";
import { getParticipantContext, syncParticipantsFromAttendees } from "@/lib/meetings/participants";
import { attachMeetingIfConfident } from "@/lib/meetings/project-attach";
import {
  buildCompletionProposal,
  isTaskAutocompleteEnabled,
  planTaskCompletions,
} from "@/lib/tasks/completion-proposals";
import { clearExtractedTaskSources, recordTaskSources } from "@/lib/tasks/record-sources";
import { excerptsFromPayload } from "@/lib/tasks/task-sources";
/**
 * Helper coeur du pipeline d'extraction : prend un meetingId, lit son
 * transcript, appelle le LLM, persiste les propositions (avec fuzzy
 * matching FK), met à jour le meeting (summary + status="extracted").
 *
 * Unique implémentation : l'action `extractMeetingProposals` (déclenchée
 * depuis la fiche meeting) et le cron Drive passent tous les deux ici.
 * Les deux chemins ont longtemps été deux copies divergentes, et c'est la
 * copie de l'action — sans dédup intra-extraction ni dédup des tâches —
 * qui alimentait les doublons visibles dans /inbox.
 *
 * Stratégie idempotence : on supprime les propositions encore `pending`
 * du meeting et on ré-injecte. Ce qui a été tranché (`accepted` /
 * `rejected`) reste, et une proposition équivalente à une ligne tranchée
 * n'est pas reposée : relancer une réunion déjà triée est sans risque.
 */
export async function extractAndSaveProposals(
  meetingId: string,
): Promise<{ count: number; autoCompletedTasks: number }> {
  const conn = await db();
  const [meeting] = await conn.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting) throw new Error("Meeting introuvable.");

  if (!meeting.transcript || meeting.transcript.trim().length === 0) {
    throw new Error("Transcript vide — pas d'extraction possible.");
  }

  // Si le meeting est rattaché à un projet, on file le contexte au LLM :
  // par défaut les tâches extraites pointeront sur ce projet, et les
  // contacts liés au client deviennent les assignés externes prioritaires.
  const projectContext = await loadProjectContext(meeting.projectId);

  // Les participants déjà déclarés (à la main ou par une extraction
  // précédente) partent dans le prompt : ils lèvent l'ambiguïté des
  // prénoms seuls et des « je m'en occupe ».
  const participants = await getParticipantContext(meeting.id);
  // Le titre part avec : il nomme souvent le client, le projet ou les
  // personnes là où le transcript ne dit que « on ». Et si la source a
  // déjà établi la date (horodatage du nom de fichier Drive, directive
  // dans un mail), le modèle la reprend au lieu de la recalculer.
  // Propositions de tâche en attente du même projet, mails et réunions
  // confondus : le modèle peut les clore si cette réunion les donne pour
  // faites ou sans objet.
  const pendingProposals = await loadPendingTaskProposals(conn, {
    projectId: meeting.projectId,
    excludeMeetingId: meeting.id,
  });
  let result = await extractMeeting(meeting.transcript, {
    projectContext,
    participants,
    meetingContext: { title: meeting.title, occurredAt: meeting.occurredAt },
    priorityProjectId: meeting.projectId,
    pendingProposals,
  });
  const resolvedProposals = await resolvePendingProposals(conn, result);
  result = { ...result, ...resolvedProposals };
  if (resolvedProposals.resolved > 0) {
    console.info(
      `[extract meeting ${meeting.id}] ${resolvedProposals.resolved} proposition(s) close(s) par cette réunion.`,
    );
  }

  await syncParticipantsFromAttendees(meeting.id, result.attendees);

  // Les clôtures de tâche déjà vues par cette réunion, avant le wipe : une
  // question déjà tranchée (ou déjà posée) ne se repose pas à l'identique.
  const existingCompletions = await conn
    .select({ taskId: meetingProposals.matchedId, status: meetingProposals.status })
    .from(meetingProposals)
    .where(
      and(eq(meetingProposals.meetingId, meeting.id), eq(meetingProposals.kind, "task_completion")),
    );

  // Ce que la réunion a déjà tranché, toutes natures confondues : ces
  // lignes restent, et rien d'équivalent ne sera reposé (cf. le filtre
  // avant insertion). Seules les propositions encore en attente, ou
  // périmées sans décision, sont effacées puis réinjectées.
  const decided = new DecidedProposals(
    await conn
      .select({
        kind: meetingProposals.kind,
        payload: meetingProposals.payload,
        matchedId: meetingProposals.matchedId,
        status: meetingProposals.status,
        createdEntityId: meetingProposals.createdEntityId,
      })
      .from(meetingProposals)
      .where(
        and(eq(meetingProposals.meetingId, meeting.id), ne(meetingProposals.status, "pending")),
      ),
  );
  await conn
    .delete(meetingProposals)
    .where(
      and(
        eq(meetingProposals.meetingId, meeting.id),
        inArray(meetingProposals.status, ["pending", "expired"]),
      ),
    );

  const proposalsRows: {
    meetingId: string;
    kind: "task" | "project" | "opportunity" | "contact" | "entity" | "task_completion";
    payload: unknown;
    matchedId: string | null;
    matchConfidence: string | null;
    /** Clôture appliquée d'office : la ligne naît déjà décidée. */
    status?: "pending" | "accepted";
    decidedAt?: Date | null;
    createdEntityId?: string | null;
  }[] = [];

  // Dédup intra-extraction : le LLM peut citer la même société / le même
  // contact / le même projet plusieurs fois dans un transcript. Sans ce
  // garde-fou on créerait N propositions identiques → N entités à
  // l'acceptation en masse. La clé est normalisée (accents, ponctuation,
  // forme juridique) pour que « MKP Doctor » et « mkpdoctor » comptent
  // pour une seule proposition.
  const dedupedEntities = dedupeBy(result.proposedEntities, (e) => compactNameKey(e.name));
  // Le nom est nettoyé dès l'écriture du payload : une chaîne "null"
  // ou "undefined" produite par le modèle ne doit jamais être stockée,
  // sinon elle ressort à l'affichage et finit copiée dans `contacts`.
  const cleanedContacts = result.proposedContacts.map((c) => ({
    ...c,
    firstName: sanitizeNameInput(c.firstName),
    lastName: sanitizeNameInput(c.lastName),
  }));
  const dedupedContacts = dedupeBy(cleanedContacts, (c) =>
    personCompactKey(c.firstName, c.lastName),
  );
  const dedupedProjects = dedupeBy(result.proposedProjects, (p) => compactNameKey(p.name));

  /** Propositions écartées, comptées par motif pour le log. */
  const skipped = {
    pendingElsewhere: 0,
    dupTask: 0,
    alreadyKnown: 0,
    genericName: 0,
    decidedHere: 0,
    completionDone: 0,
    completionDecided: 0,
    completionPendingElsewhere: 0,
  };

  // On mémorise les entités matchées pour scoper le match projet ensuite :
  // "GpasPlus - Nouveau X" ne doit pas être confondu avec "GpasPlus -
  // Automatisation" juste parce qu'ils partagent le préfixe entité.
  const entityMatchByName = new Map<string, string | null>();
  for (const e of dedupedEntities) {
    const match = await fuzzyMatchEntity(e.name);
    entityMatchByName.set(compactNameKey(e.name), match?.id ?? null);
    if (isCertainMatch(match)) {
      skipped.alreadyKnown++;
      continue;
    }
    if (
      await hasPendingProposalElsewhere({
        kind: "entity",
        key: proposalDedupeKey.entity(e.name),
        excludeMeetingId: meeting.id,
      })
    ) {
      skipped.pendingElsewhere++;
      continue;
    }
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "entity",
      payload: e,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  for (const c of dedupedContacts) {
    const match = await fuzzyMatchContact(c.firstName, c.lastName, { email: c.email });
    if (isCertainMatch(match)) {
      skipped.alreadyKnown++;
      continue;
    }
    if (
      await hasPendingProposalElsewhere({
        kind: "contact",
        key: proposalDedupeKey.contact(c),
        excludeMeetingId: meeting.id,
      })
    ) {
      skipped.pendingElsewhere++;
      continue;
    }
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "contact",
      payload: c,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  // Projets du transcript reconnus à coup sûr dans l'existant. S'il n'y
  // en a qu'un, c'est celui de la réunion (cf. plus bas) : la réunion se
  // rattache seule au lieu d'attendre qu'on la rattache à la main.
  const certainProjectIds = new Set<string>();
  for (const p of dedupedProjects) {
    const entityId = await resolveProposedEntityId(p.entityName, entityMatchByName);
    const scope = entityId !== undefined ? { entityId } : undefined;

    // « Projet en cours », « Suivi de projet » : le modèle n'a pas trouvé le
    // nom, il a rempli la case. Créer ça produit une fiche que personne ne
    // retrouvera. Si le client n'a qu'un seul projet, c'est de lui qu'on
    // parlait — sinon on ne propose rien du tout.
    if (isGenericProjectName(p.name, p.entityName)) {
      skipped.genericName++;
      const only = scope ? await soleProjectOfEntity(entityId ?? null) : null;
      if (only) certainProjectIds.add(only);
      continue;
    }

    const match = await fuzzyMatchProject(p.name, scope);
    if (isCertainMatch(match)) {
      skipped.alreadyKnown++;
      if (match) certainProjectIds.add(match.id);
      continue;
    }
    if (
      await hasPendingProposalElsewhere({
        kind: "project",
        key: proposalDedupeKey.project(p.name),
        excludeMeetingId: meeting.id,
      })
    ) {
      skipped.pendingElsewhere++;
      continue;
    }
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "project",
      payload: p,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }

  // Dédup des tâches : si une action proche est déjà tracée sur le projet
  // qui accueillera la tâche, on ne la re-propose pas. Le projet retenu
  // est celui que l'acceptation utilisera (projet nommé par le LLM, sinon
  // projet du meeting) — comparer sur un autre scope laissait passer les
  // doublons.
  // Ce que la réunion dit des tâches (lib/tasks/task-sources.ts) : on
  // repart de zéro pour cette réunion, les lignes `origin` posées à
  // l'acceptation d'une proposition restent.
  await clearExtractedTaskSources(conn, { meetingId: meeting.id });
  let sourcesWritten = 0;
  for (const m of result.mentionedTasks) {
    sourcesWritten += await recordTaskSources(conn, {
      taskId: m.taskId,
      source: { meetingId: meeting.id },
      // Une tâche née de cette source : ce qu'elle en dit est son origine.
      relation: decided.acceptedTaskIds.has(m.taskId) ? "origin" : "mention",
      excerpts: m.excerpts,
    });
  }
  for (const c of result.completedTasks) {
    if (!c.evidence) continue;
    sourcesWritten += await recordTaskSources(conn, {
      taskId: c.taskId,
      source: { meetingId: meeting.id },
      relation: "completion",
      excerpts: [{ quote: c.evidence, speaker: null }],
    });
  }

  const seenTaskKeys = new Set<string>();
  for (const t of result.proposedTasks) {
    const projectMatch = t.projectName ? await fuzzyMatchProject(t.projectName) : null;
    const projectId = projectMatch?.id ?? meeting.projectId ?? null;
    const assignee = await resolveTaskAssignee(t.assigneeName, t.assigneeKind);

    const taskKey = proposalDedupeKey.task(t.title, projectId);
    if (taskKey && seenTaskKeys.has(taskKey)) {
      skipped.dupTask++;
      continue;
    }
    if (taskKey) seenTaskKeys.add(taskKey);

    const dupTask = await fuzzyMatchTaskInProject(t.title, projectId, undefined, {
      // Aucun projet cible : on cherche alors dans toutes les tâches
      // ouvertes. Sans ça, une action déjà tracée sur un projet était
      // re-proposée dès que le transcript ne nommait pas ce projet.
      anyProject: projectId === null,
    });
    if (dupTask) {
      // L'action est déjà tracée : rien à proposer, mais ce que la
      // réunion en dit va sur la tâche existante, qui s'enrichit au lieu
      // de se dupliquer.
      skipped.dupTask++;
      sourcesWritten += await recordTaskSources(conn, {
        taskId: dupTask.id,
        source: { meetingId: meeting.id },
        // Si c'est cette réunion qui a fait naître la tâche, ses passages
        // sont son origine, pas une simple réévocation.
        relation: decided.acceptedTaskIds.has(dupTask.id) ? "origin" : "mention",
        excerpts: t.excerpts,
      });
      continue;
    }
    if (
      await hasPendingProposalElsewhere({
        kind: "task",
        key: taskKey,
        excludeMeetingId: meeting.id,
      })
    ) {
      skipped.pendingElsewhere++;
      continue;
    }
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "task",
      payload: {
        ...t,
        projectId,
        assigneeId: assignee.userId,
        assigneeContactId: assignee.contactId,
      },
      matchedId: null,
      matchConfidence: null,
    });
  }
  // Clôtures de tâches : la tâche doit être encore ouverte, la réunion ne
  // doit pas l'avoir déjà tranchée, aucune autre source ne doit l'avoir
  // déjà en attente.
  const completions = await planTaskCompletions(conn, result.completedTasks, {
    existing: existingCompletions,
    excludeMeetingId: meeting.id,
  });
  skipped.completionDone = completions.skipped.alreadyDone;
  skipped.completionDecided = completions.skipped.alreadyDecided;
  skipped.completionPendingElsewhere = completions.skipped.pendingElsewhere;
  const autoEnabled = completions.plans.length > 0 ? await isTaskAutocompleteEnabled() : false;
  let autoCompletedTasks = 0;
  for (const plan of completions.plans) {
    const built = await buildCompletionProposal(conn, plan, autoEnabled);
    if (built.auto) autoCompletedTasks++;
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "task_completion",
      payload: built.payload,
      matchedId: built.matchedId,
      matchConfidence: built.matchConfidence,
      status: built.status,
      decidedAt: built.decidedAt,
      createdEntityId: built.createdEntityId,
    });
  }

  // Rien d'équivalent à une proposition déjà tranchée par cette réunion :
  // un refus ne revient pas dans l'inbox, une acceptation n'est pas
  // reposée. La tâche née d'une acceptation reçoit tout de même ce que
  // cette passe en dit.
  const rowsToInsert: typeof proposalsRows = [];
  for (const row of proposalsRows) {
    const prior = decided.find(row.kind, row.payload, row.matchedId);
    if (!prior) {
      rowsToInsert.push(row);
      continue;
    }
    skipped.decidedHere++;
    if (row.kind === "task" && prior.status === "accepted" && prior.createdEntityId) {
      sourcesWritten += await recordTaskSources(conn, {
        taskId: prior.createdEntityId,
        source: { meetingId: meeting.id },
        relation: "origin",
        excerpts: excerptsFromPayload(row.payload),
      });
    }
  }

  if (sourcesWritten > 0) {
    console.info(
      `[extract meeting ${meeting.id}] ${sourcesWritten} passage(s) attaché(s) à des tâches.`,
    );
  }
  if (Object.values(skipped).some((n) => n > 0)) {
    console.info(
      `[extract meeting ${meeting.id}] propositions écartées : ${skipped.alreadyKnown} déjà en base à coup sûr, ${skipped.dupTask} tâche(s) déjà ouverte(s), ${skipped.pendingElsewhere} déjà en attente ailleurs, ${skipped.genericName} nom(s) de projet sans contenu, ${skipped.decidedHere} déjà tranchée(s) par cette réunion ; clôtures : ${skipped.completionDone} tâche(s) déjà fermée(s), ${skipped.completionDecided} déjà tranchée(s) ici, ${skipped.completionPendingElsewhere} déjà en attente ailleurs.`,
    );
  }

  if (rowsToInsert.length > 0) {
    await conn.insert(meetingProposals).values(rowsToInsert);
  }

  await conn
    .update(meetings)
    .set({
      summary: result.summary,
      occurredAt: meeting.occurredAt ?? (result.occurredAt ? new Date(result.occurredAt) : null),
      status: "extracted",
    })
    .where(eq(meetings.id, meeting.id));

  // Rattachement automatique quand les indices concordent : projet reconnu
  // à coup sûr dans le transcript, titre, projets des tâches proposées,
  // contacts des participants (cf. lib/meetings/project-attach.ts). Une
  // réunion transverse disperse ses indices et reste sans projet.
  if (meeting.projectId === null) {
    await attachMeetingIfConfident(conn, meeting.id, {
      namedProjectIds: [...certainProjectIds],
    });
  }

  return { count: proposalsRows.length, autoCompletedTasks };
}

/**
 * Id du projet d'un client **s'il n'en a qu'un**. Sert au cas du nom
 * générique : « Projet en cours » chez un client qui n'a qu'un dossier ne
 * laisse aucun doute, et deux dossiers n'en laissent que du doute.
 */
async function soleProjectOfEntity(entityId: string | null): Promise<string | null> {
  const conn = await db();
  const rows = await conn
    .select({ id: projects.id })
    .from(projects)
    .where(entityId === null ? isNull(projects.entityId) : eq(projects.entityId, entityId))
    .limit(2);
  return rows.length === 1 ? (rows[0]?.id ?? null) : null;
}

/** Garde la 1re occurrence par clé. Préserve l'ordre d'entrée. */
function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    // Clé vide = nom illisible : on ne s'en sert pas pour dédoublonner,
    // sinon deux propositions distinctes mais mal nommées fusionnent.
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * Résout l'assigné d'une tâche extraite. `assigneeKind` dit où chercher :
 * `internal` → membres de l'équipe (`users`), `external` → contacts CRM.
 * Sans indication on tente user puis contact (rétrocompat).
 */
async function resolveTaskAssignee(
  assigneeName: string | null,
  assigneeKind: "internal" | "external" | null,
): Promise<{ userId: string | null; contactId: string | null }> {
  if (!assigneeName) return { userId: null, contactId: null };

  const parts = assigneeName.trim().split(/\s+/);
  const first = parts[0] ?? assigneeName;
  const last = parts.slice(1).join(" ") || "";

  if (assigneeKind === "external") {
    const contactMatch = await fuzzyMatchContact(first, last);
    return { userId: null, contactId: contactMatch?.id ?? null };
  }
  const userMatch = await fuzzyMatchUser(assigneeName);
  if (userMatch) return { userId: userMatch.id, contactId: null };
  if (assigneeKind === "internal") return { userId: null, contactId: null };
  const contactMatch = await fuzzyMatchContact(first, last);
  return { userId: null, contactId: contactMatch?.id ?? null };
}

/** Contexte projet injecté dans le prompt quand le meeting est rattaché. */
export async function loadProjectContext(
  projectId: string | null,
): Promise<ProjectContext | undefined> {
  if (!projectId) return undefined;
  const conn = await db();
  const [proj] = await conn
    .select({
      name: projects.name,
      entityName: entities.name,
      entityId: projects.entityId,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!proj) return undefined;
  const entityContacts = proj.entityId
    ? await conn
        .select({
          firstName: contacts.firstName,
          lastName: contacts.lastName,
          jobTitle: contacts.jobTitle,
        })
        .from(contacts)
        .where(eq(contacts.entityId, proj.entityId))
    : [];
  return {
    name: proj.name,
    entityName: proj.entityName ?? null,
    contacts: entityContacts.map((c) => ({
      fullName: formatPersonName(c.firstName, c.lastName),
      jobTitle: c.jobTitle ?? null,
    })),
  };
}

/**
 * Résout l'entité d'un projet proposé pour scoper le fuzzy match.
 * Retour :
 *  - `string` (entityId) si l'entité résout à un existant → scope strict
 *  - `null` si le LLM déclare un projet sans entité → scope internes
 *  - `undefined` si l'entité est un nouvel objet non encore en base → pas
 *    de scope (le projet est peut-être nouveau aussi, on laisse le seuil
 *    global filtrer)
 */
async function resolveProposedEntityId(
  entityName: string | null,
  entityMatchByName: Map<string, string | null>,
): Promise<string | null | undefined> {
  if (entityName === null) return null;
  const key = compactNameKey(entityName);
  if (entityMatchByName.has(key)) {
    const cached = entityMatchByName.get(key);
    return cached === null ? undefined : cached;
  }
  const match = await fuzzyMatchEntity(entityName);
  return match?.id ?? undefined;
}
