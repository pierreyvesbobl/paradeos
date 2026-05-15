import { type Database, createDrizzle } from "../../db/client";

/**
 * Client Drizzle pour Server Components, Server Actions et Route Handlers.
 *
 * Note d'architecture : la connexion utilise le rôle `postgres` (chaîne
 * Session pooler), qui **bypass RLS** par défaut. La sécurité métier est
 * donc enforcée côté application via le helper `action()` (qui appelle
 * `requireUser()`) et les filtres explicites dans les Server Actions
 * (`where userId = user.id`).
 *
 * RLS reste activée et configurée sur toutes les tables comme défense
 * en profondeur — utile si on bascule un jour vers une connexion
 * authentifiée par JWT (ex. PgBouncer + transaction-mode + propagation
 * via un wrapper transaction). Cf. migration 0007 pour le contexte.
 *
 * `db()` reste async pour conserver l'interface si on rebranche la
 * propagation JWT plus tard.
 */
export async function db(): Promise<Database> {
  return createDrizzle();
}
