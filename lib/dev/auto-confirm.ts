import "server-only";

import { and, eq, gte, inArray, notInArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import { taskCommitLinks } from "@/db/schema/repo-commits";
import { taskRoadmapLinks } from "@/db/schema/repo-roadmaps";
import { confirmCommitDelivers } from "@/lib/repos/commits";
import { applyRoadmapStatusToTask } from "@/lib/roadmap/apply";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

type Conn = Pick<Database, "select" | "update" | "insert" | "delete">;

export const DEFAULT_AUTO_CONFIRM_MIN = 0.9;

/** Options proposées dans les réglages ; `null` = validation à la main. */
export const AUTO_CONFIRM_CHOICES: { value: string; label: string }[] = [
  { value: "off", label: "Jamais : tout se valide à la main" },
  { value: "0.95", label: "À partir de 95 % de confiance" },
  { value: "0.9", label: "À partir de 90 % de confiance" },
  { value: "0.8", label: "À partir de 80 % de confiance" },
];

/** Seuil courant, ou null si la validation automatique est coupée. */
export async function getAutoConfirmMin(): Promise<number | null> {
  const raw = await getSetting(SETTING_KEYS.DEV_AUTO_CONFIRM_MIN);
  if (raw === null || raw === undefined || raw === "") return DEFAULT_AUTO_CONFIRM_MIN;
  if (raw === "off") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : DEFAULT_AUTO_CONFIRM_MIN;
}

/**
 * Confirme les suggestions tâche ↔ item au-dessus du seuil, pour les
 * tâches sans lien confirmé. La tâche prend aussitôt le statut de l'item.
 * Renvoie le nombre de liens confirmés.
 */
export async function autoConfirmRoadmapLinks(
  conn: Conn,
  remote: string,
  min: number | null,
): Promise<number> {
  if (min === null) return 0;
  const alreadyLinked = conn
    .select({ taskId: taskRoadmapLinks.taskId })
    .from(taskRoadmapLinks)
    .where(eq(taskRoadmapLinks.status, "confirmed"));
  const rows = await conn
    .select({ id: taskRoadmapLinks.id, taskId: taskRoadmapLinks.taskId })
    .from(taskRoadmapLinks)
    .where(
      and(
        eq(taskRoadmapLinks.remote, remote),
        eq(taskRoadmapLinks.status, "suggested"),
        gte(taskRoadmapLinks.confidence, min),
        notInArray(taskRoadmapLinks.taskId, alreadyLinked),
      ),
    );
  // Une tâche n'a qu'un lien confirmé : si deux suggestions la visent, la
  // première l'emporte, l'autre reste à trancher.
  const taken = new Set<string>();
  let confirmed = 0;
  for (const r of rows) {
    if (taken.has(r.taskId)) continue;
    taken.add(r.taskId);
    await conn
      .update(taskRoadmapLinks)
      .set({ status: "confirmed", auto: true, decidedAt: new Date() })
      .where(eq(taskRoadmapLinks.id, r.id));
    await applyRoadmapStatusToTask(conn, r.taskId);
    confirmed += 1;
  }
  return confirmed;
}

/**
 * Confirme les suggestions tâche ↔ commit au-dessus du seuil : la tâche
 * est terminée. Renvoie le nombre de liens confirmés.
 */
export async function autoConfirmCommitLinks(
  conn: Conn,
  remote: string,
  min: number | null,
): Promise<number> {
  if (min === null) return 0;
  const rows = await conn
    .select({
      id: taskCommitLinks.id,
      taskId: taskCommitLinks.taskId,
      sha: taskCommitLinks.sha,
    })
    .from(taskCommitLinks)
    .where(
      and(
        eq(taskCommitLinks.remote, remote),
        eq(taskCommitLinks.status, "suggested"),
        gte(taskCommitLinks.confidence, min),
      ),
    );
  if (rows.length === 0) return 0;
  await conn
    .update(taskCommitLinks)
    .set({ status: "confirmed", auto: true, decidedAt: new Date() })
    .where(
      inArray(
        taskCommitLinks.id,
        rows.map((r) => r.id),
      ),
    );
  for (const r of rows) {
    await confirmCommitDelivers(conn, { taskId: r.taskId, remote, sha: r.sha });
  }
  return rows.length;
}
