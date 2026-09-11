/**
 * Applique la migration 0050 (gmail_tags + gmail_thread_tags, drop
 * gmail_links). À lancer une fois. Idempotent.
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

  const fname = "0050_gmail_tags.sql";
  const path = resolve(process.cwd(), "supabase/migrations", fname);
  const content = await readFile(path, "utf8");
  console.info(`→ applying ${fname} (${content.length} bytes)`);
  await sql.unsafe(content);
  console.info("  ✓ done");

  console.info("\nVerifying tables exist...");
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name in ('gmail_tags', 'gmail_thread_tags')
    order by table_name
  `;
  console.info(`  ${rows.length}/2 tables :`, rows.map((r) => r.table_name).join(", "));

  const gone = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public' and table_name = 'gmail_links'
  `;
  console.info(`  gmail_links : ${gone.length === 0 ? "supprimée ✓" : "TOUJOURS PRÉSENTE ⚠"}`);

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
