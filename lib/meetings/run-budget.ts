import { LLM_BUDGET_MS } from "@/lib/llm/timeout";

/**
 * Budget de temps des crons d'ingestion (Drive, mail).
 *
 * Le piège : décider « je n'entame plus rien après 200 s » ne borne rien,
 * parce que ce qu'on entame à la 199e seconde peut durer 240 s de plus
 * (cf. `LLM_BUDGET_MS.meetingExtraction`). Vercel tue la fonction à 300 s
 * et rend un 504 — la cron passe pour cassée alors qu'elle travaillait.
 *
 * La bonne question n'est pas « depuis combien de temps je tourne » mais
 * « ai-je encore la place pour le pire cas d'un élément de plus ».
 */

/** `maxDuration` des routes `/api/cron/ingest-*`. */
export const CRON_MAX_DURATION_MS = 300_000;

/**
 * De quoi lister, insérer, pousser un audio au Storage et reposer un
 * libellé Gmail autour de l'appel LLM.
 */
const OVERHEAD_MS = 20_000;

/** Au-delà, entamer un élément de plus, c'est risquer le 504. */
export const START_CUTOFF_MS = CRON_MAX_DURATION_MS - LLM_BUDGET_MS.meetingExtraction - OVERHEAD_MS;

/**
 * Reste-t-il la place d'entamer un élément ? Le premier part toujours :
 * un run qui n'ose rien ne rattrape jamais son retard, et le pire cas
 * d'un seul élément reste sous la limite de la plateforme.
 */
export function canStartAnotherItem(
  startedAt: number,
  itemsStarted: number,
  now: number = Date.now(),
): boolean {
  if (itemsStarted === 0) return true;
  return now - startedAt <= START_CUTOFF_MS;
}
