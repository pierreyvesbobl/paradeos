import "server-only";

import {
  cachedGetDougsAgingBalance,
  cachedListDougsSalesInvoices,
  cachedListDougsVendorInvoices,
} from "./cache";
import {
  type DougsAgingBucket,
  type DougsPaymentHint,
  parseDougsAgingBuckets,
  pickDougsPaymentHint,
  sumDougsAging,
} from "./client";

/**
 * Signaux Dougs "de confort" : données lues chez Dougs qui enrichissent
 * un écran sans en être la source de vérité.
 *
 * Règle commune à tout ce module : Dougs n'est jamais un point de
 * défaillance de la page. Un cookie expiré, un timeout Cloudflare ou un
 * changement de schéma côté Dougs doit dégrader l'affichage (pas de
 * badge, pas de bandeau), jamais faire tomber /compta?tab=relances qui
 * fonctionne très bien sur les seules données Paradeos.
 */

function warn(what: string, err: unknown): void {
  console.warn(`[dougs] ${what} indisponible :`, err instanceof Error ? err.message : err);
}

/**
 * Encaissements détectés par Dougs mais pas encore rapprochés,
 * indexés par id de facture Dougs.
 *
 * Sert à ne pas relancer un client qui a déjà payé : le virement est
 * visible dans le flux bancaire et Dougs l'a rattaché tout seul à la
 * facture, mais tant que le comptable n'a pas validé l'écriture,
 * `paidAt` reste `null` et la facture nous paraît impayée.
 */
export async function getDougsPaymentHints(userId: string): Promise<Map<string, DougsPaymentHint>> {
  const map = new Map<string, DougsPaymentHint>();
  try {
    const invoices = await cachedListDougsSalesInvoices(userId, { limit: 200 });
    for (const inv of invoices) {
      if (!inv?.id) continue;
      // Une facture déjà marquée payée n'a pas besoin d'indice.
      if (inv.paidAt) continue;
      const hint = pickDougsPaymentHint(inv);
      if (hint) map.set(String(inv.id), hint);
    }
  } catch (err) {
    warn("pré-matchs bancaires", err);
  }
  return map;
}

export type DougsAgingSummary = {
  buckets: DougsAgingBucket[];
  total: number;
};

/**
 * Balance âgée Dougs. On s'en sert comme contrôle croisé : si Dougs
 * voit nettement plus d'impayé que Paradeos, c'est le symptôme d'une
 * facture émise depuis Dougs qui n'a jamais été redescendue chez nous.
 */
export async function getDougsAgingSummary(userId: string): Promise<DougsAgingSummary | null> {
  try {
    const raw = await cachedGetDougsAgingBalance(userId);
    const buckets = parseDougsAgingBuckets(raw?.globalRanges ?? raw?.customerRanges);
    if (buckets.length === 0) return null;
    return { buckets, total: sumDougsAging(buckets) };
  } catch (err) {
    warn("balance âgée", err);
    return null;
  }
}

/** Factures d'achat Dougs, tolérant à l'indisponibilité. */
export async function getDougsVendorInvoicesSafe(userId: string, limit = 100) {
  try {
    return await cachedListDougsVendorInvoices(userId, { limit });
  } catch (err) {
    warn("factures d'achat", err);
    return null;
  }
}
