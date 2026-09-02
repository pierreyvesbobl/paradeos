import "server-only";

import { DEFAULT_LLM_MODEL } from "@/lib/schemas/integrations";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { createOpenAI } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/**
 * Schéma d'extraction métadonnées de facture. Tous champs nullable — le
 * LLM peut ne pas trouver l'info (cas litigieux : la PJ est marquée
 * `rejected` et reste à traiter manuellement).
 *
 * `documentKind` porte la distinction achat/vente : une facture émise par
 * Parade et reçue en copie n'est pas une non-facture, c'est une facture de
 * VENTE — on la détecte et on la tague sans la classer dans Drive.
 */
const invoiceSchema = z.object({
  /**
   * Nature du document :
   *   - `purchase_invoice` : facture d'ACHAT reçue d'un fournisseur.
   *   - `sales_invoice`    : facture de VENTE émise par Parade (reçue en
   *     copie : BCC compta, renvoi client, notification Dougs).
   *   - `other`            : devis, RIB, reçu CB, contrat, relance seule…
   */
  documentKind: z.enum(["purchase_invoice", "sales_invoice", "other"]),
  /** Date d'émission de la facture (YYYY-MM-DD). */
  invoiceDate: z.string().nullable(),
  /**
   * Nom de l'ÉMETTEUR de la facture (celui qui vend, qui sera payé).
   * Côté achat c'est le fournisseur ; côté vente c'est Parade.
   */
  supplierName: z.string().nullable(),
  /**
   * Nom du DESTINATAIRE de la facture (celui qui achète, qui paie).
   * Côté vente c'est le client ; côté achat c'est Parade.
   */
  customerName: z.string().nullable(),
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

/** Sens de la facture du point de vue de Parade. */
export type InvoiceDirection = "purchase" | "sale" | "unknown";

export function directionFromDocumentKind(kind: InvoiceMetadata["documentKind"]): InvoiceDirection {
  if (kind === "purchase_invoice") return "purchase";
  if (kind === "sales_invoice") return "sale";
  return "unknown";
}

const SYSTEM_PROMPT = `Tu reçois le contenu (texte) d'une pièce jointe extraite d'un email,
plus le sujet/expéditeur du mail. Tu dois déterminer la nature du document du
point de vue de l'entreprise Parade (SAS de coworking et conseil, basée à
Paris), et si c'est une facture, en extraire les métadonnées.

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

Remplis TOUJOURS supplierName (= émetteur) et customerName (= destinataire)
dès qu'il s'agit d'une facture, quel que soit le sens.

═══ CLASSIFICATION (documentKind) ═══

CAS A — documentKind = "purchase_invoice" : facture d'ACHAT.
  Émetteur = un tiers (fournisseur), Destinataire = Parade.
  C'est une dépense de Parade. → à classer dans Drive.

CAS B — documentKind = "sales_invoice" : facture de VENTE ⚠️.
  Émetteur = Parade (SAS Parade / Parade SAS / PARADE, avec son SIREN
  ou son RIB), Destinataire = un tiers client.
  Ces factures arrivent en copie côté Gmail (BCC comptable, renvoi du
  client, notification Dougs). Elles ne sont PAS classées ici (elles sont
  gérées via le rapprochement Dougs) mais elles DOIVENT être identifiées
  comme telles — surtout pas confondues avec un document non-facture.

  Indices que Parade est l'émetteur (au moindre doute → CAS B) :
  - "Parade", "Parade SAS", "PARADE" apparaît en position d'émetteur
    (entête haut, avec adresse/SIREN).
  - Le pied de page mentionne le RIB / IBAN de Parade.
  - Le préfixe de numéro de facture correspond au format Dougs de
    Parade (souvent "F-YYYY-…" ou similaire).
  - L'email vient d'une adresse Parade / d'une notification Dougs.

CAS C — documentKind = "other" : pas une facture du tout.
  - un devis / une proposition commerciale
  - un reçu de paiement carte / ticket restaurant
  - un RIB / IBAN seul
  - un contrat / CGV
  - un bon de commande
  - une relance / rappel de paiement seul, sans facture attachée
  → tous les autres champs à null.

Un AVOIR (note de crédit) suit le même axe que la facture qu'il annule :
avoir reçu d'un fournisseur → "purchase_invoice" ; avoir émis par Parade
pour un client → "sales_invoice".

═══ RÈGLES D'EXTRACTION (CAS A et CAS B) ═══

- invoiceDate : la date d'émission de la facture (et NON la date du
  virement, de la commande, ou la due date). Format YYYY-MM-DD.
- supplierName : le nom de l'ÉMETTEUR (celui qui sera payé). En général en
  haut de la facture avec l'adresse et le SIREN. Si c'est "Parade", alors
  documentKind DOIT être "sales_invoice".
- customerName : le nom du DESTINATAIRE (celui qui paie). Si c'est
  "Parade", alors documentKind DOIT être "purchase_invoice".
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
