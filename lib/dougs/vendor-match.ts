import { normalizeSupplierKey } from "@/lib/gmail/supplier-key";
import { similarityAmount, similarityName } from "./match";

/**
 * Rapprochement facture d'achat ↔ opération bancaire. Module pur : ni
 * base, ni réseau, ni Dougs — pour que la règle métier soit testable
 * seule, comme `lib/dougs/match.ts` l'est côté ventes.
 *
 * Pondération inverse de celle des ventes (nom 50 / montant 30 / date 20).
 * Ici le montant TTC est un quasi-identifiant : il se lit sur la facture
 * et sur le relevé, au centime près. Le nom, lui, arrive tronqué et
 * décoré par la banque. D'où : montant 50, fournisseur 35, date 15.
 */

const WEIGHT_AMOUNT = 0.5;
const WEIGHT_SUPPLIER = 0.35;
const WEIGHT_DATE = 0.15;

/** Écart en dessous duquel deux montants sont « le même » (arrondi comptable). */
const AMOUNT_EXACT_EPSILON = 0.01;

/**
 * Plancher de similarité fournisseur, même rôle que `NAME_MATCH_FLOOR`
 * côté ventes : sans lui, un montant parfait suffirait à rapprocher
 * n'importe quel abonnement de n'importe quel autre au même prix. Or le
 * dossier contient des dizaines d'abonnements mensuels à 5, 20 ou 30 €.
 */
const SUPPLIER_MATCH_FLOOR = 0.35;

/** Au-delà, le rapprochement peut être proposé à la validation. */
export const PROBABLE_THRESHOLD = 0.45;

/** En deçà, on ne parle plus d'un même fournisseur — pas d'attachement auto. */
const CERTAIN_SUPPLIER_MIN = 0.6;

/**
 * Écart minimal entre le meilleur candidat et le suivant pour attacher
 * sans demander. Deux factures ElevenLabs à 5 $ le même mois doivent
 * atterrir dans la file de validation, jamais sur une opération au hasard.
 */
const CERTAIN_LEAD_MIN = 0.15;

// ---------------------------------------------------------------------
// Libellés bancaires
// ---------------------------------------------------------------------

/**
 * Décorations que les banques ajoutent autour du nom du commerçant. On
 * les retire avant d'essayer de reconnaître un fournisseur.
 */
const BANK_NOISE = new Set([
  "prlv",
  "prel",
  "prelev",
  "prelevement",
  "prelevements",
  "europeen",
  "sepa",
  "vir",
  "virement",
  "inst",
  "instantane",
  "cb",
  "carte",
  "achat",
  "achats",
  "paiement",
  "paiment",
  "retrait",
  "dab",
  "facture",
  "facturation",
  "fact",
  "ref",
  "mandat",
  "ech",
  "echeance",
  "tip",
  "du",
  "de",
  "la",
  "le",
  "les",
  "des",
  "et",
  "sarl",
  "sas",
  "sa",
]);

/** Extensions de domaine collées au nom du marchand (« elevenlabs.io »). */
const TLD_SUFFIX = /\.(com|fr|io|net|org|co|ai|eu|dev|app|cloud|shop|de|es|it|uk)\b/g;

/**
 * Réduit un libellé de relevé à une clé fournisseur comparable à celle
 * d'une facture.
 *
 *   « PRLV SEPA OVH SAS 1234 »   → "ovh"
 *   « CB MAXICOFFEE 15/03 »      → "maxicoffee"
 *   « ACHAT CB ELEVENLABS.IO »   → "elevenlabs"
 *
 * Chaîne vide quand il ne reste que du bruit (virement interne, salaire) :
 * l'appelant doit alors s'abstenir plutôt que deviner.
 */
export function wordingToSupplierKey(wording: string | null | undefined): string {
  if (!wording) return "";

  const cleaned = wording
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(TLD_SUFFIX, " ")
    // Dates et références numériques : 15/03, 12.03.26, 0912, X1234.
    .replace(/\b\d{1,4}[/.-]\d{1,2}([/.-]\d{2,4})?\b/g, " ")
    .replace(/\b[a-z]?\d{2,}[a-z]?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ");

  const tokens = cleaned
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !BANK_NOISE.has(t));

  if (tokens.length === 0) return "";
  return normalizeSupplierKey(tokens.join(" "));
}

// ---------------------------------------------------------------------
// Score
// ---------------------------------------------------------------------

export type OperationSide = {
  /** Montant signé du relevé : négatif pour un décaissement. */
  amount: number | null;
  /** Date de l'opération, `YYYY-MM-DD`. */
  date: string | null;
  wording: string | null;
};

