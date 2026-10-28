import "server-only";

import { getOpenRouterModel } from "@/lib/llm/openrouter";
import { generateStructured } from "@/lib/llm/structured";
import { withLlmTimeout } from "@/lib/llm/timeout";
import type { MatchableTask } from "@/lib/roadmap/match";
import {
  type CommitSuggestion,
  matchResultSchema,
  pickCommitSuggestions,
} from "@/lib/roadmap/pick-suggestions";

export type MatchableCommit = {
  sha: string;
  subject: string;
  body: string | null;
  committedAt: Date;
};

const INSTRUCTIONS = `Tu lis des commits d'un dépôt de produit et des tâches issues de réunions et de mails clients (Parade OS). Tu dis quels commits livrent quelle tâche.

Règles :
- Une paire n'est proposée que si le commit réalise ce que la tâche demande, en tout ou en bonne partie. Un commit qui touche le même écran sans faire ce qui est demandé ne compte pas.
- Un commit livre une tâche au plus. Plusieurs commits peuvent livrer la même tâche.
- Les tâches qui sont des gestes humains (envoyer, relancer, demander, payer) ne sont livrées par aucun commit.
- itemId = le sha du commit. confidence : 0.9 et plus quand c'est la même chose ; 0.6 à 0.8 quand c'est très probable ; en dessous, ne pas proposer.
- reason : une phrase en français, concrète.
Réponds uniquement par les paires retenues.`;

/** Rapprochement LLM commits ↔ tâches ouvertes. Lève si le modèle n'est pas configuré. */
export async function suggestCommitLinks(
  commits: MatchableCommit[],
  tasks: MatchableTask[],
): Promise<CommitSuggestion[]> {
  if (commits.length === 0 || tasks.length === 0) return [];
  const { model, modelId } = await getOpenRouterModel();
  const prompt = [
    "Tâches Parade OS :",
    ...tasks.map(
      (t) =>
        `- [${t.id}] ${t.title}${t.kind ? ` (type : ${t.kind})` : ""}${
          t.description ? `\n  ${t.description.replace(/\s+/g, " ").slice(0, 300)}` : ""
        }`,
    ),
    "",
    "Commits :",
    ...commits.map(
      (c) =>
        `- [${c.sha}] ${c.committedAt.toISOString().slice(0, 10)} ${c.subject}${
          c.body ? `\n  ${c.body.replace(/\s+/g, " ").slice(0, 300)}` : ""
        }`,
    ),
  ].join("\n");

  const raw = await withLlmTimeout(
    { budgetMs: 150_000, modelId, label: "le rapprochement des commits" },
    (signal) =>
      generateStructured({
        abortSignal: signal,
        model,
        schema: matchResultSchema,
        instructions: INSTRUCTIONS,
        prompt,
        temperature: 0,
      }),
  );
  return pickCommitSuggestions(raw, {
    taskIds: new Set(tasks.map((t) => t.id)),
    shas: new Set(commits.map((c) => c.sha)),
  });
}
