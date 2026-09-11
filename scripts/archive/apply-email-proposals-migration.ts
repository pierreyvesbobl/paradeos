/**
 * Applique la migration 0051 (email_proposals). Idempotent.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  const fname = "0051_email_proposals.sql";
  const path = resolve(process.cwd(), "supabase/migrations", fname);
  const content = await readFile(path, "utf8");
  console.info(`→ applying ${fname} (${content.length} bytes)`);
  await sql.unsafe(content);
  console.info("  ✓ done");

  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = 'email_proposals'
  `;
  console.info(`  email_proposals : ${rows.length === 1 ? "présente ✓" : "MANQUANTE ⚠"}`);

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
