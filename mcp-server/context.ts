/**
 * Contexte d'exécution d'une requête MCP : qui est le user. Résolu par
 * requête depuis l'`Authorization: Bearer <token>` (cf.
 * `lib/oauth/resource-server.ts`).
 */

export type UserContext = {
  userId: string;
  /** Source de la résolution — utile pour le debug. */
  source: "token";
};
