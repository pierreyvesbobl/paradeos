import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { generateStructured } from "@/lib/llm/structured";
import { LLM_BUDGET_MS, withLlmTimeout } from "@/lib/llm/timeout";
import { DEFAULT_LLM_MODEL } from "@/lib/schemas/integrations";
import { getSetting, SETTING_KEYS } from "@/lib/settings";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const candidatureSchema = z.object({
  /**
   * `candidature` : l'auteur cherche un emploi, un stage ou une alternance
   * CHEZ NOUS. `prestation` : l'auteur (freelance, agence, société) nous
   * propose ses services, un renfort, de la sous-traitance ou une
   * « collaboration » où il travaillerait POUR nous contre facture, sans
   * qu'on l'ait sollicité. `none` : tout le reste.
   */
  kind: z.enum(["candidature", "prestation", "none"]),
  confidence: z.number().min(0).max(1),
  /** Prénom de l'auteur tel qu'il signe, ou null. */
  firstName: z.string().nullable(),
  /** Langue du mail, pour la réponse. */
  language: z.enum(["fr", "en", "other"]),
  /** Une phrase : qui, quoi, pour quand. */
  summary: z.string(),
});

export type CandidatureClassification = z.infer<typeof candidatureSchema>;

const SYSTEM_PROMPT = `Tu lis un e-mail reçu par une petite agence (Automato, automatisation et IA, Lyon). Classe-le :

- "candidature" : une personne cherche un emploi, un stage, une alternance ou un apprentissage chez nous, spontanément ou en réponse à une offre, y compris une relance d'une candidature précédente.
- "prestation" : une personne ou une société que nous n'avons pas sollicitée nous propose de travailler POUR nous contre rémunération : freelance en quête de missions, renfort ou sous-traitance (Make, n8n, développement, design, marketing…), agence offshore, « proposition de collaboration » ou « partenariat » dont le fond est de nous vendre ses bras ou son temps, offre de mise à disposition de développeurs. Le mail parle de ses compétences, de ses disponibilités, propose un échange ou un pilote.
- "none" : tout le reste. En particulier : un client ou prospect qui veut acheter NOS services (demande de devis, de formation, d'audit), un partenaire ou un client avec qui une conversation est déjà engagée (échange en cours, réponse à un de nos mails, personne en copie d'une discussion entre tiers), une proposition commerciale où l'on nous vend un produit ou un logiciel (SaaS, licence, abonnement, publicité), une école qui place ses étudiants en masse, une newsletter, une offre d'emploi reçue, un recruteur qui chasse pour un autre employeur.

Réponds avec le schéma demandé. Un refus automatique partira si tu réponds "candidature" ou "prestation" : si tu hésites, baisse la confiance plutôt que de trancher, et préfère "none" quand le mail pourrait venir d'un client ou d'un partenaire réel.`;

/**
 * Confirme par LLM qu'un mail repéré par les règles est bien une
 * candidature ou une offre de prestation, et dit laquelle. C'est le
 * dernier garde-fou avant l'envoi d'une réponse automatique : on préfère
 * laisser passer une sollicitation sans réponse que répondre « non » à un
 * client.
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
    { budgetMs: LLM_BUDGET_MS.emailExtraction, modelId, label: "la lecture de la sollicitation" },
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
