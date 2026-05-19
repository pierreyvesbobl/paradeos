/**
 * One-shot : backfill cancels_dougs_invoice_id sur les credit_notes
 * migrés par 0043. Lit le backup JSON pour récupérer l'ID Dougs originel.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, {
    prepare: false,
    max: 1,
    onnotice: () => {},
  });

  const backupPath = resolve(process.cwd(), "backups/0043-2026-05-18T19-51-22-454Z.json");
  const backup = JSON.parse(readFileSync(backupPath, "utf8")) as {
    dougs_credit_note_links: { dougs_credit_note_id: string; cancels_dougs_invoice_id: string }[];
  };

  let updated = 0;
  for (const link of backup.dougs_credit_note_links) {
    const res = await sql`
      update public.invoices
      set cancels_dougs_invoice_id = ${link.cancels_dougs_invoice_id}, updated_at = now()
      where kind = 'credit_note'
        and dougs_invoice_id = ${link.dougs_credit_note_id}
        and cancels_dougs_invoice_id is null
      returning id
    `;
    if (res.length > 0) updated++;
  }
  console.info(`Backfilled ${updated} credit_notes.`);
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
