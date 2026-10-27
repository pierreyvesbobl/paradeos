import "server-only";

import { inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { tasks } from "@/db/schema/tasks";
import { hasPendingProposalElsewhere } from "@/lib/crm/proposal-dedupe";
import type { CompletionConfidence, ResolvedTaskCompletion } from "@/lib/meetings/completed-tasks";

/**
 * Tri des clôtures de tâches signalées par une extraction (mail ou
 * réunion) avant d'en faire des propositions. Trois filtres :
 *   - la tâche doit encore être ouverte ;
 *   - la même source ne repose pas une question déjà tranchée (une ligne
 *     `accepted` ou `rejected` existait pour cette tâche) ;
 *   - une autre source n'a pas déjà la même clôture en attente.
 *
 * Une tâche que la source avait déjà proposée (ligne `pending` effacée
 * par la ré-extraction, ou décision annulée) perd le droit à la clôture
 * automatique : une question déjà posée à l'humain ne se tranche plus
 * seule.
 */

export type ExistingCompletion = {
  taskId: string | null;
  status: "pending" | "accepted" | "rejected";
};

export type TaskCompletionPlan = ResolvedTaskCompletion & {
  /** Faux dès que la source avait déjà une ligne pour cette tâche. */
  allowAuto: boolean;
};

export type TaskCompletionSkips = {
  alreadyDone: number;
  alreadyDecided: number;
  pendingElsewhere: number;
};

export async function planTaskCompletions(
  conn: Pick<Database, "select">,
  completed: ResolvedTaskCompletion[],
  opts: {
    existing: ExistingCompletion[];
    excludeMeetingId?: string;
    excludeMessageId?: string;
  },
): Promise<{ plans: TaskCompletionPlan[]; skipped: TaskCompletionSkips }> {
  const skipped: TaskCompletionSkips = { alreadyDone: 0, alreadyDecided: 0, pendingElsewhere: 0 };
  if (completed.length === 0) return { plans: [], skipped };

  const openIds = new Set(
    (
      await conn
        .select({ id: tasks.id, status: tasks.status })
        .from(tasks)
        .where(
          inArray(
            tasks.id,
            completed.map((c) => c.taskId),
          ),
        )
    )
      .filter((t) => t.status !== "done" && t.status !== "cancelled")
      .map((t) => t.id),
  );

  const priorByTask = new Map<string, ExistingCompletion["status"]>();
  for (const e of opts.existing) {
    if (!e.taskId) continue;
    // Une décision prime sur une ligne pending restée sans suite.
    const prev = priorByTask.get(e.taskId);
    if (!prev || prev === "pending") priorByTask.set(e.taskId, e.status);
  }

  const plans: TaskCompletionPlan[] = [];
  for (const c of completed) {
    if (!openIds.has(c.taskId)) {
      skipped.alreadyDone++;
      continue;
    }
    const prior = priorByTask.get(c.taskId);
    if (prior === "accepted" || prior === "rejected") {
      skipped.alreadyDecided++;
      continue;
    }
    if (
      await hasPendingProposalElsewhere({
        kind: "task_completion",
        key: c.taskId,
        excludeMeetingId: opts.excludeMeetingId,
        excludeMessageId: opts.excludeMessageId,
      })
    ) {
      skipped.pendingElsewhere++;
      continue;
    }
    plans.push({ ...c, allowAuto: prior === undefined });
  }
  return { plans, skipped };
}

/** `matchConfidence` stocké : le badge de l'UI lit un ratio 0..1. */
export function completionMatchConfidence(confidence: CompletionConfidence): string {
  return confidence === "certain" ? "1.000" : "0.750";
}

/** Payload d'une proposition `task_completion` (cf. migration 0090). */
export function completionPayload(plan: ResolvedTaskCompletion, auto: boolean) {
  return {
    taskId: plan.taskId,
    taskTitle: plan.taskTitle,
    projectId: plan.projectId,
    projectName: plan.projectName,
    evidence: plan.evidence,
    confidence: plan.confidence,
    auto,
  };
}
