import { z } from "zod";

/**
 * La feuille de route d'un dépôt (`roadmap.json`), telle que l'agent de
 * code la tient : épics, items numérotés, statuts. C'est l'état
 * d'avancement réel ; Parade OS la lit et aligne ses tâches dessus. Pure.
 *
 * Format attendu (clés inconnues ignorées) :
 *   { "updated": "2026-10-28",
 *     "statuses": { "done": { "label": "Livré" }, … },
 *     "epics": [ { "id": "E1", "name": "…", "goal": "…",
 *                  "items": [ { "id": "1.1", "prio": "P1", "status": "done",
 *                               "title": "…", "note": "…" } ] } ] }
 */

const itemSchema = z.object({
  id: z.string().min(1),
  prio: z.string().nullish(),
  status: z.string().min(1),
  title: z.string().min(1),
  note: z.string().nullish(),
});

const epicSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  goal: z.string().nullish(),
  items: z.array(itemSchema).default([]),
});

const roadmapSchema = z.object({
  updated: z.string().nullish(),
  statuses: z.record(z.string(), z.object({ label: z.string() })).default({}),
  epics: z.array(epicSchema).default([]),
});

export type RoadmapItem = z.infer<typeof itemSchema>;
export type RoadmapEpic = z.infer<typeof epicSchema>;
export type Roadmap = z.infer<typeof roadmapSchema>;

/** Null si le texte n'est pas une feuille de route lisible. */
export function parseRoadmap(text: string): Roadmap | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = roadmapSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

/** Relit un contenu déjà stocké en base (jsonb). */
export function roadmapFromStored(content: unknown): Roadmap | null {
  const parsed = roadmapSchema.safeParse(content);
  return parsed.success ? parsed.data : null;
}

export type FlatItem = RoadmapItem & { epicId: string; epicName: string };

export function flattenItems(roadmap: Roadmap): FlatItem[] {
  return roadmap.epics.flatMap((e) =>
    e.items.map((i) => ({ ...i, epicId: e.id, epicName: e.name })),
  );
}

/**
 * Statut Parade OS que commande un statut de feuille de route. `null` :
 * aucune conséquence (une piste non engagée ne change rien à la tâche).
 * Les clés sont celles du fichier GpasPlus, devenues la convention :
 * done / test / doing / todo / wait / idea.
 */
export const ROADMAP_STATUS_TO_TASK: Record<
  string,
  "todo" | "in_progress" | "awaiting_client" | "done" | null
> = {
  done: "done",
  test: "awaiting_client",
  wait: "awaiting_client",
  doing: "in_progress",
  todo: "todo",
  idea: null,
};

export function taskStatusForRoadmapStatus(
  status: string,
): "todo" | "in_progress" | "awaiting_client" | "done" | null {
  return ROADMAP_STATUS_TO_TASK[status] ?? null;
}

export type RoadmapTint = "gray" | "blue" | "yellow" | "green" | "mauve" | "orange";

export const ROADMAP_STATUS_TINT: Record<string, RoadmapTint> = {
  done: "green",
  test: "mauve",
  doing: "blue",
  todo: "gray",
  wait: "orange",
  idea: "gray",
};

export function roadmapStatusTint(status: string): RoadmapTint {
  return ROADMAP_STATUS_TINT[status] ?? "gray";
}

/** Libellé d'un statut : celui du fichier, sinon la clé telle quelle. */
export function roadmapStatusLabel(roadmap: Roadmap, status: string): string {
  return roadmap.statuses[status]?.label ?? status;
}

/** Ordre d'affichage des statuts : le plus actif d'abord. */
export const ROADMAP_STATUS_ORDER = ["doing", "test", "wait", "todo", "done", "idea"];
