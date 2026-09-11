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

  const counts = await sql`select kind, count(*) from public.invoices group by kind order by kind`;
  console.info("Invoices par kind :");
  for (const r of counts) console.info("  ", r.kind, ":", r.count);

  const totals =
    await sql`select status, count(*) as cnt, sum(amount_ht)::text as total from public.invoices group by status order by status`;
  console.info("Par status :");
  for (const r of totals) console.info("  ", r.status, ":", r.cnt, "(", r.total, "€)");

  const linked =
    await sql`select count(*) as cnt from public.invoices where dougs_invoice_id is not null or dougs_quote_id is not null`;
  console.info("Avec lien Dougs :", linked[0]?.cnt ?? 0);

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
