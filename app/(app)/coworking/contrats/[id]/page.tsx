import { ContractForm } from "@/components/coworking/contract-form";
import { NewInvoiceButton } from "@/components/coworking/new-invoice-button";
import { NextInvoiceButton } from "@/components/coworking/next-invoice-button";
import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { deleteCoworkingContract } from "@/lib/actions/coworking";
import { getCoworkingContractWithInvoices } from "@/lib/db/queries/coworking";
import { db } from "@/lib/db/server";
import { formatEuro } from "@/lib/format";
import {
  coworkingInvoiceBilledByLabels,
  coworkingInvoiceStatusLabels,
  invoiceTotalHt,
  invoiceTotalTtc,
  monthsBetween,
} from "@/lib/schemas/coworking";
import { asc } from "drizzle-orm";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Params = Promise<{ id: string }>;

function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
}

async function deleteAndRedirect(formData: FormData) {
  "use server";
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const res = await deleteCoworkingContract({ id });
  if (!res.ok) throw new Error(res.message);
  redirect("/coworking");
}

export default async function ContractDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const data = await getCoworkingContractWithInvoices(id);
  if (!data) notFound();
  const { contract, invoices } = data;

  const conn = await db();
  const [contactRows, entityRows] = await Promise.all([
    conn
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
    conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .orderBy(asc(entities.name)),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Coworking"
        title={contract.name}
        description={contract.contactName ? `Coworker : ${contract.contactName}` : undefined}
        actions={
          <DeleteButton
            action={deleteAndRedirect}
            id={contract.id}
            label="Supprimer"
            confirmTitle={`Supprimer "${contract.name}" ?`}
          />
        }
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <section className="space-y-3">
          <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
            Informations
          </h2>
          <ContractForm
            mode="edit"
            contactOptions={contactRows.map((c) => ({
              id: c.id,
              label: `${c.firstName} ${c.lastName}`.trim(),
            }))}
            entityOptions={entityRows.map((e) => ({ id: e.id, label: e.name }))}
            defaultValues={{
              id: contract.id,
              name: contract.name,
              contactId: contract.contactId,
              billToEntityId: contract.billToEntityId,
              startDate: contract.startDate,
              endDate: contract.endDate ?? "",
              desks: contract.desks,
              unitPriceHt: contract.unitPriceHt,
              status: contract.status,
              billingFrequency: contract.billingFrequency,
              notes: contract.notes ?? "",
            }}
          />
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1.5">
            <h2 className="font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
              Factures ({invoices.length})
            </h2>
            <div className="flex items-center gap-1.5">
              <NextInvoiceButton contractId={contract.id} />
              <NewInvoiceButton
                contractId={contract.id}
                defaultName={`${contract.name} — ${new Date().toLocaleString("fr-FR", { month: "long", year: "numeric" })}`}
                defaultDesks={contract.desks}
                defaultUnitPriceHt={contract.unitPriceHt}
              />
            </div>
          </div>

          {invoices.length === 0 ? (
            <EmptyState
              compact
              title="Aucune facture pour ce contrat."
              description="Crée une facture pour la première période."
            />
          ) : (
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Période</TableHead>
                    <TableHead>Émetteur</TableHead>
                    <TableHead className="text-right">HT</TableHead>
                    <TableHead className="text-right">TTC</TableHead>
                    <TableHead>Statut</TableHead>
                    <TableHead className="w-8" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((i) => {
                    // Totaux live depuis le contrat parent (pas le snapshot facture).
                    // Prix mensuel × nombre de mois de la période facturée.
                    const months = monthsBetween(i.periodStart, i.periodEnd);
                    const ht = invoiceTotalHt(contract.desks, contract.unitPriceHt, months);
                    const ttc = invoiceTotalTtc(
                      contract.desks,
                      contract.unitPriceHt,
                      months,
                      i.vatRate,
                    );
                    return (
                      <TableRow key={i.id}>
                        <TableCell className="text-xs">
                          <Link href={`/coworking/factures/${i.id}`} className="hover:underline">
                            {fmtDate(i.periodStart)} → {fmtDate(i.periodEnd)}
                          </Link>
                          <p className="text-muted-foreground">{i.name}</p>
                        </TableCell>
                        <TableCell className="text-xs">
                          {coworkingInvoiceBilledByLabels[i.billedBy]}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatEuro(ht)}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {formatEuro(ttc)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              i.status === "payee"
                                ? "default"
                                : i.status === "envoyee"
                                  ? "secondary"
                                  : "outline"
                            }
                          >
                            {coworkingInvoiceStatusLabels[i.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Link
                            href={`/coworking/factures/${i.id}`}
                            className="text-muted-foreground hover:text-foreground"
                            aria-label="Ouvrir"
                          >
                            <ArrowRight className="size-4" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
