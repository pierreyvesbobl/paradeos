import "server-only";

import { meetingProposals, meetings } from "@/db/schema/meetings";
import { db } from "@/lib/db/server";
import {
  extractMeeting,
  fuzzyMatchContact,
  fuzzyMatchEntity,
  fuzzyMatchProject,
  fuzzyMatchTaskInProject,
  fuzzyMatchUser,
} from "@/lib/meetings/extract";
import { eq } from "drizzle-orm";

import { formatPersonName, sanitizeNameInput } from "@/lib/format";
/**
 * Helper coeur du pipeline d'extraction : prend un meetingId, lit son
 * transcript, appelle le LLM, persiste les propositions (avec fuzzy
 * matching FK), met à jour le meeting (summary + status="extracted").
 *
 * Extrait de l'action `extractMeetingProposals` pour pouvoir être
 * appelé sans contexte user (cron Drive sync).
 *
 * Stratégie idempotence : on supprime les propositions précédentes
 * du meeting et on ré-injecte. Si tu veux préserver les `accepted`/
 * `rejected`, ne re-extrait pas un meeting déjà traité.
 */
export async function extractAndSaveProposals(meetingId: string): Promise<{ count: number }> {
  const conn = await db();
  const [meeting] = await conn.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
  if (!meeting) throw new Error("Meeting introuvable.");

  if (!meeting.transcript || meeting.transcript.trim().length === 0) {
    throw new Error("Transcript vide — pas d'extraction possible.");
  }
  const result = await extractMeeting(meeting.transcript);

  await conn.delete(meetingProposals).where(eq(meetingProposals.meetingId, meeting.id));

  const proposalsRows: {
    meetingId: string;
    kind: "task" | "project" | "opportunity" | "contact" | "entity";
    payload: unknown;
    matchedId: string | null;
    matchConfidence: string | null;
  }[] = [];

  // Dédup intra-extraction : le LLM peut citer la même société / le même
  // contact / le même projet plusieurs fois dans un transcript. Sans ce
  // garde-fou on créerait N propositions identiques → N entités à
  // l'acceptation en masse. On garde la 1re occurrence par nom normalisé.
  const norm = (s: string) => s.trim().toLowerCase();
  const dedupedEntities = dedupeBy(result.proposedEntities, (e) => norm(e.name));
  // Le nom est nettoyé dès l'écriture du payload : une chaîne "null"
  // ou "undefined" produite par le modèle ne doit jamais être stockée,
  // sinon elle ressort à l'affichage et finit copiée dans `contacts`.
  const cleanedContacts = result.proposedContacts.map((c) => ({
    ...c,
    firstName: sanitizeNameInput(c.firstName),
    lastName: sanitizeNameInput(c.lastName),
  }));
  const dedupedContacts = dedupeBy(cleanedContacts, (c) =>
    norm(formatPersonName(c.firstName, c.lastName, "")),
  );
  const dedupedProjects = dedupeBy(result.proposedProjects, (p) => norm(p.name));

  // On mémorise les entités matchées pour scoper le match projet ensuite :
  // "GpasPlus - Nouveau X" ne doit pas être confondu avec "GpasPlus -
  // Automatisation" juste parce qu'ils partagent le préfixe entité.
  const entityMatchByName = new Map<string, string | null>();
  for (const e of dedupedEntities) {
    const match = await fuzzyMatchEntity(e.name);
    entityMatchByName.set(norm(e.name), match?.id ?? null);
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "entity",
      payload: e,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  for (const c of dedupedContacts) {
    const match = await fuzzyMatchContact(c.firstName, c.lastName);
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "contact",
      payload: c,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  for (const p of dedupedProjects) {
    const entityId = await resolveProposedEntityId(p.entityName, entityMatchByName);
    const match = await fuzzyMatchProject(
      p.name,
      entityId !== undefined ? { entityId } : undefined,
    );
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "project",
      payload: p,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  // Cap de dédup côté extraction : si un titre proche existe déjà sur
  // le projet cible (ou en tâches sans projet), on skip pour éviter le
  // double signal. L'utilisateur verra la tâche existante déjà en base
  // et pourra créer manuellement une variante s'il en veut une.
  const TASK_DEDUP_THRESHOLD = 0.5;
  let skippedDupTasks = 0;
  for (const t of result.proposedTasks) {
    const projectMatch = t.projectName ? await fuzzyMatchProject(t.projectName) : null;
    const assigneeMatch = t.assigneeName ? await fuzzyMatchUser(t.assigneeName) : null;
    const dupTask = await fuzzyMatchTaskInProject(
      t.title,
      projectMatch?.id ?? null,
      TASK_DEDUP_THRESHOLD,
    );
    if (dupTask) {
      skippedDupTasks++;
      continue;
    }
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "task",
      payload: {
        ...t,
        projectId: projectMatch?.id ?? null,
        assigneeId: assigneeMatch?.id ?? null,
      },
      matchedId: null,
      matchConfidence: null,
    });
  }
  if (skippedDupTasks > 0) {
    console.info(
      `[extract meeting ${meeting.id}] ${skippedDupTasks} tâche(s) LLM ignorée(s) : déjà en base sur le projet.`,
    );
  }

  if (proposalsRows.length > 0) {
    await conn.insert(meetingProposals).values(proposalsRows);
  }

  await conn
    .update(meetings)
    .set({
      summary: result.summary,
      occurredAt: meeting.occurredAt ?? (result.occurredAt ? new Date(result.occurredAt) : null),
      status: "extracted",
    })
    .where(eq(meetings.id, meeting.id));

  return { count: proposalsRows.length };
}

/** Garde la 1re occurrence par clé. Préserve l'ordre d'entrée. */
function dedupeBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

/**
 * Résout l'entité d'un projet proposé pour scoper le fuzzy match.
 * Retour :
 *  - `string` (entityId) si l'entité résout à un existant → scope strict
 *  - `null` si le LLM déclare un projet sans entité → scope internes
 *  - `undefined` si l'entité est un nouvel objet non encore en base → pas
 *    de scope (le projet est peut-être nouveau aussi, on laisse le seuil
 *    global 0.55 filtrer)
 */
async function resolveProposedEntityId(
  entityName: string | null,
  entityMatchByName: Map<string, string | null>,
): Promise<string | null | undefined> {
  if (entityName === null) return null;
  const key = entityName.trim().toLowerCase();
  if (entityMatchByName.has(key)) {
    const cached = entityMatchByName.get(key);
    return cached === null ? undefined : cached;
  }
  const match = await fuzzyMatchEntity(entityName);
  return match?.id ?? undefined;
}
