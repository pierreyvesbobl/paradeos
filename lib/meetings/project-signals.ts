import { normalizeNameKey } from "@/lib/crm/name-key";

/**
 * Rattachement d'une réunion à un projet quand les indices concordent.
 * Règles pures : le rassemblement des indices en base vit dans
 * project-attach.ts. Chaque indice pèse ; on rattache quand un projet
 * cumule assez de poids et qu'aucun autre ne lui fait concurrence. Une
 * réunion transverse (point d'associés, revue de portefeuille) disperse
 * ses indices et reste sans projet : un mauvais rattachement se voit
 * moins qu'une absence de rattachement.
 */

export type ProjectSignalKind =
  /** L'extraction a reconnu ce projet existant à coup sûr dans le transcript. */
  | "named"
  /** Le titre de la réunion contient le nom du projet. */
  | "title_project"
  /** Le titre nomme le client ; le poids est partagé entre ses projets ouverts. */
  | "title_entity"
  /** Les tâches proposées pointent majoritairement sur ce projet. */
  | "tasks"
  /** Les participants externes sont des contacts de ce projet. */
  | "participants";

export type ProjectSignal = { projectId: string; kind: ProjectSignalKind; weight: number };

export const SIGNAL_WEIGHT: Record<ProjectSignalKind | "title_sole_entity", number> = {
  named: 0.8,
  title_project: 0.8,
  title_entity: 0.5,
  /** Le titre nomme un client qui n'a qu'un seul projet ouvert : il n'y a pas à choisir. */
  title_sole_entity: 0.6,
  tasks: 0.5,
  participants: 0.4,
};

/** Seuil de rattachement : deux indices indépendants, ou un indice fort. */
export const ATTACH_MIN_SCORE = 0.8;
/** Au-delà, un second projet fait de la réunion une réunion transverse. */
export const RIVAL_MAX_SCORE = 0.3;

export type ProjectDecision = {
  projectId: string;
  score: number;
  reasons: ProjectSignalKind[];
};

export function decideMeetingProject(signals: ProjectSignal[]): ProjectDecision | null {
  // Un même type d'indice ne compte qu'une fois par projet.
  const byProject = new Map<string, Map<ProjectSignalKind, number>>();
  for (const s of signals) {
    const kinds = byProject.get(s.projectId) ?? new Map<ProjectSignalKind, number>();
    kinds.set(s.kind, Math.max(kinds.get(s.kind) ?? 0, s.weight));
    byProject.set(s.projectId, kinds);
  }
  const ranked = [...byProject.entries()]
    .map(([projectId, kinds]) => ({
      projectId,
      score: [...kinds.values()].reduce((a, b) => a + b, 0),
      reasons: [...kinds.keys()],
    }))
    .sort((a, b) => b.score - a.score);
  const [top, second] = ranked;
  if (!top || top.score < ATTACH_MIN_SCORE - 1e-9) return null;
  if (second && second.score > RIVAL_MAX_SCORE + 1e-9) return null;
  return {
    projectId: top.projectId,
    score: Math.round(top.score * 100) / 100,
    reasons: top.reasons,
  };
}

export type NamedProject = {
  id: string;
  name: string;
  entityId: string | null;
  entityName: string | null;
};

/** Le texte normalisé contient-il la suite de mots `needle` ? */
function containsWords(haystack: string, needle: string): boolean {
  if (!needle || needle.length < 3) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

/**
 * Indices tirés du titre. Le nom complet du projet pèse lourd ; le nom du
 * client seul pèse moins, et son poids se partage entre ses projets
 * ouverts (« Point GpasPlus » quand GpasPlus a trois projets ne dit pas
 * lequel).
 */
export function titleSignals(title: string, openProjects: NamedProject[]): ProjectSignal[] {
  const t = normalizeNameKey(title);
  if (!t) return [];
  const out: ProjectSignal[] = [];
  const byEntity = new Map<string, NamedProject[]>();
  for (const p of openProjects) {
    if (p.entityId) {
      const arr = byEntity.get(p.entityId) ?? [];
      arr.push(p);
      byEntity.set(p.entityId, arr);
    }
    // Le nom d'un projet commence souvent par celui du client
    // (« GpasPlus - Automatisation… ») : on teste la partie propre au projet.
    const name = normalizeNameKey(p.name);
    const own = p.entityName ? name.replace(normalizeNameKey(p.entityName), "").trim() : name;
    if (containsWords(t, name) || (own !== name && containsWords(t, own))) {
      out.push({ projectId: p.id, kind: "title_project", weight: SIGNAL_WEIGHT.title_project });
    }
  }
  for (const projects of byEntity.values()) {
    const entityName = normalizeNameKey(projects[0]?.entityName);
    if (!containsWords(t, entityName)) continue;
    const share =
      projects.length === 1
        ? SIGNAL_WEIGHT.title_sole_entity
        : SIGNAL_WEIGHT.title_entity / projects.length;
    for (const p of projects) out.push({ projectId: p.id, kind: "title_entity", weight: share });
  }
  return out;
}

/** Majorité nette des tâches proposées sur un projet : au moins deux, trois quarts. */
export function taskSignals(taskProjectIds: (string | null)[]): ProjectSignal[] {
  const ids = taskProjectIds.filter((id): id is string => Boolean(id));
  if (ids.length < 2) return [];
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const [topId, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  if (!topId || topCount < 2 || topCount / ids.length < 0.75) return [];
  return [{ projectId: topId, kind: "tasks", weight: SIGNAL_WEIGHT.tasks }];
}

/** Projets des participants externes ; le poids se partage s'ils en désignent plusieurs. */
export function participantSignals(projectIdsOfParticipants: string[][]): ProjectSignal[] {
  const all = new Set(projectIdsOfParticipants.flat());
  if (all.size === 0) return [];
  const share = SIGNAL_WEIGHT.participants / all.size;
  return [...all].map((projectId) => ({ projectId, kind: "participants" as const, weight: share }));
}
