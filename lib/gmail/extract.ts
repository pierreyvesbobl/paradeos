import "server-only";

import { parseEmailThread } from "@/lib/gmail/thread-parse";
import { formatVocabulary, getKnownVocabulary } from "@/lib/meetings/extract";
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
 * Schéma de sortie de l'extraction email.
 *
 * Parité avec les meetings sur les kinds qui ont du sens pour un email :
 * tâches, contacts, entités, projets. Les emails ont l'avantage unique de
 * porter des adresses email exactes (sender/recipients) — on en profite
 * pour matcher les contacts par email (plus précis que par nom) côté
 * persistence.
 *
 * Spécificités email vs meeting :
 * - intent : auto-classification du type d'email (info, request, etc.).
 * - proposedCategoryTags : tags catégorie libres ; le LLM ne peut piocher
 *   QUE dans la taxonomie existante (cf. système prompt).
 * - proposedProjectName : projet inféré pour AUTO-apply le tag projet
 *   correspondant si un projet en base matche (au-delà du contact match
 *   déjà géré par le sync). Distinct du nouveau `proposedProjects` qui
 *   propose la CRÉATION d'un projet inconnu.
 * - sensitiveDetected : sécurité — si true on ne persiste rien.
 */
const extractionSchema = z.object({
  summary: z.string(),
  intent: z.enum(["info", "request", "fyi", "decision", "follow_up", "compta", "admin", "other"]),
  /**
   * Stade pipeline du deal/projet sous-jacent :
   *   - lead        : premier contact commercial (prospection tiède/froide)
   *   - opportunity : deal actif (devis, négo, relance)
   *   - project     : delivery/opérationnel (post-signature)
   *   - none        : pas de dimension commerciale (compta, admin, info…)
   * Pilote le status suggéré à la création + affiche une suggestion de
   * changement de statut quand un projet existant est déjà matché.
   */
  pipelineStage: z.enum(["lead", "opportunity", "project", "none"]),
  proposedCategoryTags: z.array(z.string()),
  proposedProjectName: z.string().nullable(),
  proposedTasks: z.array(
    z.object({
      title: z.string(),
      dueDate: z.string().nullable(),
      projectName: z.string().nullable(),
      assigneeName: z.string().nullable(),
      priority: z.enum(["low", "normal", "high"]).nullable(),
    }),
  ),
  proposedEntities: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["client", "prospect", "partner", "supplier", "other"]).nullable(),
    }),
  ),
  proposedContacts: z.array(
    z.object({
      firstName: z.string(),
      // Nullable : forcer une chaîne pousse le modèle à écrire
      // littéralement "null" quand la signature ne donne qu'un prénom
      // (« Frédéric », m.frederic@…). Cette chaîne se propageait
      // ensuite jusqu'en base et à l'affichage.
      lastName: z.string().nullable(),
      email: z.string().nullable(),
      jobTitle: z.string().nullable(),
      entityName: z.string().nullable(),
    }),
  ),
  proposedProjects: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["client", "product", "transverse"]).nullable(),
      entityName: z.string().nullable(),
      status: z
        .enum(["not_started", "to_follow_up", "awaiting_response", "won", "planning", "active"])
        .nullable(),
      valueAmount: z.number().nullable(),
    }),
  ),
  /**
   * Vrai quand le mail appelle une action de l'utilisateur : une
   * question, une décision demandée, une relance à faire. Faux pour
   * les emails purement informatifs (newsletters, notifications, cc-info…).
   */
  needsReply: z.boolean(),
  /**
   * Brouillon de réponse suggéré. Rempli **uniquement** quand `needsReply`
   * est vrai. En français, ton naturel, signé "Pierre-Yves".
   */
  replyDraft: z
    .object({
      subject: z.string(),
      body: z.string(),
    })
    .nullable(),
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
  toEmails: string[];
  ccEmails: string[];
  bodyText: string | null;
  bodyHtml: string | null;
  /** Catégories existantes à proposer en priorité au LLM. */
  existingCategories: string[];
};

