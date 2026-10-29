/**
 * Tâches ouvertes données pour faites par un transcript ou un mail.
 *
 * Le LLM reçoit les tâches ouvertes avec une référence courte (`T12`) et
 * renvoie, pour chacune qu'il juge terminée, cette référence, une citation
 * et un niveau de confiance. Ce module est pur : il numérote les tâches,
 * formate leur bloc de prompt et traduit les références en identifiants.
 */

export type TaskVocabularyEntry = {
  id: string;
  /** Référence courte injectée dans le prompt (`T1`, `T2`…). */
  ref: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  status: string;
};

export type CompletionConfidence = "certain" | "probable";

/**
 * Une proposition en attente passée au vocabulaire porte cet identifiant
 * préfixé : le modèle la voit comme une tâche, et la persistance sait
 * qu'il s'agit d'une ligne `email_proposals` à clore, pas d'une tâche.
 */
export const PROPOSAL_REF_PREFIX = "proposal:";
export const PROPOSED_STATUS = "proposed";

export function proposalIdFromTaskId(taskId: string): string | null {
  return taskId.startsWith(PROPOSAL_REF_PREFIX) ? taskId.slice(PROPOSAL_REF_PREFIX.length) : null;
}

/** Sortie brute du modèle, avant résolution des références. */
export type RawCompletedTask = {
  taskRef: string;
  evidence: string;
  confidence: CompletionConfidence;
};

export type ResolvedTaskCompletion = {
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  projectName: string | null;
  evidence: string;
  confidence: CompletionConfidence;
};

/** Numérote les tâches dans l'ordre reçu : la première est `T1`. */
export function assignTaskRefs<T extends Omit<TaskVocabularyEntry, "ref">>(
  rows: T[],
): (T & { ref: string })[] {
  return rows.map((row, i) => ({ ...row, ref: `T${i + 1}` }));
}

/**
 * Bloc « tâches ouvertes » du vocabulaire. Les tâches du projet concerné
 * passent en tête, dans leur propre sous-liste : c'est là que le modèle
 * doit chercher d'abord, qu'il s'agisse de ne pas re-proposer ou de
 * signaler une clôture.
 */
export function formatTaskVocabulary(
  tasks: TaskVocabularyEntry[],
  priorityProjectId: string | null,
): string {
  if (tasks.length === 0) return "";
  const line = (t: TaskVocabularyEntry) => {
    const bits = [`[${t.ref}] ${t.title}`];
    if (t.projectName) bits.push(`— projet ${t.projectName}`);
    bits.push(`[${t.status}]`);
    return `- ${bits.join(" ")}`;
  };
  const open = tasks.filter(
    (t) => t.status !== "done" && t.status !== "cancelled" && t.status !== PROPOSED_STATUS,
  );
  const done = tasks.filter((t) => t.status === "done");
  const proposed = tasks.filter((t) => t.status === PROPOSED_STATUS);
  const priority = priorityProjectId ? open.filter((t) => t.projectId === priorityProjectId) : [];
  const others = priorityProjectId ? open.filter((t) => t.projectId !== priorityProjectId) : open;

  const head = `Tâches déjà connues, avec leur référence entre crochets. Trois usages :
- NE PAS re-proposer une de ces tâches dans proposedTasks, même reformulée, qu'elle soit ouverte ou terminée.
- Si le contenu établit qu'une tâche OUVERTE est FAITE, renvoie sa référence dans completedTasks.
- Si le contenu REPARLE d'une tâche, ouverte ou terminée, renvoie sa référence dans mentionedTasks.`;

  const blocks: string[] = [head];
  if (priority.length > 0) {
    blocks.push(`Tâches ouvertes du projet concerné :\n${priority.map(line).join("\n")}`);
  }
  if (others.length > 0) {
    blocks.push(
      `${priority.length > 0 ? "Autres tâches ouvertes" : "Tâches ouvertes"} :\n${others
        .map(line)
        .join("\n")}`,
    );
  }
  if (done.length > 0) {
    blocks.push(
      `Tâches terminées récemment du projet concerné (jamais dans completedTasks ni proposedTasks ; dans mentionedTasks si le contenu en reparle : remerciement, vérification du livrable, question dessus) :\n${done
        .map(line)
        .join("\n")}`,
    );
  }
  if (proposed.length > 0) {
    blocks.push(
      `Tâches proposées d'après les messages précédents de ce fil, pas encore acceptées (jamais dans proposedTasks ; dans completedTasks si ce message les donne pour faites OU les rend sans objet, par exemple une réponse déjà envoyée, une question déjà réglée, un besoin abandonné) :\n${proposed
        .map(line)
        .join("\n")}`,
    );
  }
  return blocks.join("\n\n");
}

/** Règles du prompt pour `completedTasks`, communes aux mails et aux réunions. */
export const COMPLETED_TASKS_PROMPT_RULES = `# Tâches terminées (completedTasks)

Parmi les « Tâches ouvertes déjà connues » du vocabulaire, signale celles que le contenu donne pour FAITES :
- confidence="certain" : la personne en charge déclare l'action accomplie, au passé (« j'ai envoyé le devis », « c'est livré », « le contrat est signé »), ou le livrable attendu est reçu / joint.
- confidence="probable" : la clôture se déduit sans être dite (on passe à l'étape suivante alors que la tâche en était le prérequis, un tiers rapporte que c'est fait).
- Jamais pour une intention ou une promesse (« je vais envoyer », « je m'en occupe demain »), ni pour une tâche seulement mentionnée ou discutée.
- Pour les « Tâches proposées d'après les messages précédents de ce fil » : aussi quand ce message les rend sans objet (la réponse attendue est donnée, la question est réglée, le besoin est abandonné), confidence="certain" si c'est explicite.
- taskRef = la référence exacte entre crochets (ex. T12), jamais le titre.
- evidence = citation courte et verbatim du passage qui le prouve.
- Tableau vide si rien n'indique qu'une tâche est faite.`;

/** `[T12]`, `t12`, ` T12 ` → `T12`. Chaîne vide si rien d'exploitable. */
export function normalizeTaskRef(raw: string): string {
  const m = raw
    .trim()
    .toUpperCase()
    .match(/T\s*0*(\d+)/);
  return m ? `T${m[1]}` : "";
}

const CONFIDENCE_RANK: Record<CompletionConfidence, number> = { probable: 0, certain: 1 };

/**
 * Traduit les références renvoyées par le modèle en tâches connues.
 * Référence inconnue : ignorée. Même tâche citée deux fois : une seule
 * entrée, la confiance la plus forte l'emporte.
 */
export function resolveCompletedTasks(
  raw: RawCompletedTask[],
  tasks: TaskVocabularyEntry[],
): ResolvedTaskCompletion[] {
  const byRef = new Map(tasks.map((t) => [t.ref, t]));
  const out = new Map<string, ResolvedTaskCompletion>();
  for (const r of raw) {
    const task = byRef.get(normalizeTaskRef(r.taskRef));
    if (!task) continue;
    const evidence = r.evidence.trim();
    const existing = out.get(task.id);
    if (existing && CONFIDENCE_RANK[existing.confidence] >= CONFIDENCE_RANK[r.confidence]) {
      continue;
    }
    out.set(task.id, {
      taskId: task.id,
      taskTitle: task.title,
      projectId: task.projectId,
      projectName: task.projectName,
      evidence: evidence || (existing?.evidence ?? ""),
      confidence: r.confidence,
    });
  }
  return [...out.values()];
}
