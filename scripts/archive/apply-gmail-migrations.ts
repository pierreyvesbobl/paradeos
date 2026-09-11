/**
 * Applique les migrations Gmail (0047-0049) sur la base pointée par
 * DATABASE_URL. À lancer une seule fois. Idempotent (les migrations
 * utilisent `create table if not exists` et `do $$ ... exception when
 * duplicate_object then null; end $$`).
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const MIGRATIONS = [
  "0047_gmail_threads_messages.sql",
  "0048_gmail_links.sql",
  "0049_gmail_sync_state.sql",
];

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  for (const fname of MIGRATIONS) {
    const path = resolve(process.cwd(), "supabase/migrations", fname);
    const content = await readFile(path, "utf8");
    console.info(`→ applying ${fname} (${content.length} bytes)`);
    try {
      await sql.unsafe(content);
      console.info(`  ✓ ${fname}`);
    } catch (err) {
      console.error(`  ✗ ${fname} : ${err instanceof Error ? err.message : err}`);
      throw err;
    }
  }

  console.info("\nVerifying tables exist...");
  const rows = await sql<{ table_name: string }[]>`
    select table_name from information_schema.tables
    where table_schema = 'public'
      and table_name in ('gmail_threads', 'gmail_messages', 'gmail_links', 'gmail_sync_state')
    order by table_name
  `;
  console.info(`  Found ${rows.length}/4 tables :`, rows.map((r) => r.table_name).join(", "));

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
