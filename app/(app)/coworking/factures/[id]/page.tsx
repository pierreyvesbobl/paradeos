import { Breadcrumbs } from "@/components/breadcrumbs";
import { InvoiceForm } from "@/components/coworking/invoice-form";
import { PushToDougsButton } from "@/components/coworking/push-to-dougs-button";
import { RetryAutoSendButton } from "@/components/coworking/retry-auto-send-button";
import { DeleteButton } from "@/components/delete-button";
import { PageHeader } from "@/components/page-header";
import { dougsSessions } from "@/db/schema/dougs";
import { deleteInvoice } from "@/lib/actions/invoices";
import { requireUser } from "@/lib/auth/server";
import { INVOICE_BRAND_LABELS } from "@/lib/billing/brand-templates";
import { getCoworkingInvoice } from "@/lib/db/queries/coworking";
import { db } from "@/lib/db/server";
import { buildDougsInvoiceUrl } from "@/lib/dougs/client";
import { Warning } from "@phosphor-icons/react/dist/ssr";
import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

type Params = Promise<{ id: string }>;

async function deleteAndRedirect(formData: FormData) {
  "use server";
  const id = formData.get("id");
  if (typeof id !== "string") return;
  const res = await deleteInvoice({ id });
  if (!res.ok) throw new Error(res.message);
  redirect("/coworking?tab=invoices");
}