function buildSystemPrompt(args: {
  existingCategories: string[];
  vocab: Awaited<ReturnType<typeof getKnownVocabulary>>;
}): string {
  const baseRules = `Tu analyses un email professionnel reçu/envoyé et en extrais :
1. Un résumé court (2-3 phrases en français)
2. L'intention principale (info / request / fyi / decision / follow_up / compta / admin / other)
3. Le stade pipeline (lead / opportunity / project / none)
4. Les catégories libres pertinentes pour le ranger (Compta, Annexe, Admin, Support, etc.)
5. Le projet éventuellement mentionné dans le contenu (auto-apply)
6. Les tâches à faire qui ressortent
7. Les entités, contacts et projets NOUVEAUX évoqués (à créer dans le CRM)
8. Un brouillon de réponse si le mail attend une action

Règles générales :
- Reste factuel. Pas de paraphrase, pas d'extrapolation.
- Si un champ n'est pas explicite, retourne null (ou tableau vide pour les listes).
- Pour proposedCategoryTags : reste minimaliste. 0 à 2 catégories max. UNIQUEMENT depuis la liste des catégories existantes ci-dessous. **NE JAMAIS** proposer une catégorie qui n'est pas dans la liste — si aucune ne correspond, retourne un tableau vide. La taxonomie est gérée par l'utilisateur, pas par toi.
- Pour proposedTasks : uniquement les ACTIONS EXPLICITES ("merci de m'envoyer", "peux-tu vérifier", "il faut faire X"). Pas de tâches déduites/imaginées.
- dueDate au format YYYY-MM-DD si une date concrète est mentionnée.
- sensitiveDetected = true si tu repères des mots de passe, clés API, numéros bancaires, etc.

# Stade pipeline (pipelineStage)

Classifie l'affaire portée par cet email :
- **lead** : premier contact commercial, prospection tiède/froide, demande d'infos initiale, prise de contact avant tout devis. L'expéditeur n'est probablement pas encore dans le CRM.
- **opportunity** : deal actif — devis envoyé, négociation en cours, relance commerciale, réponse attendue avant signature.
- **project** : delivery/opérationnel — le deal est signé, on parle exécution, livraison, planning, retour, ajustement.
- **none** : pas de dimension commerciale (compta, admin, info interne, newsletter, notification, …).

# Réponse attendue (needsReply / replyDraft)

- **needsReply=true** quand le mail attend une action de ta part : question directe, décision à prendre, relance à faire, choix à valider, RDV à confirmer.
- **needsReply=false** pour les mails purement informatifs (Cc pour info, notification automatique, réponse "OK reçu" sans suite).
- Si **needsReply=true**, produis un **replyDraft** :
  - En français, ton naturel et concis (3 à 6 phrases max).
  - Signé "Pierre-Yves" en fin de mail.
  - subject préfixé "Re: " s'il ne l'est pas déjà.
  - **Aucune affirmation** qui ne soit pas vérifiable depuis le mail d'origine. Si un chiffre/nom/date est incertain, laisse un placeholder \`[À compléter]\`.
  - Ne t'engage pas à la place de l'utilisateur — propose des tournures ouvertes ("je te reviens sur", "je te propose de", "peux-tu me confirmer…").
- Si **needsReply=false**, replyDraft = null.

# Entités, contacts, projets — propositions de création

- **proposedEntities** : sociétés/organisations mentionnées qui ne sont PAS dans le vocabulaire existant. Ne re-propose JAMAIS une entité déjà connue. Si une entité connue correspond (même approximativement), on l'utilise comme \`entityName\` sur les contacts/projets mais on ne la propose pas à nouveau.
- **proposedContacts** : personnes mentionnées (sender, recipients dans le body, signatures) qui ne sont PAS déjà dans la liste des contacts connus. Pour chaque contact, donne son email si tu le trouves dans le body ou les en-têtes (l'email est le matcher le plus fiable). Toujours séparer firstName/lastName. Si le nom de famille est introuvable, mets la valeur JSON null, jamais la chaîne « null » ni un nom inventé.
- **proposedProjects** : projets/deals NOUVEAUX évoqués qui ne correspondent PAS à un projet déjà connu. Ne pas re-proposer un projet du vocabulaire. valueAmount en euros sans symbole si mentionné.

# Différence proposedProjectName vs proposedProjects

- \`proposedProjectName\` (string, singulier) : nom d'un projet **déjà existant** que cet email mentionne — sera auto-relié au thread comme tag projet. Utilise EXACTEMENT le nom du vocabulaire.
- \`proposedProjects\` (array) : projets NOUVEAUX à créer. Si le projet est connu, n'apparait QUE dans proposedProjectName.

${
  args.existingCategories.length > 0
    ? `Catégories existantes (UNIQUEMENT celles-ci, jamais en inventer) :\n${args.existingCategories.map((c) => `- ${c}`).join("\n")}`
    : "Aucune catégorie existante. Retourne donc proposedCategoryTags = []."
}`;

  const vocabBlock = formatVocabulary(args.vocab);
  if (vocabBlock.length === 0) return baseRules;

  return `${baseRules}

---

# Vocabulaire connu (utiliser EN PRIORITÉ, ne pas re-proposer)

Voici les noms canoniques déjà en base. Si l'email mentionne quelque chose qui leur ressemble — orthographe phonétique, acronyme, prénom seul, nom de famille seul, abréviation — alors retourne **l'orthographe exacte de la liste** dans entityName / projectName, et **ne re-propose pas l'entité/contact/projet** dans proposedEntities/proposedContacts/proposedProjects.

${vocabBlock}`;
}

