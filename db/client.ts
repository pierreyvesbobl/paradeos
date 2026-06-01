import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

type PgClient = ReturnType<typeof postgres>;

/**
 * Connexion Postgres partagée (pool postgres-js). Une seule instance par
 * process. La propagation du JWT pour RLS se fait dans `lib/db/server.ts`,
 * pas ici — ce client est volontairement minimal.
 *
 * En dev, Next.js HMR recharge ce module à chaque sauvegarde. Sans cache
 * sur `globalThis`, chaque reload crée un NOUVEAU pool de `max` connexions
 * sans fermer le précédent — au bout de quelques modifs le pooler Supabase
 * sature et les requêtes attendent leur tour pendant 30 s à 2 min. Le
 * pattern globalThis fait survivre le pool aux reloads.
 */
const globalForPg = globalThis as unknown as { __paradeosPg?: PgClient };

function getPgClient(): PgClient {
  if (globalForPg.__paradeosPg) return globalForPg.__paradeosPg;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL est requis.");

  // Note : on n'essaie plus de configurer statement_timeout côté client.
  // Le pooler Supavisor en mode transaction (port 6543) **n'applique pas**
  // les timeouts session, que ce soit via `connection: { statement_timeout }`
  // ou `?options=-c statement_timeout=…`. Vérifié à la main : `SHOW
  // statement_timeout` retourne '2min' (config serveur) et un `pg_sleep(40)`
  // s'exécute toujours sans coupure. Les timeouts utiles doivent être
  // implémentés côté applicatif (fetchWithTimeout pour les appels externes ;
  // pour postgres-js on s'appuie sur les patterns Promise.race si besoin).
  const client = postgres(url, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
    // TCP keepalive : déclenche un probe après 15 s d'inactivité (default 60 s).
    // Quand Supavisor coupe sa connexion backend en cours de query (cf. erreur
    // EDBHANDLEREXITED), c'est par les keepalives que postgres-js détecte la
    // connexion morte et libère le slot du pool. 15 s borne le hang utilisateur.
    keep_alive: 15,
  });
  globalForPg.__paradeosPg = client;
  return client;
}

export function createDrizzle() {
  return drizzle(getPgClient());
}

export type Database = ReturnType<typeof createDrizzle>;
