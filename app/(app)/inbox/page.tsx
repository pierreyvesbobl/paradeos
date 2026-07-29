import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { requireUser } from "@/lib/auth/server";
import { getInboxItems } from "@/lib/db/queries/inbox";
import { db } from "@/lib/db/server";
import { and, desc, eq, isNull, ne, or } from "drizzle-orm";
import type { CoworkingInvoiceOption } from "../compta/reconciliation-actions";
import { InboxView } from "./inbox-view";

export const metadata = {
  title: "À traiter — Paradeos",
};

function fmtDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  if (d instanceof Date) {
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}/${m}/${y}` : d;
}

export default async function InboxPage() {
  const user = await requireUser();
  const conn = await db();

  // Charge en parallèle : items inbox + factures coworking non liées (pour
  // le fallback manuel dans l'éditeur de rapprochement — sans ça, un user
  // ne peut rattacher qu'aux candidats auto-scorés, et les factures
  // coworking scorent souvent < 0.3 à cause du clientName manquant).
  const [{ items, counts }, coworkingInvoiceRows] = await Promise.all([
    getInboxItems(user.id),
    conn
      .select({
        id: invoices.id,
        invoicedAt: invoices.invoicedAt,
        periodStart: invoices.periodStart,
        periodEnd: invoices.periodEnd,
        desks: invoices.desks,
        unitPriceHt: invoices.unitPriceHt,
        dougsInvoiceId: invoices.dougsInvoiceId,
        contractName: coworkingContracts.name,
        entityName: entities.name,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
      })
      .from(invoices)
      .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
      .leftJoin(entities, eq(entities.id, coworkingContracts.billToEntityId))
      .leftJoin(contacts, eq(contacts.id, coworkingContracts.contactId))
      .where(
        and(
          eq(invoices.kind, "coworking"),
          isNull(invoices.dougsInvoiceId),
          or(ne(invoices.billedBy, "g_and_o"), isNull(invoices.billedBy)),
        ),
      )
      .orderBy(desc(invoices.invoicedAt), desc(invoices.periodStart)),
  ]);

  const coworkingInvoiceOptions: CoworkingInvoiceOption[] = coworkingInvoiceRows.map((c) => {
    const contactName = `${c.contactFirstName ?? ""} ${c.contactLastName ?? ""}`.trim() || null;
    const issued = fmtDate(c.invoicedAt);
    const periodLabel = (c.periodStart ?? "").slice(0, 7);
    return {
      id: c.id,
      label: issued
        ? `${c.contractName ?? "(contrat supprimé)"} · ${periodLabel} (émise ${issued})`
        : `${c.contractName ?? "(contrat supprimé)"} · ${periodLabel} (non émise)`,
      contractName: c.contractName ?? "(contrat supprimé)",
      clientName: c.entityName ?? contactName,
      invoiceDate: c.invoicedAt ? c.invoicedAt.toISOString().slice(0, 10) : null,
      periodStart: c.periodStart ?? "",
      periodEnd: c.periodEnd ?? "",
      amountHt: (Number(c.unitPriceHt) || 0) * (c.desks ?? 0),
      alreadyLinked: Boolean(c.dougsInvoiceId),
    };
  });

  return (
    <div className="mx-auto flex max-w-[1024px] flex-col gap-6">
      <PageHeader
        title="À traiter"
        description={
          counts.total === 0
            ? "Rien qui traîne. Profites-en."
            : `${counts.total} extraction${counts.total > 1 ? "s" : ""} IA en attente de validation.`
        }
      />
      <InboxView items={items} coworkingInvoiceOptions={coworkingInvoiceOptions} />
    </div>
  );
}
