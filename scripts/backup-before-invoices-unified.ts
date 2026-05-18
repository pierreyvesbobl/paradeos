/**
 * Backup JSON one-shot avant migration 0043_invoices_unified.
 * Dump les tables impactées vers backups/0043-<timestamp>.json :
 *   - projects (full row : billing_milestones JSONB + dougs_quote_* + reste)
 *   - coworking_invoices
 *   - dougs_credit_note_links
 *
 * En cas de bug post-migration, on peut restaurer les champs via un
 * script ad-hoc. Pas de restore automatique : reverse engineering manuel.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  const projects = await sql`select * from public.projects`;
  const coworkingInvoices = await sql`select * from public.coworking_invoices`;
  const creditNoteLinks = await sql`select * from public.dougs_credit_note_links`;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = {
    timestamp: stamp,
    counts: {
      projects: projects.length,
      coworking_invoices: coworkingInvoices.length,
      dougs_credit_note_links: creditNoteLinks.length,
    },
    projects,
    coworking_invoices: coworkingInvoices,
    dougs_credit_note_links: creditNoteLinks,
  };
  const path = resolve(process.cwd(), "backups", `0043-${stamp}.json`);
  writeFileSync(path, JSON.stringify(out, null, 2));
  console.info(`Backup → ${path}`);
  console.info(`  projects: ${projects.length}`);
  console.info(`  coworking_invoices: ${coworkingInvoices.length}`);
  console.info(`  dougs_credit_note_links: ${creditNoteLinks.length}`);
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