export type DocumentSide = {
  /** Total TTC de la facture, positif. */
  amountTtc: number | null;
  /** Date d'émission de la facture, `YYYY-MM-DD`. */
  invoiceDate: string | null;
  supplierKey: string | null;
};

export type VendorMatchScore = {
  total: number;
  amount: number;
  supplier: number;
  date: number;
  /** Les deux montants coïncident au centime — le signal le plus fort. */
  amountExact: boolean;
  /** Score écrasé par le plancher fournisseur ; sous-scores gardés pour le debug. */
  rejectedOnSupplier?: boolean;
};

function parseDay(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(time) ? null : time / 86_400_000;
}

/**
 * Proximité des dates, volontairement asymétrique : une facture précède
 * son paiement. On tolère largement après (prélèvement à 30 jours, relance),
 * très peu avant (un paiement d'avance existe, mais reste l'exception).
 */
export function similarityInvoiceToPaymentDate(
  invoiceDate: string | null,
  operationDate: string | null,
): number {
  const invoice = parseDay(invoiceDate);
  const operation = parseDay(operationDate);
  if (invoice === null || operation === null) return 0;

  const delta = operation - invoice;
  if (delta >= -3 && delta <= 45) return 1;
  if (delta > 45) return delta >= 120 ? 0 : 1 - (delta - 45) / 75;
  return delta <= -15 ? 0 : 1 - (-delta - 3) / 12;
}

export function scoreOperationDocument(op: OperationSide, doc: DocumentSide): VendorMatchScore {
  const opAmount = typeof op.amount === "number" ? Math.abs(op.amount) : null;
  const docAmount = typeof doc.amountTtc === "number" ? doc.amountTtc : null;

  const amountExact =
    opAmount !== null &&
    docAmount !== null &&
    opAmount > 0 &&
    Math.abs(opAmount - docAmount) <= AMOUNT_EXACT_EPSILON;

  const amount = amountExact ? 1 : similarityAmount(opAmount ?? 0, docAmount ?? 0);
  const date = similarityInvoiceToPaymentDate(doc.invoiceDate, op.date);

  const opKey = wordingToSupplierKey(op.wording);
  const supplier = opKey && doc.supplierKey ? similarityName(opKey, doc.supplierKey) : 0;

  const round = (n: number) => Math.round(n * 1000) / 1000;

  if (supplier < SUPPLIER_MATCH_FLOOR) {
    return {
      total: 0,
      amount: round(amount),
      supplier: round(supplier),
      date: round(date),
      amountExact,
      rejectedOnSupplier: true,
    };
  }

  const total = amount * WEIGHT_AMOUNT + supplier * WEIGHT_SUPPLIER + date * WEIGHT_DATE;
  return {
    total: round(total),
    amount: round(amount),
    supplier: round(supplier),
    date: round(date),
    amountExact,
  };
}

// ---------------------------------------------------------------------
// Classement et verdict
// ---------------------------------------------------------------------

export type MatchConfidence = "certain" | "probable";

export type RankedMatch<T> = {
  document: T;
  score: VendorMatchScore;
  confidence: MatchConfidence;
};

/**
 * Classe les documents candidats pour une opération et décide lesquels
 * sont attachables sans demander.
 *
 * Un seul candidat peut être `certain`, et seulement si tout concorde :
 * montant au centime, fournisseur reconnu, date cohérente, **et** aucun
 * second candidat qui se tienne. C'est ce dernier point qui protège des
 * abonnements récurrents au même prix — deux factures ElevenLabs à 5 $
 * dans le même mois se neutralisent et repartent en validation.
 */
export function rankMatchesForOperation<T>(
  op: OperationSide,
  documents: readonly T[],
  read: (doc: T) => DocumentSide,
  { limit = 4 }: { limit?: number } = {},
): RankedMatch<T>[] {
  const scored = documents
    .map((document) => ({ document, score: scoreOperationDocument(op, read(document)) }))
    .filter((c) => c.score.total >= PROBABLE_THRESHOLD)
    .sort((a, b) => b.score.total - a.score.total);

  const best = scored[0];
  if (!best) return [];
  const runnerUp = scored[1];

  const certain =
    best.score.amountExact &&
    best.score.supplier >= CERTAIN_SUPPLIER_MIN &&
    best.score.date >= 0.9 &&
    (runnerUp === undefined || best.score.total - runnerUp.score.total >= CERTAIN_LEAD_MIN);

  return scored.slice(0, limit).map((candidate, index) => ({
    ...candidate,
    confidence: (index === 0 && certain ? "certain" : "probable") as MatchConfidence,
  }));
}