function buildUserPrompt(input: EmailInput): string {
  const fromLine = input.fromName
    ? `De : ${input.fromName} <${input.fromEmail ?? "?"}>`
    : `De : ${input.fromEmail ?? "(inconnu)"}`;
  const toLine = input.toEmails.length > 0 ? `À : ${input.toEmails.join(", ")}` : null;
  const ccLine = input.ccEmails.length > 0 ? `Cc : ${input.ccEmails.join(", ")}` : null;
  const subject = `Sujet : ${input.subject ?? "(sans objet)"}`;

  // On envoie au LLM le corps propre (sans les quotes/forwards) — les
  // longs threads réassemblés dans un mail unique sont ainsi réduits à
  // leur intent réel, ce qui économise du token et améliore la qualité
  // de l'extraction. On donne un résumé du fil précédent en aparté pour
  // le contexte.
  const parsed = parseEmailThread({
    bodyText: input.bodyText,
    bodyHtml: input.bodyHtml,
  });
  let body = parsed.cleanText;
  if (body.length > MAX_BODY_CHARS_FOR_LLM) {
    body = `${body.slice(0, MAX_BODY_CHARS_FOR_LLM)}\n\n[…tronqué]`;
  }
  body = sanitizeForLlm(body);

  const historyBlock =
    parsed.quotes.length > 0
      ? `\n\n---\n\n# Historique du fil (pour contexte, ne pas re-résumer)\n\n${parsed.quotes
          .map((q) => `${q.header ?? "(quote)"}\n${q.body}`)
          .join("\n\n")
          .slice(0, 5_000)}`
      : "";

  const header = [fromLine, toLine, ccLine, subject].filter(Boolean).join("\n");
  return `${header}\n\n---\n\n${body}${historyBlock}`;
}

export async function extractEmail(input: EmailInput): Promise<EmailExtraction> {
  const apiKey = await getSetting(SETTING_KEYS.OPENROUTER_API_KEY);
  if (!apiKey) {
    throw new Error("Clé OpenRouter non configurée. Ajoute-la dans /settings/integrations.");
  }
  const modelId = (await getSetting(SETTING_KEYS.LLM_MODEL)) ?? DEFAULT_LLM_MODEL;

  const vocab = await getKnownVocabulary();

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
    system: buildSystemPrompt({ existingCategories: input.existingCategories, vocab }),
    prompt: buildUserPrompt(input),
    temperature: 0.2,
  });

  return object;
}
