/**
 * One-shot : recalcule amount_ht sur les invoices coworking en fonction
 * de la période (mois × desks × unit_price_ht). Avant ce fix, la
 * migration 0043 et l'action createCoworkingInvoice ne multipliaient
 * pas par le nombre de mois → les factures trimestrielles avaient le
 * tiers du vrai montant.
 */
import { config as loadEnv } from "dotenv";
import postgres from "postgres";

loadEnv({ path: ".env.local" });

function monthsBetween(start: Date, end: Date): number {
  return Math.max(
    1,
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1,
  );
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, {
    prepare: false,
    max: 1,
    onnotice: () => {},
  });

  const rows = await sql<
    {
      id: string;
      period_start: Date | null;
      period_end: Date | null;
      desks: number | null;
      unit_price_ht: string | null;
      amount_ht: string;
    }[]
  >`
    select id, period_start, period_end, desks, unit_price_ht, amount_ht
    from public.invoices
    where kind = 'coworking'
  `;

  let updated = 0;
  let skipped = 0;
  for (const r of rows) {
    if (!r.period_start || !r.period_end || !r.desks || !r.unit_price_ht) {
      skipped++;
      continue;
    }
    const months = monthsBetween(r.period_start, r.period_end);
    const expected = Number(r.unit_price_ht) * r.desks * months;
    if (!Number.isFinite(expected)) {
      skipped++;
      console.warn(`  ${r.id.slice(0, 8)} : invalide (skip)`);
      continue;
    }
    const currentNum = Number(r.amount_ht);
    const currentIsNaN = !Number.isFinite(currentNum);
    if (!currentIsNaN && Math.abs(expected - currentNum) < 0.01) {
      skipped++;
      continue;
    }
    await sql`
      update public.invoices
      set amount_ht = ${expected.toFixed(2)}, updated_at = now()
      where id = ${r.id}
    `;
    updated++;
    const before = currentIsNaN ? "NaN" : currentNum.toFixed(2);
    console.info(`  ${r.id.slice(0, 8)} : ${before} → ${expected.toFixed(2)} (${months} mois)`);
  }
  console.info(`\nUpdated ${updated} invoices, skipped ${skipped} (déjà OK ou champs manquants).`);
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
