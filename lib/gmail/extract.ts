import "server-only";

import { DEFAULT_LLM_MODEL } from "@/lib/schemas/integrations";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Cap : on n'extrait pas les emails trop longs (newsletters, threads
 * réassemblés > 50k chars). Le snippet + le subject suffisent à
 * comprendre, ça vaut pas le coût LLM.
 */
export const MAX_BODY_CHARS_FOR_LLM = 50_000;

/**
 * Schéma de sortie de l'extraction. Volontairement minimal vs le
 * meeting extraction : pas de proposition de contacts/entités (on les
 * a déjà via le CRM + auto-tag). On focus sur les ACTIONS et la
 * CATÉGORISATION.
 */
const extractionSchema = z.object({
  /** Résumé 2-3 phrases en français. */
  summary: z.string(),
  /** Intention de l'email (auto-classification de base). */
  intent: z.enum(["info", "request", "fyi", "decision", "follow_up", "compta", "admin", "other"]),
  /**
   * Catégories libres à appliquer (correspondent à un `gmail_tag` de
   * kind='category'). Le LLM peut proposer des catégories existantes ou
   * nouvelles. Côté serveur on matche fuzzy.
   * Exemples : "Compta", "Annexe", "Admin", "Support", "Recrutement".
   */
  proposedCategoryTags: z.array(z.string()),
  /**
   * Nom du projet inféré du contenu, au-delà du contact match (ex. l'email
   * mentionne explicitement "le projet X" sans que le destinataire soit
   * encore lié au CRM).
   */
  proposedProjectName: z.string().nullable(),
  /** Tâches à proposer pour création. */
  proposedTasks: z.array(
    z.object({
      title: z.string(),
      dueDate: z.string().nullable(),
      projectName: z.string().nullable(),
      assigneeName: z.string().nullable(),
      priority: z.enum(["low", "normal", "high"]).nullable(),
    }),
  ),
  /** Sécurité : true si le body contient des secrets / credentials. */
  sensitiveDetected: z.boolean(),
});

export type EmailExtraction = z.infer<typeof extractionSchema>;

/**
 * Strip les patterns sensibles avant envoi LLM. Best-effort — on ne
 * peut pas garantir l'exhaustivité, mais on couvre les cas évidents.
 */
function sanitizeForLlm(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi, "Bearer [REDACTED_TOKEN]")
    .replace(/AKIA[A-Z0-9]{16}/g, "[REDACTED_AWS_KEY]")
    .replace(/ghp_[A-Za-z0-9]{30,}/g, "[REDACTED_GITHUB_PAT]")
    .replace(/eyJ[A-Za-z0-9._-]{50,}/g, "[REDACTED_JWT]");
}

type EmailInput = {
  subject: string | null;
  fromEmail: string | null;
  fromName: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  /** Catégories existantes à proposer en priorité au LLM. */
  existingCategories: string[];
};

function buildSystemPrompt(args: { existingCategories: string[] }): string {
  return `Tu analyses un email professionnel reçu/envoyé et en extrais :
1. Un résumé court (2-3 phrases en français)
2. L'intention principale (info / request / fyi / decision / follow_up / compta / admin / other)
3. Les catégories libres pertinentes pour le ranger (Compta, Annexe, Admin, Support, etc.)
4. Le projet éventuellement mentionné dans le contenu
5. Les tâches à faire qui ressortent

Règles :
- Reste factuel. Pas de paraphrase, pas d'extrapolation.
- Si un champ n'est pas explicite, retourne null (ou tableau vide pour les listes).
- Pour proposedCategoryTags : reste minimaliste. 0 à 2 catégories max. UNIQUEMENT depuis la liste des catégories existantes ci-dessous. **NE JAMAIS** proposer une catégorie qui n'est pas dans la liste — si aucune ne correspond, retourne un tableau vide. La taxonomie est gérée par l'utilisateur, pas par toi.
- Pour proposedTasks : uniquement les ACTIONS EXPLICITES ("merci de m'envoyer", "peux-tu vérifier", "il faut faire X"). Pas de tâches déduites/imaginées.
- dueDate au format YYYY-MM-DD si une date concrète est mentionnée.
- sensitiveDetected = true si tu repères des mots de passe, clés API, numéros bancaires, etc.

${
  args.existingCategories.length > 0
    ? `Catégories existantes (UNIQUEMENT celles-ci, jamais en inventer) :\n${args.existingCategories.map((c) => `- ${c}`).join("\n")}`
    : "Aucune catégorie existante. Retourne donc proposedCategoryTags = []."
}`;
}

function buildUserPrompt(input: EmailInput): string {
  const fromLine = input.fromName
    ? `De : ${input.fromName} <${input.fromEmail ?? "?"}>`
    : `De : ${input.fromEmail ?? "(inconnu)"}`;
  const subject = `Sujet : ${input.subject ?? "(sans objet)"}`;
  // Préfère text si dispo, sinon strip HTML grossièrement.
  let body = input.bodyText ?? "";
  if (!body && input.bodyHtml) {
    body = input.bodyHtml
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  if (body.length > MAX_BODY_CHARS_FOR_LLM) {
    body = `${body.slice(0, MAX_BODY_CHARS_FOR_LLM)}\n\n[…tronqué]`;
  }
  body = sanitizeForLlm(body);
  return `${fromLine}\n${subject}\n\n---\n\n${body}`;
}

export async function extractEmail(input: EmailInput): Promise<EmailExtraction> {
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

  const { object } = await generateObject({
    model: openrouter(modelId),
    schema: extractionSchema,
    system: buildSystemPrompt({ existingCategories: input.existingCategories }),
    prompt: buildUserPrompt(input),
    temperature: 0.2,
  });

  return object;
}
