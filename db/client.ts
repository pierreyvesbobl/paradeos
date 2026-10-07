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
    // 20 et non 10 : en prod (pooler en mode transaction, port 6543), les
    // requêtes mises en file derrière un pool saturé restaient bloquées côté
    // Postgres en « active, ClientRead » ; les pages à ~15 requêtes parallèles
    // (fiche projet, dashboard) ne rendaient plus. Avec 20, aucune page ne
    // fait la queue. Le remède durable est le pooler session (port 5432),
    // cf. README « Pooler ».
    max: 20,
    // 20 s, et pas plus : on a essayé 120 s (le pool chaud économise ~200 ms
    // par navigation après une pause), et en prod les connexions gardées
    // ouvertes finissaient à moitié mortes côté Supavisor — requête « active »
    // en attente du client pendant 40 s, puis `canceling statement due to
    // statement timeout` et page en 500. Jeter les slots inactifs vite est ce
    // qui évite de réutiliser une connexion que le pooler a déjà coupée.
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
