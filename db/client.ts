import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

let _client: ReturnType<typeof postgres> | undefined;

/**
 * Connexion Postgres partagée (pool postgres-js). Une seule instance par
 * process. La propagation du JWT pour RLS se fait dans `lib/db/server.ts`,
 * pas ici — ce client est volontairement minimal.
 */
function getPgClient() {
  if (_client) return _client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL est requis.");
  _client = postgres(url, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return _client;
}

export function createDrizzle() {
  return drizzle(getPgClient());
}

export type Database = ReturnType<typeof createDrizzle>;
