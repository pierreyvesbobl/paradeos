/**
 * Normalisation des montants lus par le LLM avant écriture en base.
 * Module pur : partagé par le classement Gmail et le backfill Drive.
 */

/**
 * Montant au-delà duquel on considère que le LLM a lu un numéro de
 * facture, un SIREN ou un montant en centimes plutôt qu'un total. Parade
 * n'a pas de facture fournisseur à sept chiffres — mieux vaut un null
 * qu'un chiffre faux qui ferait échouer tous les rapprochements.
 */
const MAX_PLAUSIBLE_AMOUNT = 1_000_000;

/**
 * `number | null` du LLM → colonne `numeric(12,2)` de Postgres.
 * Renvoie `null` dès que la valeur n'est pas un montant plausible.
 */
export function toAmountColumn(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const abs = Math.abs(value);
  if (abs > MAX_PLAUSIBLE_AMOUNT) return null;
  return abs.toFixed(2);
}

/** Code ISO 4217 en majuscules, ou `null` si ce n'en est visiblement pas un. */
export function normalizeCurrency(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** Nettoie un numéro de facture : trim, et null si vide ou trop long. */
export function normalizeInvoiceNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) return null;
  return trimmed;
}
