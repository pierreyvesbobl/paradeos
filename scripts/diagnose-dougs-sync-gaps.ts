/**
 * Cherche les écarts entre dougs_status / dougs_paid_at et le status /
 * paid_at LOCAL sur invoices. Diagnostic pour comprendre pourquoi les
 * vues qui filtrent sur status local ne voient pas les changements
 * remontés depuis Dougs.
 */
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error("DATABASE_URL manquant.");
  const sql = postgres(dbUrl, { prepare: false, max: 1, onnotice: () => {} });

  console.info("Quotes — comparaison dougs_status vs status local :\n");
  const quotes = await sql`
    select i.id, p.name as project, i.status as local_status,
           i.dougs_status, i.dougs_synced_at
    from public.invoices i
    left join public.projects p on p.id = i.project_id
    where i.kind = 'quote'
    order by p.name
  `;
  for (const q of quotes) {
    const mapped = mapDougsQuoteStatus(q.dougs_status);
    const ok = q.local_status === mapped;
    const marker = ok ? "  " : "⚠️ ";
    console.info(
      `${marker}${(q.project ?? "?").slice(0, 40).padEnd(42)} local=${q.local_status.padEnd(9)} dougs=${(q.dougs_status ?? "(none)").padEnd(10)} → attendu=${mapped}`,
    );
  }

  console.info("\nFactures — paid_at local vs dougs_paid_at :\n");
  const inv = await sql`
    select i.id, p.name as project, c.name as contract, i.kind, i.label,
           i.status as local_status, i.paid_at, i.dougs_paid_at, i.dougs_synced_at
    from public.invoices i
    left join public.projects p on p.id = i.project_id
    left join public.coworking_contracts c on c.id = i.coworking_contract_id
    where i.kind in ('milestone', 'coworking', 'one_off')
      and i.dougs_invoice_id is not null
    order by i.invoiced_at desc nulls last
  `;
  for (const r of inv) {
    const local = r.paid_at ? new Date(r.paid_at).toISOString().slice(0, 10) : "—";
    const dougs = r.dougs_paid_at ? new Date(r.dougs_paid_at).toISOString().slice(0, 10) : "—";
    const synced = r.dougs_synced_at
      ? new Date(r.dougs_synced_at).toISOString().slice(0, 16)
      : "(jamais)";
    const target = (r.project ?? r.contract ?? "?").slice(0, 30).padEnd(32);
    const lbl = (r.label ?? "").slice(0, 24).padEnd(26);
    const marker = local !== dougs && (local !== "—" || dougs !== "—") ? "⚠️ " : "  ";
    console.info(
      `${marker}${target} ${lbl} status=${r.local_status.padEnd(6)} paid_local=${local.padEnd(11)} paid_dougs=${dougs.padEnd(11)} synced=${synced}`,
    );
  }

  await sql.end({ timeout: 5 });
}

function mapDougsQuoteStatus(dougs: string | null): string {
  switch ((dougs ?? "").toUpperCase()) {
    case "ACCEPTED":
      return "accepted";
    case "REFUSED":
      return "refused";
    case "DRAFT":
      return "draft";
    case "PENDING":
      return "sent";
    default:
      return "sent";
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
