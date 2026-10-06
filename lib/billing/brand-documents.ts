import "server-only";

/**
 * Résolution complète des mentions d'un document, défauts de marque et
 * conditions du deal compris, **plus** le logo lu en base.
 *
 * Pourquoi un module à part : `brand-templates.ts` et `billing-terms.ts` sont
 * purs et testables sans DB. Le logo, lui, est un réglage éditable
 * (`app_settings`), donc sa lecture appartient au serveur. On garde la frontière
 * nette plutôt que de faire fuiter un accès base dans les modules purs.
 */

import type { InvoiceBrand } from "@/db/schema/invoices";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { type ResolvedBillingTerms, resolveBillingTerms } from "./billing-terms";

const LOGO_KEYS: Record<InvoiceBrand, (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS]> = {
  coworking: SETTING_KEYS.BRAND_LOGO_COWORKING,
  automato: SETTING_KEYS.BRAND_LOGO_AUTOMATO,
  parade: SETTING_KEYS.BRAND_LOGO_PARADE,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Logo réglé en base pour cette marque, `null` si rien de valide. */
export async function getBrandLogoUuid(brand: InvoiceBrand): Promise<string | null> {
  const value = (await getSetting(LOGO_KEYS[brand]))?.trim();
  // Une valeur mal collée ne doit pas produire un `logoUuid` que Dougs
  // refuserait : on l'ignore et on retombe sur l'UUID épinglé dans le code.
  return value && UUID.test(value) ? value : null;
}

/**
 * Ce qu'il faut poser sur le document, tout résolu. Les trois niveaux, du plus
 * général au plus spécifique : marque → deal → logo réglé en base.
 */
export async function resolveInvoiceDocument(
  brand: InvoiceBrand,
  dealTerms?: unknown,
): Promise<ResolvedBillingTerms> {
  const resolved = resolveBillingTerms(brand, dealTerms);
  const logoUuid = await getBrandLogoUuid(brand);
  if (!logoUuid) return resolved;
  return { ...resolved, document: { ...resolved.document, logoUuid } };
}
