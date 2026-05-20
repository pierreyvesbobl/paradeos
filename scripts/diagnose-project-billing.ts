import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error("Usage : tsx scripts/diagnose-project-billing.ts <projectId>");
    process.exit(1);
  }
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  const [project] = await sql`
    select p.id, p.name, p.kind, p.status, p.value_amount, e.name as entity_name
    from public.projects p
    left join public.entities e on e.id = p.entity_id
    where p.id = ${projectId}
  `;
  console.info("PROJET :", project);

  const invoices = await sql`
    select id, kind, label, reference, dougs_reference,
           amount_ht, dougs_total_ht,
           status, dougs_status,
           invoiced_at, paid_at,
           dougs_invoice_id, dougs_quote_id,
           dougs_issued_at, dougs_paid_at, dougs_synced_at,
           cancels_invoice_id, cancels_dougs_invoice_id
    from public.invoices
    where project_id = ${projectId}
    order by kind, created_at
  `;
  console.info(`\nINVOICES liées (${invoices.length}) :`);
  for (const inv of invoices) {
    console.info("  ──");
    console.info("  kind         :", inv.kind);
    console.info("  label        :", inv.label);
    console.info("  status local :", inv.status, " | dougs :", inv.dougs_status);
    console.info("  amount_ht    :", inv.amount_ht, " | dougs_total_ht :", inv.dougs_total_ht);
    console.info("  invoiced_at  :", inv.invoiced_at);
    console.info("  paid_at      :", inv.paid_at);
    console.info("  dougs_issued :", inv.dougs_issued_at);
    console.info("  dougs_paid   :", inv.dougs_paid_at);
    console.info("  dougs_synced :", inv.dougs_synced_at);
    console.info("  dougs_inv_id :", inv.dougs_invoice_id);
    console.info("  dougs_q_id   :", inv.dougs_quote_id);
    if (inv.cancels_dougs_invoice_id) {
      console.info("  cancels_dougs:", inv.cancels_dougs_invoice_id);
    }
  }

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
