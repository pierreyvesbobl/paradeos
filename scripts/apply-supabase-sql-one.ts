/**
 * Applique un fichier SQL unique de `supabase/migrations/`.
 * Utile pour appliquer une nouvelle migration sans ré-exécuter
 * tout l'historique (le runner complet `db:supabase` n'est plus
 * idempotent depuis le drop de la table opportunities en 0020).
 *
 * Usage : pnpm exec tsx scripts/apply-supabase-sql-one.ts 0021_google_drive.sql
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage : tsx scripts/apply-supabase-sql-one.ts <file.sql>");

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");

  const path = resolve(process.cwd(), "supabase/migrations", file);
  const content = readFileSync(path, "utf8");

  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });
  console.info(`Applying ${file}…`);
  await sql.unsafe(content);
  await sql.end({ timeout: 5 });
  console.info("OK.");
}

main().catch((err) => {
  console.error("Échec :", err);
  process.exit(1);
});