export default async function InvoiceDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const user = await requireUser();
  const invoice = await getCoworkingInvoice(id);
  if (!invoice) notFound();

  // Si la facture a déjà été poussée et qu'on a une session Dougs, on
  // calcule l'URL du brouillon. Sinon `dougsUrl=null` → bouton "Push".
  let dougsUrl: string | null = null;
  if (invoice.dougsInvoiceId) {
    const conn = await db();
    const [session] = await conn
      .select({ companyId: dougsSessions.companyId })
      .from(dougsSessions)
      .where(eq(dougsSessions.userId, user.id))
      .limit(1);
    if (session) {
      dougsUrl = buildDougsInvoiceUrl(session.companyId, invoice.dougsInvoiceId, {
        status: invoice.status === "payee" ? "paid" : "waiting",
      });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Breadcrumbs
            items={[
              { label: "Coworking", href: "/coworking" },
              { label: "Factures", href: "/coworking?tab=invoices" },
              ...(invoice.contractId
                ? [
                    {
                      label: invoice.contractName,
                      href: `/coworking/contrats/${invoice.contractId}`,
                    },
                  ]
                : []),
              { label: invoice.name },
            ]}
          />
        }
        title={invoice.name}
        description={
          invoice.contractId ? (
            <span>
              Contrat :{" "}
              <Link
                href={`/coworking/contrats/${invoice.contractId}`}
                className="text-foreground hover:underline"
              >
                {invoice.contractName}
              </Link>
              {invoice.contactName ? ` · ${invoice.contactName}` : ""}
            </span>
          ) : undefined
        }
        actions={
          <>
            <PushToDougsButton
              invoiceId={invoice.id}
              dougsInvoiceId={invoice.dougsInvoiceId}
              dougsUrl={dougsUrl}
            />
            <DeleteButton
              action={deleteAndRedirect}
              id={invoice.id}
              label="Supprimer"
              confirmTitle={`Supprimer la facture "${invoice.name}" ?`}
            />
          </>
        }
      />
      <section className="max-w-2xl rounded-lg border bg-card p-4">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">Marque</dt>
            <dd className="mt-1">{INVOICE_BRAND_LABELS[invoice.brand]}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground text-xs uppercase tracking-wide">Envoi auto</dt>
            <dd className="mt-1">
              {invoice.autoSentAt ? (
                <span className="text-emerald-700 dark:text-emerald-400">
                  Envoyée le{" "}
                  {invoice.autoSentAt.toLocaleDateString("fr-FR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                  {invoice.contactEmail ? ` à ${invoice.contactEmail}` : ""}
                </span>
              ) : invoice.contractAutoSend ? (
                <span className="text-muted-foreground">
                  Activé sur le contrat — partira au prochain cron
                </span>
              ) : (
                <span className="text-muted-foreground">Manuel</span>
              )}
            </dd>
          </div>
        </dl>

        {invoice.autoSendError ? (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
            <p className="flex items-start gap-1.5 font-medium text-amber-800 text-xs dark:text-amber-300">
              <Warning className="mt-0.5 size-3.5 shrink-0" />
              Dernier blocage de l'envoi automatique
            </p>
            <p className="mt-1 text-amber-800 text-xs dark:text-amber-300">
              {invoice.autoSendError}
            </p>
            <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              Corrige les données du client, puis relance l'envoi.
            </p>
            <div className="mt-2">
              <RetryAutoSendButton invoiceId={invoice.id} />
            </div>
          </div>
        ) : null}
      </section>

      {invoice.dougsInvoiceId ? (
        <section className="max-w-2xl rounded-lg border bg-card p-6">
          <h2 className="mb-3 font-medium text-sm">Snapshot Dougs</h2>
          <dl className="grid grid-cols-2 gap-3 text-xs">
            <dt className="text-muted-foreground">Référence</dt>
            <dd>
              {invoice.dougsInvoiceReference && dougsUrl ? (
                <Link href={dougsUrl} target="_blank" className="font-mono hover:underline">
                  {invoice.dougsInvoiceReference} ↗
                </Link>
              ) : (
                <span className="text-muted-foreground italic">
                  Non synchronisé — clique « Rafraîchir »
                </span>
              )}
            </dd>
            {invoice.dougsInvoiceStatus ? (
              <>
                <dt className="text-muted-foreground">Statut Dougs</dt>
                <dd>{invoice.dougsInvoiceStatus}</dd>
              </>
            ) : null}
            {invoice.dougsInvoiceTotalHt ? (
              <>
                <dt className="text-muted-foreground">Total HT</dt>
                <dd className="tabular-nums">
                  {Number(invoice.dougsInvoiceTotalHt).toLocaleString("fr-FR", {
                    style: "currency",
                    currency: "EUR",
                  })}
                </dd>
              </>
            ) : null}
            {invoice.dougsInvoiceTotalTtc ? (
              <>
                <dt className="text-muted-foreground">Total TTC</dt>
                <dd className="tabular-nums">
                  {Number(invoice.dougsInvoiceTotalTtc).toLocaleString("fr-FR", {
                    style: "currency",
                    currency: "EUR",
                  })}
                </dd>
              </>
            ) : null}
            {invoice.dougsInvoiceIssuedAt ? (
              <>
                <dt className="text-muted-foreground">Émise le</dt>
                <dd>{new Date(invoice.dougsInvoiceIssuedAt).toLocaleDateString("fr-FR")}</dd>
              </>
            ) : null}
            {invoice.dougsInvoicePaidAt ? (
              <>
                <dt className="text-muted-foreground">Payée le</dt>
                <dd>{new Date(invoice.dougsInvoicePaidAt).toLocaleDateString("fr-FR")}</dd>
              </>
            ) : null}
            {invoice.dougsInvoiceSyncedAt ? (
              <>
                <dt className="text-muted-foreground">Dernier sync</dt>
                <dd className="text-[11px] text-muted-foreground">
                  {new Date(invoice.dougsInvoiceSyncedAt).toLocaleString("fr-FR")}
                </dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}
      <div className="max-w-2xl">
        <InvoiceForm
          mode="edit"
          defaultValues={{
            id: invoice.id,
            contractId: invoice.contractId ?? "",
            name: invoice.name,
            invoiceDate: invoice.invoiceDate ?? "",
            periodStart: invoice.periodStart ?? "",
            periodEnd: invoice.periodEnd ?? "",
            status: invoice.status,
            billedBy: (invoice.billedBy as "parade" | "g_and_o") ?? "parade",
            desks: invoice.desks,
            unitPriceHt: invoice.unitPriceHt,
            vatRate: invoice.vatRate,
            notes: invoice.notes ?? "",
          }}
        />
      </div>
    </div>
  );
}
