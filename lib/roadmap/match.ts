import "server-only";

import { getOpenRouterModel } from "@/lib/llm/openrouter";
import { generateStructured } from "@/lib/llm/structured";
import { withLlmTimeout } from "@/lib/llm/timeout";
import {
  matchResultSchema,
  pickSuggestions,
  type RoadmapSuggestion,
} from "@/lib/roadmap/pick-suggestions";
import type { FlatItem } from "@/lib/roadmap/roadmap";

export type { RoadmapSuggestion } from "@/lib/roadmap/pick-suggestions";

export type MatchableTask = {
  id: string;
  title: string;
  description: string | null;
  kind: string | null;
};

const INSTRUCTIONS = `Tu rapproches des tâches issues de réunions et de mails clients (Parade OS) avec les items d'une feuille de route de développement tenue dans le dépôt du produit.

Règles :
- Une paire n'est proposée que si la tâche demande la même chose que l'item, ou en est un sous-ensemble direct. Une simple proximité de thème ne suffit pas.
- Une tâche correspond à un item au plus. Plusieurs tâches peuvent viser le même item.
- Les tâches qui sont des gestes humains (envoyer, relancer, demander, payer) ne correspondent à aucun item de développement.
- confidence : 0.9 et plus quand c'est la même demande ; 0.6 à 0.8 quand c'est très probable ; en dessous, ne pas proposer.
- reason : une phrase en français, concrète.
Réponds uniquement par les paires retenues.`;

/** Rapprochement LLM tâches ↔ items. Lève si le modèle n'est pas configuré. */
export async function suggestRoadmapLinks(
  tasks: MatchableTask[],
  items: FlatItem[],
): Promise<RoadmapSuggestion[]> {
  if (tasks.length === 0 || items.length === 0) return [];
  const { model, modelId } = await getOpenRouterModel();
  const prompt = [
    "Tâches Parade OS :",
    ...tasks.map(
      (t) =>
        `- [${t.id}] ${t.title}${t.kind ? ` (type : ${t.kind})` : ""}${
          t.description ? `\n  ${t.description.replace(/\s+/g, " ").slice(0, 400)}` : ""
        }`,
    ),
    "",
    "Items de la feuille de route :",
    ...items.map(
      (i) =>
        `- [${i.id}] (${i.epicName}, statut ${i.status}) ${i.title}${
          i.note ? `\n  ${i.note.replace(/\s+/g, " ").slice(0, 400)}` : ""
        }`,
    ),
  ].join("\n");

  const raw = await withLlmTimeout(
    { budgetMs: 120_000, modelId, label: "le rapprochement avec la feuille de route" },
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
  return pickSuggestions(raw, {
    taskIds: new Set(tasks.map((t) => t.id)),
    itemIds: new Set(items.map((i) => i.id)),
  });
}
