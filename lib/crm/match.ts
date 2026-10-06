import "server-only";

import {
  matchContact,
  matchEntity,
  matchOpenTask,
  matchProject,
  matchUser,
} from "@/lib/crm/candidates";
import type { Match } from "@/lib/crm/pick";
import { db } from "@/lib/db/server";

export type { ContactIdentity, Match } from "@/lib/crm/pick";
/**
 * Façade côté app du rapprochement anti-doublon : les mêmes matchers que
 * `lib/crm/candidates.ts`, liés à la connexion Drizzle de l'app. Les
 * pipelines (extraction, acceptation de proposition, LinkedIn) passent
 * toujours par ici ; le serveur MCP, lui, appelle `candidates.ts`
 * directement avec sa propre connexion.
 */
export {
  isCertainMatch,
  isGenericProjectName,
  MATCH_THRESHOLD,
  pickBestContact,
  pickBestMatch,
  pickBestProject,
} from "@/lib/crm/pick";

export async function fuzzyMatchEntity(name: string, threshold?: number): Promise<Match> {
  return matchEntity(await db(), name, threshold);
}

/**
 * Match d'un contact. Passe `opts.email` dès qu'une adresse est connue :
 * c'est le seul discriminant fort dont on dispose sur une personne.
 */
export async function fuzzyMatchContact(
  firstName: string,
  lastName: string,
  opts?: { email?: string | null; threshold?: number },
): Promise<Match> {
  return matchContact(await db(), firstName, lastName, opts);
}

/** Match d'un projet, avec scope entité facultatif (cf. `candidates.ts`). */
export async function fuzzyMatchProject(
  name: string,
  opts?: { entityId?: string | null; threshold?: number },
): Promise<Match> {
  return matchProject(await db(), name, opts);
}

export async function fuzzyMatchUser(name: string, threshold?: number): Promise<Match> {
  return matchUser(await db(), name, threshold);
}

/** Tâche ouverte équivalente (cf. `candidates.ts` pour le scope). */
export async function fuzzyMatchTaskInProject(
  title: string,
  projectId: string | null,
  threshold?: number,
  opts?: { anyProject?: boolean },
): Promise<Match> {
  return matchOpenTask(await db(), title, projectId, threshold, opts);
}
