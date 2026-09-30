/**
 * Client Drizzle dédié au serveur MCP. Connexion postgres-js sur la
 * même DATABASE_URL que l'app — bypass RLS via le rôle `postgres`,
 * cohérent avec `lib/db/server.ts`. Le scoping per-user est appliqué
 * applicativement dans les handlers (cf. context.ts).
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import type { Database } from "../db/client";

let _client: ReturnType<typeof postgres> | undefined;

function getPgClient() {
  if (_client) return _client;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL manquant. Pose-le dans la config Claude Desktop.");
  }
  _client = postgres(url, {
    prepare: false,
    max: 4,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return _client;
}

// Typé `Database` (et non `ReturnType<typeof drizzle>`, qui s'instancie sur
// le schéma par défaut) pour rester interchangeable avec la connexion de
// l'app : les helpers partagés de `lib/` prennent l'une ou l'autre.
let _db: Database | undefined;
export function db(): Database {
  if (_db) return _db;
  _db = drizzle(getPgClient());
  return _db;
}

export async function closeDb() {
  if (_client) await _client.end({ timeout: 3 });
  _client = undefined;
  _db = undefined;
}
