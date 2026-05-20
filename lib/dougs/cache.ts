import "server-only";

import { unstable_cache } from "next/cache";
import {
  type DougsQuote,
  type DougsQuoteListItem,
  type DougsSalesInvoice,
  type DougsSalesInvoiceListItem,
  getDougsQuote,
  getDougsSalesInvoice,
  listDougsQuotes,
  listDougsSalesInvoices,
} from "./client";

/**
 * Wrappers cache pour les appels Dougs API. Sans cache, chaque visite
 * de /compta?tab=rapprochement déclenche ~50 fetches détail (3-5 s).
 * Avec cache 5 min : la 2e visite est ~instantanée.
 *
 * Invalidation par tag : `dougs:<userId>`. Le bouton "Tout rafraîchir"
 * appelle revalidateTag avec ce tag (cf. refreshAllDougsLinks dans
 * lib/actions/invoices.ts) pour forcer le re-fetch.
 *
 * Clé de cache scopée par userId — chaque user a son propre cookie et
 * voit (en pratique) les mêmes données Dougs mais on isole par sécurité.
 */

const TTL = 300; // 5 minutes

export function cachedListDougsSalesInvoices(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<DougsSalesInvoiceListItem[]> {
  return unstable_cache(
    () => listDougsSalesInvoices(userId, opts),
    ["dougs-sales-invoices", userId, String(opts.limit ?? 200), String(opts.offset ?? 0)],
    { revalidate: TTL, tags: [`dougs:${userId}`] },
  )();
}

export function cachedListDougsQuotes(
  userId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<DougsQuoteListItem[]> {
  return unstable_cache(
    () => listDougsQuotes(userId, opts),
    ["dougs-quotes", userId, String(opts.limit ?? 200), String(opts.offset ?? 0)],
    { revalidate: TTL, tags: [`dougs:${userId}`] },
  )();
}

export function cachedGetDougsSalesInvoice(
  userId: string,
  invoiceId: string,
): Promise<DougsSalesInvoice> {
  return unstable_cache(
    () => getDougsSalesInvoice(userId, invoiceId),
    ["dougs-sales-invoice", userId, invoiceId],
    { revalidate: TTL, tags: [`dougs:${userId}`, `dougs-invoice:${invoiceId}`] },
  )();
}

export function cachedGetDougsQuote(userId: string, quoteId: string): Promise<DougsQuote> {
  return unstable_cache(() => getDougsQuote(userId, quoteId), ["dougs-quote", userId, quoteId], {
    revalidate: TTL,
    tags: [`dougs:${userId}`, `dougs-quote:${quoteId}`],
  })();
}
