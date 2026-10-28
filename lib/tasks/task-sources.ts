import { normalizeTaskRef, type TaskVocabularyEntry } from "@/lib/meetings/completed-tasks";

/**
 * Ce qui a été dit d'une tâche, mot pour mot, dans une réunion ou un mail.
 *
 * Le LLM renvoie, pour chaque tâche nouvelle (`proposedTasks[].excerpts`)
 * et pour chaque tâche connue qu'il voit réévoquée (`mentionedTasks`), les
 * passages verbatim qui en parlent. Ce module est pur : il porte les
 * règles de prompt, nettoie les passages, calcule leur empreinte et
 * traduit les références `T12` en identifiants. L'écriture en base vit
 * dans lib/tasks/record-sources.ts.
 */

export type TaskExcerpt = {
  /** Passage verbatim. */
  quote: string;
  /** Qui parle, si la source le dit. */
  speaker: string | null;
};

/** Sortie brute du modèle pour une tâche connue réévoquée. */
export type RawMentionedTask = {
  taskRef: string;
  excerpts: TaskExcerpt[];
};

export type ResolvedTaskMention = {
  taskId: string;
  taskTitle: string;
  excerpts: TaskExcerpt[];
};

/** Un passage plus long que ça n'est plus une citation, c'est un transcript. */
export const MAX_EXCERPT_CHARS = 1_200;
/** Au-delà, le modèle recopie la réunion : on garde les premiers. */
export const MAX_EXCERPTS_PER_TASK = 8;

/** Règles du prompt, communes aux mails et aux réunions. */
export const TASK_SOURCES_PROMPT_RULES = `# Ce qui a été dit sur chaque tâche (excerpts, mentionedTasks)

Une tâche sans les mots qui l'ont motivée est un titre vide : la personne qui la fera, ou l'agent qui la codera, doit retrouver ce que le client a dit exactement. Pour chaque tâche, recopie donc les passages du contenu qui en parlent :
- \`excerpts\` (sur chaque élément de proposedTasks) : les passages VERBATIM qui expriment ce besoin — la demande, les précisions, les contraintes, le pourquoi, les exemples donnés. Copie le texte tel qu'il est écrit (au plus, répare une coupure de transcription évidente), jamais de paraphrase ni de résumé. \`speaker\` = la personne qui parle si le contenu l'indique, sinon null. De un à cinq passages, les plus informatifs d'abord. Tableau vide seulement si le besoin n'est exprimé nulle part en clair.
- \`mentionedTasks\` : les « Tâches déjà connues », ouvertes ou terminées récemment, dont le contenu REPARLE sans les donner pour faites — une précision, une relance, un changement de périmètre, une contrainte nouvelle, une question, un exemple. taskRef = la référence exacte entre crochets (ex. T12), excerpts = mêmes règles que ci-dessus. Une tâche citée en passant sans rien apporter n'y figure pas. Une tâche renvoyée dans completedTasks ne se répète pas ici.
- N'inclus jamais de conditions commerciales (tarifs, TJM, remises, négociation) ni d'informations personnelles sans rapport avec le besoin lui-même.`;

/**
 * Empreinte d'un passage : blancs, casse, accents et ponctuation
 * neutralisés, puis hachage 64 bits (cyrb53 étendu, pur JS). Deux
 * extractions du même transcript, ou deux modèles qui coupent la phrase
 * un peu différemment en ponctuation, tombent sur la même ligne. Pas de
 * `node:crypto` : ce module sert aussi aux composants client.
 */
export function excerptFingerprint(quote: string): string {
  const normalized = quote
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Nettoie la liste renvoyée par le modèle : passages vides ou dupliqués
 * écartés, longueur et nombre bornés, locuteur vide → null.
 */
export function normalizeExcerpts(raw: readonly TaskExcerpt[] | null | undefined): TaskExcerpt[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: TaskExcerpt[] = [];
  for (const e of raw) {
    const quote = (e?.quote ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_EXCERPT_CHARS);
    if (!quote) continue;
    const fp = excerptFingerprint(quote);
    if (seen.has(fp)) continue;
    seen.add(fp);
    const speaker = (e?.speaker ?? "").trim();
    out.push({ quote, speaker: speaker || null });
    if (out.length >= MAX_EXCERPTS_PER_TASK) break;
  }
  return out;
}

/**
 * Traduit les références renvoyées par le modèle en tâches connues.
 * Référence inconnue : ignorée. Même tâche citée deux fois : passages
 * fusionnés. Tâche sans aucun passage exploitable : écartée, une mention
 * sans citation n'apporte rien.
 */
export function resolveMentionedTasks(
  raw: readonly RawMentionedTask[],
  tasks: readonly TaskVocabularyEntry[],
): ResolvedTaskMention[] {
  const byRef = new Map(tasks.map((t) => [t.ref, t]));
  const out = new Map<string, ResolvedTaskMention>();
  for (const r of raw) {
    const task = byRef.get(normalizeTaskRef(r.taskRef));
    if (!task) continue;
    const existing = out.get(task.id);
    const excerpts = normalizeExcerpts([...(existing?.excerpts ?? []), ...(r.excerpts ?? [])]);
    if (excerpts.length === 0) continue;
    out.set(task.id, { taskId: task.id, taskTitle: task.title, excerpts });
  }
  return [...out.values()];
}

/** Lit `payload.excerpts` d'une proposition de tâche, quel que soit l'âge du payload. */
export function excerptsFromPayload(payload: unknown): TaskExcerpt[] {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (!Array.isArray(p.excerpts)) return [];
  return normalizeExcerpts(
    p.excerpts.map((e) => {
      const o = (e ?? {}) as Record<string, unknown>;
      return {
        quote: typeof o.quote === "string" ? o.quote : "",
        speaker: typeof o.speaker === "string" ? o.speaker : null,
      };
    }),
  );
}
