/**
 * Backfill paid_at sur les invoices status='paid' où Dougs avait laissé
 * `paidAt: null` mais expose la date dans `operationAttachments[].operation.date`.
 * À lancer une fois après le déploiement du fix sur pickDougsPaidAt.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  const { getDougsSalesInvoice, pickDougsPaidAt } = await import("@/lib/dougs/client");

  const rows = await sql<
    { id: string; dougs_invoice_id: string; user_id: string; reference: string | null }[]
  >`
    select i.id, i.dougs_invoice_id, i.dougs_reference as reference, ds.user_id
    from public.invoices i
    cross join lateral (select user_id from public.dougs_sessions limit 1) ds
    where i.status = 'paid'
      and i.paid_at is null
      and i.dougs_invoice_id is not null
  `;
  console.info(`→ ${rows.length} facture(s) candidates`);

  let updated = 0;
  let stillNull = 0;
  const errors: string[] = [];
  for (const r of rows) {
    try {
      const inv = await getDougsSalesInvoice(r.user_id, r.dougs_invoice_id);
      const paid = pickDougsPaidAt(inv);
      if (!paid) {
        stillNull++;
        console.info(`  · ${r.reference ?? r.id} : Dougs ne fournit toujours pas de date`);
        continue;
      }
      const date = new Date(paid);
      if (Number.isNaN(date.getTime())) continue;
      await sql`
        update public.invoices
        set paid_at = ${date},
            dougs_paid_at = ${date},
            dougs_synced_at = now(),
            updated_at = now()
        where id = ${r.id}
      `;
      updated++;
      console.info(`  ✓ ${r.reference ?? r.id} → ${date.toISOString().slice(0, 10)}`);
      await new Promise((res) => setTimeout(res, 150));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${r.id}: ${msg}`);
      console.warn(`  ⚠ ${r.reference ?? r.id} : ${msg}`);
    }
  }
  console.info(`\nDone. updated=${updated} stillNull=${stillNull} errors=${errors.length}`);
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
