/**
 * Tue les queries DB zombies (en `active` depuis >30 s).
 *
 * Cas d'usage : le pooler Supavisor Supabase (port 6543, mode transaction)
 * peut couper sa connexion backend en cours de query — côté client
 * postgres-js attend une réponse qui ne vient jamais et la query reste
 * "active" côté Postgres pendant des minutes. Le pool client se sature
 * → toutes les nouvelles requêtes attendent un slot → pages qui « tournent
 * dans le vide ». Lance ce script quand ça arrive :
 *   pnpm tsx scripts/kill-db-zombies.ts
 *
 * Le fix durable est de basculer DATABASE_URL en port 5432 (session pooler)
 * pour le dev local. Voir db/client.ts pour le contexte.
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL manquant");

  const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
  const rows = await sql<{ pid: number; duration: string }[]>`
    select pid, (now() - query_start)::text duration
    from pg_stat_activity
    where state = 'active' and pid != pg_backend_pid() and now() - query_start > interval '30 seconds'
  `;
  process.stdout.write(`Found ${rows.length} zombie queries (>30s active)\n`);
  for (const r of rows) {
    process.stdout.write(`  Terminating pid=${r.pid} dur=${r.duration}\n`);
    await sql`select pg_terminate_backend(${r.pid})`;
  }
  await sql.end({ timeout: 3 });
}

main().catch((e) => {
  process.stderr.write(`Échec : ${(e as Error).message}\n`);
  process.exit(1);
});
