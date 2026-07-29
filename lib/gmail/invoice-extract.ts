import "server-only";

import { DEFAULT_LLM_MODEL } from "@/lib/schemas/integrations";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Schéma d'extraction métadonnées de facture fournisseur. Tous champs
 * nullable — le LLM peut ne pas trouver l'info (cas litigieux : la
 * proposition est marquée error et reste manuelle).
 */
const invoiceSchema = z.object({
  /** Est-ce VRAIMENT une facture fournisseur reçue (pas devis, RIB, reçu CB) ? */
  isInvoice: z.boolean(),
  /** Date d'émission de la facture (YYYY-MM-DD). */
  invoiceDate: z.string().nullable(),
  /** Nom complet du fournisseur tel qu'il apparaît sur la facture. */
  supplierName: z.string().nullable(),
  /**
   * Description courte des prestations facturées en français
   * (CamelCase sans espaces, sans accents). Ex. "LoyerBureau",
   * "AbonnementLogiciel", "PrestationConseilIA".
   */
  prestationType: z.string().nullable(),
  /** Confiance globale du LLM 0-1. */
  confidence: z.number(),
});

export type InvoiceMetadata = z.infer<typeof invoiceSchema>;

const SYSTEM_PROMPT = `Tu reçois le contenu (texte) d'une pièce jointe extraite d'un email,
plus le sujet/expéditeur du mail. Tu dois déterminer si c'est une
**facture fournisseur reçue** par l'entreprise Parade (SAS de coworking
et conseil, basée à Paris), et si oui en extraire les métadonnées pour
la classer.

═══ RAISONNEMENT OBLIGATOIRE — 2 étapes avant de décider ═══

ÉTAPE 1 — Identifier l'ÉMETTEUR de la facture.
  L'émetteur est celui qui vend, qui sera payé. Sur la facture, c'est :
    - en haut à gauche/droite avec adresse + SIREN
    - dans le pied de page avec RIB / IBAN
    - dans le numéro de facture (souvent son préfixe : "F-", "FAC-", …)

ÉTAPE 2 — Identifier le DESTINATAIRE ("Facturé à" / "Client").
  Le destinataire est celui qui achète, qui paie. Généralement :
    - dans un bloc "Facturé à", "Client", "Adressé à"
    - avec adresse de facturation
    - sans coordonnées bancaires

═══ CLASSIFICATION ═══

CAS A — facture FOURNISSEUR (à classer) :
  Émetteur = un tiers (fournisseur), Destinataire = Parade.
  → isInvoice=true, remplis les champs.

CAS B — facture CLIENT (à REJETER) ⚠️ :
  Émetteur = Parade (SAS Parade / Parade SAS / PARADE, avec son SIREN
  ou son RIB), Destinataire = un tiers client.
  Ces factures arrivent en copie côté Gmail (BCC comptable, renvoi du
  client, notification Dougs) mais ne sont PAS à classer ici : elles
  sont déjà gérées via le rapprochement Dougs.
  → isInvoice=false, TOUS les autres champs à null.

  Indices que Parade est l'émetteur (au moindre doute → CAS B) :
  - "Parade", "Parade SAS", "PARADE" apparaît en position d'émetteur
    (entête haut, avec adresse/SIREN).
  - Le pied de page mentionne le RIB / IBAN de Parade.
  - Le préfixe de numéro de facture correspond au format Dougs de
    Parade (souvent "F-YYYY-…" ou similaire).
  - L'email vient d'une adresse Parade / d'une notification Dougs.

CAS C — pas une facture du tout :
  - un devis / une proposition commerciale
  - un reçu de paiement carte / ticket restaurant
  - un RIB / IBAN seul
  - un contrat / CGV
  - un bon de commande
  - une relance / rappel de paiement seul, sans facture attachée
  → isInvoice=false, autres champs null.

═══ RÈGLES D'EXTRACTION (uniquement pour CAS A) ═══

- invoiceDate : la date d'émission de la facture (et NON la date du
  virement, de la commande, ou la due date). Format YYYY-MM-DD.
- supplierName : le nom du FOURNISSEUR (= émetteur de la facture, celui
  qui sera payé). Pas le client (= Parade). En général c'est en haut de
  la facture avec l'adresse et le SIREN. Ne mets JAMAIS "Parade" ici —
  si le seul candidat émetteur commence par "Parade", c'est le CAS B
  → isInvoice=false.
- prestationType : 1-4 mots concaténés en CamelCase pour décrire ce qui
  est facturé. Pas d'accents, pas de caractères spéciaux. Ex.
  "LoyerBureau", "AbonnementSlack", "PrestationConseilIA",
  "MaterielInformatique", "FormationProduit".
- confidence : 0-1. Mets < 0.6 si tu doutes (la classification ne sera
  pas auto-faite, on demandera validation à l'utilisateur).`;

export async function extractInvoiceMetadata(args: {
  emailSubject: string | null;
  emailFrom: string | null;
  emailBody: string | null;
  pdfFilename: string;
  pdfText: string;
}): Promise<InvoiceMetadata> {
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

  const userPrompt = [
    `Sujet email : ${args.emailSubject ?? "(sans objet)"}`,
    `De : ${args.emailFrom ?? "(inconnu)"}`,
    `Nom de la PJ : ${args.pdfFilename}`,
    "",
    "Aperçu email (5 premières lignes) :",
    (args.emailBody ?? "").split("\n").slice(0, 5).join("\n").slice(0, 1_000),
    "",
    "---",
    "",
    "Contenu PDF :",
    args.pdfText,
  ].join("\n");

  const { object } = await generateObject({
    model: openrouter(modelId),
    schema: invoiceSchema,
    system: SYSTEM_PROMPT,
    prompt: userPrompt,
    temperature: 0.1,
  });

  return object;
}

// ─── Sanitization helpers (règles utilisateur) ─────────────────────────

/**
 * Convertit une string en CamelCase ASCII sans accents/special chars.
 *   "Société Générale" → "SocieteGenerale"
 *   "EDF Pro & Cie"     → "EDFProCie"
 *   "Bouygues-Telecom"  → "BouyguesTelecom"
 */
export function sanitizeForFilename(input: string): string {
  // 1. Décompose accents (NFD), retire les diacritiques (U+0300..U+036F).
  // Utilise l'échappement explicite pour satisfaire biome (noMisleadingCharacterClass).
  const decomposed = input.normalize("NFD").replace(/\p{M}/gu, "");
  // 2. Split sur tout caractère non-alphanumérique.
  const parts = decomposed.split(/[^A-Za-z0-9]+/).filter(Boolean);
  // 3. CamelCase : capitalise la 1ère lettre de chaque partie, garde
  //    le reste tel quel (préserve les majuscules de "EDF" / "SNCF").
  return parts.map((p) => (p[0] ? p[0].toUpperCase() + p.slice(1) : p)).join("");
}

/**
 * Construit le nom final selon la nomenclature :
 *   AAMMJJ_facture_TypeDePrestation_Fournisseur.pdf
 */
export function buildInvoiceFilename(args: {
  invoiceDate: Date;
  prestationType: string;
  supplierName: string;
}): string {
  const yy = String(args.invoiceDate.getFullYear()).slice(-2);
  const mm = String(args.invoiceDate.getMonth() + 1).padStart(2, "0");
  const dd = String(args.invoiceDate.getDate()).padStart(2, "0");
  const date = `${yy}${mm}${dd}`;
  const prestation = sanitizeForFilename(args.prestationType) || "Facture";
  const supplier = sanitizeForFilename(args.supplierName) || "Fournisseur";
  return `${date}_facture_${prestation}_${supplier}.pdf`;
}
