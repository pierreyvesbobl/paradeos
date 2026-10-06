import { dougsFetch } from "./http";

export type DougsAgingBalance = {
  globalRanges?: unknown;
  customerRanges?: unknown;
  [key: string]: unknown;
};

export async function getDougsAgingBalance(userId: string): Promise<DougsAgingBalance> {
  const res = await dougsFetch(userId, "/companies/{companyId}/invoice-stats/aging-balance");
  return res.json();
}

export type DougsAgingBucket = {
  /** Libellé de la tranche tel que rendu ("0-30 j", "> 90 j", …). */
  label: string;
  amount: number;
};

const AGING_AMOUNT_KEYS = ["amount", "total", "value", "totalAmount", "sum"] as const;
const AGING_LABEL_KEYS = ["label", "name", "range", "key", "title"] as const;

function pickNumber(o: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function pickString(o: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}

/**
 * Normalise `globalRanges` en tranches exploitables. Accepte les deux
 * formes plausibles :
 *  - tableau d'objets `[{ label, amount }, …]`
 *  - dictionnaire `{ "0-30": 1234, "30-60": … }` (valeur nombre ou objet)
 *
 * Toute forme inattendue renvoie `[]` plutôt que de lever : cette donnée
 * est un confort d'affichage, elle ne doit jamais casser la page.
 */
export function parseDougsAgingBuckets(raw: unknown): DougsAgingBucket[] {
  if (!raw) return [];
  const out: DougsAgingBucket[] = [];

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const o = entry as Record<string, unknown>;
      const amount = pickNumber(o, AGING_AMOUNT_KEYS);
      if (amount === null) continue;
      out.push({ label: pickString(o, AGING_LABEL_KEYS) ?? "—", amount });
    }
    return out;
  }

  if (typeof raw === "object") {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        out.push({ label: key, amount: value });
        continue;
      }
      if (value && typeof value === "object") {
        const amount = pickNumber(value as Record<string, unknown>, AGING_AMOUNT_KEYS);
        if (amount !== null) {
          out.push({
            label: pickString(value as Record<string, unknown>, AGING_LABEL_KEYS) ?? key,
            amount,
          });
        }
      }
    }
  }
  return out;
}

/** Total dû côté Dougs, toutes tranches confondues. */
export function sumDougsAging(buckets: DougsAgingBucket[]): number {
  return buckets.reduce((s, b) => s + b.amount, 0);
}

// ---------- Factures d'achat (fournisseurs) ----------

/**
 * Facture d'achat Dougs. Champs alignés sur ce que renvoie
 * `GET /companies/{id}/vendor-invoices` (pagination `page`/`limit`,
 * différente des factures de vente qui utilisent `limit`/`offset`).
 */
