/**
 * Contexte d'exécution d'une requête MCP : qui est le user.
 *
 * - Mode stdio : `PARADEOS_USER_ID` lu une fois au boot, posé en env
 *   par chaque user dans sa config Claude Desktop.
 * - Mode HTTP : résolu par requête depuis l'`Authorization: Bearer <token>`
 *   contre la table `user_api_tokens`.
 */

export type UserContext = {
  userId: string;
  /** Source de la résolution — utile pour le debug. */
  source: "env" | "token";
};

let _stdioContext: UserContext | null = null;

export function getStdioContext(): UserContext {
  if (_stdioContext) return _stdioContext;
  const userId = process.env.PARADEOS_USER_ID;
  if (!userId) {
    throw new Error(
      "PARADEOS_USER_ID manquant dans l'env. Ajoute-le à la config Claude Desktop pour scoper les tools personnels.",
    );
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error("PARADEOS_USER_ID doit être un UUID valide (auth.uid Supabase).");
  }
  _stdioContext = { userId, source: "env" };
  return _stdioContext;
}
