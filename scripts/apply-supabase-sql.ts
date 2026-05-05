/**
 * Applique les fichiers SQL de `supabase/migrations/` dans l'ordre.
 * Idempotent : chaque fichier doit être idempotent (DROP IF EXISTS,
 * CREATE OR REPLACE, etc.) — c'est déjà le cas pour la phase 0.
 *
 * Usage : pnpm db:supabase
 */
import "dotenv/config";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Variable d'environnement manquante : ${name}`);
  return v;
}

async function main() {
  const dbUrl = requireEnv("DATABASE_URL");
  const dir = resolve(process.cwd(), "supabase/migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.info("Aucun fichier SQL à appliquer.");
    return;
  }

  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  console.info(`Application de ${files.length} fichier(s) SQL…`);
  for (const file of files) {
    const path = join(dir, file);
    const content = readFileSync(path, "utf8");
    console.info(`  → ${file}`);
    await sql.unsafe(content);
  }
  await sql.end({ timeout: 5 });
  console.info("OK.");
}

main().catch((err) => {
  console.error("Échec :", err);
  process.exit(1);
});
