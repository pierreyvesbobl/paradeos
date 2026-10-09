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
 * Valeur approximative d'une unité de devise en euros. Pas un taux de
 * conversion : une bande de plausibilité. Une facture en dollars n'est
 * jamais débitée au centime — la banque convertit au cours du jour — mais
 * le débit tombe toujours à quelques pour cent de la facture convertie.
 * Les abonnements de Parade en dollars (OpenRouter, ElevenLabs, Supabase,
 * X) sont ainsi reconnus par le montant comme ceux en euros.
 */
const FX_REFERENCE_TO_EUR: Record<string, number> = {
  USD: 0.88,
  GBP: 1.16,
  CHF: 1.06,
};

/**
 * Écart relatif toléré autour de la référence. Observé sur les débits
 * Qonto d'un mois : 0,86 à 0,90 € pour 1 $. Assez large pour encaisser
 * la dérive du cours sur un an ou deux, assez étroit pour qu'un montant
 * voisin à 15 % ne passe pas pour le même.
 */
const FX_TOLERANCE = 0.08;

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
 * Proximité de date minimale pour attacher sans demander : la facture et
 * le débit sont à quelques jours l'un de l'autre (cf. la fenêtre de
 * `similarityInvoiceToPaymentDate`).
 */
const CERTAIN_DATE_MIN = 0.9;

/**
 * Un second candidat ne bloque l'attachement que s'il est une vraie
 * « jumelle » : même montant au centime ET lui aussi dans la fenêtre de
 * paiement. Deux factures ElevenLabs à 5 $ le même mois doivent atterrir
 * dans la file de validation, jamais sur une opération au hasard. Mais la
 * facture du mois précédent, au même prix et à trente jours, n'est pas
 * une alternative crédible : c'est la proximité de date qui tranche.
 */
const TWIN_DATE_MIN = 0.5;

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
  /** Devise ISO 4217 de la facture. `null` ou `EUR` : comparaison au centime. */
  currency?: string | null;
};

export type VendorMatchScore = {
  total: number;
  amount: number;
  supplier: number;
  date: number;
  /** Les deux montants coïncident au centime — le signal le plus fort. */
  amountExact: boolean;
  /**
   * Facture en devise : le débit en euros tombe dans la bande de change
   * de la facture convertie. Vaut un montant exact pour le verdict.
   */
  amountFx: boolean;
  /** Score écrasé par le plancher fournisseur ; sous-scores gardés pour le debug. */
  rejectedOnSupplier?: boolean;
};

function parseDay(value: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(`${value.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(time) ? null : time / 86_400_000;
}

/**
 * Proximité des dates. Les dépenses de Parade sont presque toutes des
 * abonnements mensuels au même prix : le montant ne départage pas deux
 * factures consécutives, seule la date le fait. La fenêtre pleine est
 * donc courte — quelques jours de part et d'autre du débit — et le score
 * tombe à zéro avant trente jours, pour que la facture du mois précédent
 * ne compte plus. Légèrement asymétrique : une facture précède en général
 * son paiement, mais une quittance d'assurance arrive aussi quelques
 * jours après le prélèvement.
 */
export function similarityInvoiceToPaymentDate(
  invoiceDate: string | null,
  operationDate: string | null,
): number {
  const invoice = parseDay(invoiceDate);
  const operation = parseDay(operationDate);
  if (invoice === null || operation === null) return 0;

  const delta = operation - invoice;
  if (delta >= -7 && delta <= 10) return 1;
  if (delta > 10) return delta >= 28 ? 0 : 1 - (delta - 10) / 18;
  return delta <= -14 ? 0 : 1 - (-delta - 7) / 7;
}

/**
 * Compare le débit (en euros) au total de la facture, dans sa devise.
 *   - facture en euros : exact au centime, ou similarité dégressive ;
 *   - facture en devise connue : plausible si le débit est à quelques
 *     pour cent de la facture convertie à la référence ;
 *   - devise inconnue : similarité brute, sans prétendre à l'exactitude.
 */
function compareAmounts(
  opAmount: number | null,
  docAmount: number | null,
  currency: string | null | undefined,
): { amount: number; amountExact: boolean; amountFx: boolean } {
  if (opAmount === null || docAmount === null || opAmount <= 0 || docAmount <= 0) {
    return { amount: 0, amountExact: false, amountFx: false };
  }

  const code = currency?.trim().toUpperCase() || "EUR";
  if (code === "EUR") {
    const amountExact = Math.abs(opAmount - docAmount) <= AMOUNT_EXACT_EPSILON;
    return {
      amount: amountExact ? 1 : similarityAmount(opAmount, docAmount),
      amountExact,
      amountFx: false,
    };
  }

  const reference = FX_REFERENCE_TO_EUR[code];
  if (reference === undefined) {
    return { amount: similarityAmount(opAmount, docAmount), amountExact: false, amountFx: false };
  }

  const converted = docAmount * reference;
  const deviation = Math.abs(opAmount / converted - 1);
  const amountFx = deviation <= FX_TOLERANCE;
  // Légèrement sous 1 : à montant égal, une facture en euros au centime
  // passe devant une facture en devise « à peu près ».
  return {
    amount: amountFx ? 1 - deviation : similarityAmount(opAmount, converted),
    amountExact: false,
    amountFx,
  };
}

export function scoreOperationDocument(op: OperationSide, doc: DocumentSide): VendorMatchScore {
  const opAmount = typeof op.amount === "number" ? Math.abs(op.amount) : null;
  const docAmount = typeof doc.amountTtc === "number" ? doc.amountTtc : null;

  const { amount, amountExact, amountFx } = compareAmounts(opAmount, docAmount, doc.currency);
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
      amountFx,
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
    amountFx,
  };
}

/** Le montant désigne la même dépense : au centime, ou dans la bande de change. */
function amountMatches(score: VendorMatchScore): boolean {
  return score.amountExact || score.amountFx;
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
 * montant au centime (ou dans la bande de change pour une facture en
 * devise), fournisseur reconnu, date à quelques jours, **et**
 * aucune jumelle — un autre document au même montant, lui aussi dans la
 * fenêtre de paiement. Deux factures ElevenLabs à 5 $ dans le même mois
 * se neutralisent et repartent en validation ; la facture du mois
 * précédent, elle, ne compte pas. Un candidat à un autre montant n'est
 * jamais une alternative : le montant est le signal le plus fiable.
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
  const hasTwin = scored
    .slice(1)
    .some((c) => amountMatches(c.score) && c.score.date >= TWIN_DATE_MIN);

  const certain =
    amountMatches(best.score) &&
    best.score.supplier >= CERTAIN_SUPPLIER_MIN &&
    best.score.date >= CERTAIN_DATE_MIN &&
    !hasTwin;

  return scored.slice(0, limit).map((candidate, index) => ({
    ...candidate,
    confidence: (index === 0 && certain ? "certain" : "probable") as MatchConfidence,
  }));
}
