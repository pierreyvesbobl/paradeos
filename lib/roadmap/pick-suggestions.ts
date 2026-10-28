import { z } from "zod";

export type RoadmapSuggestion = {
  taskId: string;
  itemId: string;
  confidence: number;
  reason: string;
};

/** En dessous, la paire n'est pas proposée. */
export const MIN_CONFIDENCE = 0.6;

export const matchResultSchema = z.object({
  pairs: z.array(
    z.object({
      taskId: z.string(),
      itemId: z.string(),
      /** 0 à 1. */
      confidence: z.number(),
      /** Une phrase, en français : ce qui relie la tâche à l'item. */
      reason: z.string(),
    }),
  ),
});

export type MatchResult = z.infer<typeof matchResultSchema>;

/**
 * Garde les paires exploitables : ids connus, confiance suffisante, un
 * seul item par tâche (le plus sûr). Pure, testable sans modèle.
 */
export function pickSuggestions(
  raw: MatchResult,
  known: { taskIds: Set<string>; itemIds: Set<string> },
): RoadmapSuggestion[] {
  const best = new Map<string, RoadmapSuggestion>();
  for (const p of raw.pairs) {
    if (!known.taskIds.has(p.taskId) || !known.itemIds.has(p.itemId)) continue;
    const confidence = Math.max(0, Math.min(1, p.confidence));
    if (confidence < MIN_CONFIDENCE) continue;
    const current = best.get(p.taskId);
    if (!current || current.confidence < confidence) {
      best.set(p.taskId, { taskId: p.taskId, itemId: p.itemId, confidence, reason: p.reason });
    }
  }
  return [...best.values()];
}
