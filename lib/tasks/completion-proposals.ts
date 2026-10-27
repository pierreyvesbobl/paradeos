import "server-only";

import { inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { tasks } from "@/db/schema/tasks";
import { hasPendingProposalElsewhere } from "@/lib/crm/proposal-dedupe";
import type { CompletionConfidence, ResolvedTaskCompletion } from "@/lib/meetings/completed-tasks";
import { markTaskDone, restoreTaskStatus, type TaskStatus } from "@/lib/tasks/complete";

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

/** Id de la tâche visée par une proposition `task_completion`. */
export function completionTaskId(proposal: {
  matchedId: string | null;
  createdEntityId?: string | null;
  payload: unknown;
}): string | null {
  const p = (proposal.payload ?? {}) as Record<string, unknown>;
  return (
    proposal.matchedId ??
    proposal.createdEntityId ??
    (typeof p.taskId === "string" ? p.taskId : null)
  );
}

/**
 * Applique une clôture : la tâche passe en `done` et le payload garde
 * l'état d'avant, capturé à cet instant précis (la tâche a pu bouger
 * depuis l'extraction). Renvoie le payload à persister.
 */
export async function applyTaskCompletion(
  conn: Pick<Database, "select" | "update">,
  taskId: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const snapshot = await markTaskDone(conn, taskId);
  if (!snapshot) throw new Error("Tâche introuvable.");
  return {
    ...payload,
    previousStatus: snapshot.previousStatus,
    previousCompletedAt: snapshot.previousCompletedAt?.toISOString() ?? null,
  };
}

/**
 * Annule une clôture acceptée : restaure le statut d'avant. Sans effet si
 * la tâche était déjà terminée au moment de l'acceptation, ou si
 * quelqu'un l'a rouverte depuis. Renvoie vrai si la tâche a été rouverte.
 */
export async function undoTaskCompletion(
  conn: Pick<Database, "select" | "update">,
  taskId: string,
  payload: unknown,
): Promise<boolean> {
  const p = (payload ?? {}) as Record<string, unknown>;
  const previousStatus = typeof p.previousStatus === "string" ? p.previousStatus : "todo";
  if (previousStatus === "done") return false;
  const previousCompletedAt =
    typeof p.previousCompletedAt === "string" ? new Date(p.previousCompletedAt) : null;
  return restoreTaskStatus(conn, taskId, {
    status: previousStatus as TaskStatus,
    completedAt:
      previousCompletedAt && !Number.isNaN(previousCompletedAt.getTime())
        ? previousCompletedAt
        : null,
  });
}
