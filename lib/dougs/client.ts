/**
 * Client server-side pour l'API interne Dougs (`app.dougs.fr`).
 * Auth : cookie de session stocké chiffré par user (cf. crypto.ts).
 *
 * L'API n'est pas publique — usage à risque limité (Parade SAS), pas
 * de garantie de stabilité. Si Dougs change un endpoint, on patche dans
 * le module concerné :
 *
 *   http.ts            session, fetch authentifié, erreurs
 *   payload.ts         lecture tolérante des réponses (pickers)
 *   sales-invoices.ts  factures de vente (brouillon → finalisation → envoi)
 *   quotes.ts          devis
 *   purchases.ts       achats, opérations bancaires, pièces jointes, logo
 *   (operations.ts, à côté, est la synchro locale des opérations)
 *   aging.ts           balance âgée
 *   files.ts           téléchargement de PDF
 *
 * Ce fichier n'est que la façade : les appelants (et les tests, qui le
 * mockent) importent depuis `@/lib/dougs/client`.
 */

export * from "./aging";
export * from "./files";
export { DougsApiError, DougsAuthError } from "./http";
export * from "./payload";
export * from "./purchases";
export * from "./quotes";
export * from "./sales-invoices";
