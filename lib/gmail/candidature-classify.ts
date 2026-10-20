import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { generateStructured } from "@/lib/llm/structured";
import { LLM_BUDGET_MS, withLlmTimeout } from "@/lib/llm/timeout";
import { DEFAULT_LLM_MODEL } from "@/lib/schemas/integrations";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const candidatureSchema = z.object({
  /** Vrai seulement si l'auteur cherche un emploi, un stage ou une alternance CHEZ NOUS. */
  isCandidature: z.boolean(),
  confidence: z.number().min(0).max(1),
  /** Prénom de l'auteur tel qu'il signe, ou null. */
  firstName: z.string().nullable(),
  /** Langue du mail, pour la réponse. */
  language: z.enum(["fr", "en", "other"]),
  /** Une phrase : qui, quoi, pour quand. */
  summary: z.string(),
});

export type CandidatureClassification = z.infer<typeof candidatureSchema>;

const SYSTEM_PROMPT = `Tu lis un e-mail reçu par une petite agence (Automato, automatisation et IA, Lyon). Dis si c'est une CANDIDATURE : une personne qui cherche un emploi, un stage, une alternance ou un apprentissage chez nous, spontanément ou en réponse à une offre, y compris une relance d'une candidature précédente.

N'est PAS une candidature : une demande de devis ou de formation, une offre de service d'un freelance ou d'une agence (prestataire qui propose de travailler POUR nous contre facture), une proposition commerciale, un mail d'un client, d'un partenaire ou d'une école qui propose ses étudiants en masse, une newsletter, une offre d'emploi reçue.

Réponds avec le schéma demandé. Si tu hésites, baisse la confiance plutôt que de trancher.`;

/**
 * Confirme par LLM qu'un mail repéré par les règles est bien une
 * candidature. C'est le dernier garde-fou avant l'envoi d'une réponse
 * automatique : on préfère laisser passer une candidature sans réponse
 * que répondre « pas de poste » à un client.
 */
export async function classifyCandidature(args: {
  subject: string | null;
  fromName: string | null;
  fromEmail: string | null;
  bodyText: string;
  attachmentNames: string[];
}): Promise<CandidatureClassification> {
  const apiKey = await getSetting(SETTING_KEYS.OPENROUTER_API_KEY);
  if (!apiKey) {
    throw new Error("Clé OpenRouter non configurée. Ajoute-la dans /settings/integrations.");
  }
  const modelId = (await getSetting(SETTING_KEYS.LLM_MODEL)) ?? DEFAULT_LLM_MODEL;
  const openrouter = createOpenAI({
    apiKey,
    baseURL: OPENROUTER_BASE_URL,
    headers: {
      "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL ?? "https://paradeos.vercel.app",
      "X-Title": "Paradeos",
    },
  });

  const prompt = [
    `Sujet : ${args.subject ?? "(sans objet)"}`,
    `De : ${args.fromName ?? ""} <${args.fromEmail ?? "inconnu"}>`,
    `Pièces jointes : ${args.attachmentNames.join(", ") || "(aucune)"}`,
    "",
    "Corps :",
    args.bodyText.slice(0, 6_000),
  ].join("\n");

  return withLlmTimeout(
    { budgetMs: LLM_BUDGET_MS.emailExtraction, modelId, label: "la lecture de la candidature" },
    (signal) =>
      generateStructured({
        abortSignal: signal,
        model: openrouter(modelId),
        schema: candidatureSchema,
        instructions: SYSTEM_PROMPT,
        prompt,
        temperature: 0,
      }),
  );
}
