/**
 * Ce qu'est une tâche : à développer, à analyser, ou un geste humain.
 * Posé par l'extraction LLM, corrigeable à la main, lu par la projection
 * en issue GitHub (seules les `feature` partent). Module pur.
 */

export const TASK_KINDS = ["feature", "investigation", "action"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

export const taskKindLabels: Record<TaskKind, string> = {
  feature: "Fonctionnalité",
  investigation: "Investigation",
  action: "Action",
};

export const taskKindDescriptions: Record<TaskKind, string> = {
  feature: "À développer dans le produit ou le dépôt",
  investigation: "À vérifier, analyser, comprendre avant d'agir",
  action: "Geste humain : envoyer, demander, relancer",
};

export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === "string" && (TASK_KINDS as readonly string[]).includes(value);
}

/** Lit le type d'un payload de proposition, null si absent ou inconnu. */
export function taskKindFromPayload(payload: unknown): TaskKind | null {
  const kind = (payload as { kind?: unknown } | null)?.kind;
  return isTaskKind(kind) ? kind : null;
}

/** Bloc de prompt commun aux extractions réunion et mail. */
export const TASK_KIND_PROMPT_RULES = `# Tâches : nature (\`kind\`)

Pour chaque tâche de \`proposedTasks\`, qualifie ce qu'elle est :
- **kind="feature"** : quelque chose à construire, modifier ou corriger dans un
  produit, un outil, un dashboard, un dépôt de code (une alerte à créer, un
  écran à revoir, une donnée à remonter, un calcul à corriger, un export à
  ajouter). C'est du travail de développement, quel qu'en soit le porteur.
- **kind="investigation"** : vérifier, analyser, comprendre, mesurer, avant de
  décider ou de construire (« pourquoi cet écart », « regarder si l'API
  permet », « tester un service »).
- **kind="action"** : un geste humain sans développement (envoyer un mail,
  demander un accès, relancer quelqu'un, payer, répondre, créer un compte,
  transmettre un fichier).
- Si l'action incombe à une personne extérieure à l'équipe (client,
  fournisseur), c'est presque toujours "action", même si elle touche un outil.
- En cas de doute entre feature et investigation, choisis "investigation".
- Mets null uniquement si la tâche ne se laisse pas classer.`;
