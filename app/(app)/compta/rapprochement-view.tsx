import { contacts } from "@/db/schema/contacts";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { DougsAuthError } from "@/lib/dougs/client";
import {
  getInvoiceSuggestions,
  getLinkedDougsEntries,
  getQuoteSuggestions,
} from "@/lib/dougs/reconciliation";
import { and, asc, desc, eq, isNull, ne, or } from "drizzle-orm";
import { ExternalLink, FileText, Receipt } from "lucide-react";
import Link from "next/link";
import { LinkedInvoiceRow, LinkedQuoteRow } from "./linked-row-editor";
import {
  type CoworkingInvoiceOption,
  LinkCreditNotePicker,
  LinkInvoiceButton,
  LinkProjectAsMilestoneButton,
  LinkQuoteButton,
  ManualLinkCoworkingInvoice,
  ManualLinkInvoice,
  ManualLinkQuote,
  type ProjectOption,
  RefreshAllButton,
  UnlinkCreditNoteButton,
} from "./reconciliation-actions";

function formatEur(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function scoreTone(score: number): string {
  if (score >= 0.85) return "border-emerald-300 bg-emerald-50 text-emerald-700";
  if (score >= 0.6) return "border-amber-300 bg-amber-50 text-amber-700";
  return "border-slate-300 bg-slate-50 text-slate-600";
}

export async function RapprochementView({ debug }: { debug?: string }) {
  const debugMode = debug === "1" || debug === "true";
  const user = await requireUser();
  const conn = await db();

  // Liste de tous les projets client pour le picker manuel.
  const projectRows = await conn
    .select({
      id: projects.id,
      name: projects.name,
      valueAmount: projects.valueAmount,
      budgetAmount: projects.budgetAmount,
      entityName: entities.name,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(eq(projects.kind, "client"))
    .orderBy(asc(projects.name));

  const projectOptions: ProjectOption[] = projectRows.map((p) => ({
    id: p.id,
    name: p.name,
    entityName: p.entityName,
    valueAmount: Number(p.valueAmount ?? p.budgetAmount ?? 0) || null,
  }));

  // Toutes les factures coworking (liées ou non) pour le picker manuel.
  const coworkingInvoiceRows = await conn
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
        // Exclut G&O du picker manuel de rapprochement.
        or(ne(invoices.billedBy, "g_and_o"), isNull(invoices.billedBy)),
      ),
    )
    .orderBy(desc(invoices.invoicedAt), desc(invoices.periodStart));

  function fmtDate(d: Date | string | null | undefined): string | null {
    if (!d) return null;
    if (d instanceof Date) {
      return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    }
    const [y, m, day] = d.split("-");
    return y && m && day ? `${day}/${m}/${y}` : d;
  }

  const coworkingInvoiceOptions: CoworkingInvoiceOption[] = coworkingInvoiceRows.map((c) => {
    const contactName = `${c.contactFirstName ?? ""} ${c.contactLastName ?? ""}`.trim() || null;
    const issued = fmtDate(c.invoicedAt);
    const periodLabel = (c.periodStart ?? "").slice(0, 7);
    return {
      id: c.id,
      // Label = "Contrat · période (émise le DD/MM/YYYY)" si invoiceDate
      // dispo, sinon juste "Contrat · période". L'émission est la donnée
      // la plus utile pour rapprocher avec la date Dougs.
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

  let quoteSuggestions: Awaited<ReturnType<typeof getQuoteSuggestions>> = [];
  let invoiceResult: Awaited<ReturnType<typeof getInvoiceSuggestions>> = {
    invoices: [],
    creditNotes: [],
    invoiceOptions: [],
  };
  let authError: string | null = null;

  try {
    [quoteSuggestions, invoiceResult] = await Promise.all([
      getQuoteSuggestions(user.id),
      getInvoiceSuggestions(user.id, { debug: debugMode }),
    ]);
  } catch (err) {
    if (err instanceof DougsAuthError) {
      authError = err.message;
    } else {
      throw err;
    }
  }

  const invoiceSuggestions = invoiceResult.invoices;
  const creditNotes = invoiceResult.creditNotes;
  const invoiceOptions = invoiceResult.invoiceOptions;

  // Liste des entrées Dougs déjà rattachées (lue sur les snapshots locaux,
  // sans appel API). Affichée dans une section dépliable en bas.
  const linked = await getLinkedDougsEntries();
  const linkedTotal = linked.quotes.length + linked.invoices.length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">
          Propose des liens entre les devis/factures Dougs non encore reliés et les projets / jalons
          / contrats Paradeos correspondants.
        </p>
        <RefreshAllButton />
      </div>

      {authError ? (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 text-sm">
          {authError}{" "}
          <Link href="/settings/integrations" className="underline">
            Configurer Dougs
          </Link>
        </div>
      ) : null}

      {!authError ? (
        <>
          <section className="rounded-lg border bg-card">
            <header className="border-b px-6 py-4">
              <h2 className="flex items-center gap-2 font-medium text-sm">
                <FileText className="size-4 text-muted-foreground" />
                Devis Dougs non liés ({quoteSuggestions.length})
              </h2>
            </header>
            {quoteSuggestions.length === 0 ? (
              <p className="px-6 py-8 text-center text-muted-foreground text-sm">
                Tous les devis Dougs sont déjà liés à un projet Paradeos. 🎉
              </p>
            ) : (
              <ul className="divide-y">
                {quoteSuggestions.map((s) => (
                  <li key={s.dougs.id} className="space-y-2 px-6 py-4 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <a
                        href={`https://app.dougs.fr/app/c/107610/invoicing/quote?status=pending&quoteId=${s.dougs.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
                      >
                        {s.dougs.reference ?? "—"}
                        <ExternalLink className="size-3" />
                      </a>
                      <span className="rounded-full border bg-muted/50 px-1.5 py-0.5 text-xs">
                        {s.dougs.status ?? "—"}
                      </span>
                      <span className="font-medium">{s.dougs.clientName}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatEur(s.dougs.totalHt)} HT
                      </span>
                      {s.dougs.createdAt ? (
                        <span className="text-[11px] text-muted-foreground">
                          créé le {new Date(s.dougs.createdAt).toLocaleDateString("fr-FR")}
                        </span>
                      ) : null}
                    </div>

                    {s.candidates.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic">
                        Aucun candidat Paradeos pertinent (score ≥ 0.3). Lie manuellement depuis la
                        fiche projet si besoin.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {s.candidates.map((c) => (
                          <li
                            key={c.projectId}
                            className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-xs"
                          >
                            <div className="min-w-0 flex-1">
                              <Link
                                href={`/projets/${c.projectId}`}
                                className="font-medium hover:underline"
                              >
                                {c.projectName}
                              </Link>
                              <span className="ml-2 text-muted-foreground">
                                {c.entityName ?? "—"} ·{" "}
                                <span className="tabular-nums">{formatEur(c.valueAmount)}</span>
                              </span>
                            </div>
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[10px] tabular-nums ${scoreTone(c.score.total)}`}
                              title={`Nom ${(c.score.name * 100).toFixed(0)} % · Montant ${(c.score.amount * 100).toFixed(0)} % · Date ${(c.score.date * 100).toFixed(0)} %`}
                            >
                              {(c.score.total * 100).toFixed(0)} %
                            </span>
                            <LinkQuoteButton projectId={c.projectId} dougsId={s.dougs.id} />
                          </li>
                        ))}
                      </ul>
                    )}
                    <ManualLinkQuote dougsId={s.dougs.id} projects={projectOptions} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border bg-card">
            <header className="border-b px-6 py-4">
              <h2 className="flex items-center gap-2 font-medium text-sm">
                <Receipt className="size-4 text-muted-foreground" />
                Factures Dougs non liées ({invoiceSuggestions.length})
              </h2>
            </header>
            {invoiceSuggestions.length === 0 ? (
              <p className="px-6 py-8 text-center text-muted-foreground text-sm">
                Toutes les factures Dougs sont déjà liées. 🎉
              </p>
            ) : (
              <ul className="divide-y">
                {invoiceSuggestions.map((s) => (
                  <li key={s.dougs.id} className="space-y-2 px-6 py-4 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <a
                        href={`https://app.dougs.fr/app/c/107610/invoicing/sales-invoice?status=${s.dougs.paidAt ? "paid" : "waiting"}&salesInvoiceId=${s.dougs.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
                      >
                        {s.dougs.reference ?? "—"}
                        <ExternalLink className="size-3" />
                      </a>
                      <span className="rounded-full border bg-muted/50 px-1.5 py-0.5 text-xs">
                        {s.dougs.status ?? "—"}
                      </span>
                      {s.dougs.paidAt ? (
                        <span className="rounded-full border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">
                          payée
                        </span>
                      ) : null}
                      <span className="font-medium">{s.dougs.clientName}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatEur(s.dougs.totalHt)} HT
                      </span>
                      {s.dougs.createdAt ? (
                        <span className="text-[11px] text-muted-foreground">
                          créée le {new Date(s.dougs.createdAt).toLocaleDateString("fr-FR")}
                        </span>
                      ) : null}
                    </div>

                    {s.dougs.debugRaw ? (
                      <details className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[10px]">
                        <summary className="cursor-pointer font-medium text-amber-900">
                          🐞 Raw Dougs payload (cliquez pour ouvrir)
                        </summary>
                        <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-amber-950">
                          {JSON.stringify(s.dougs.debugRaw, null, 2)}
                        </pre>
                      </details>
                    ) : null}

                    {s.candidates.length === 0 ? (
                      <p className="text-[11px] text-muted-foreground italic">
                        Aucun candidat Paradeos pertinent.
                      </p>
                    ) : (
                      <ul className="space-y-1.5">
                        {s.candidates.map((c) => {
                          if (c.kind === "invoice") {
                            return (
                              <li
                                key={`i-${c.invoiceId}`}
                                className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-xs"
                              >
                                <div className="min-w-0 flex-1">
                                  <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
                                    Facture
                                  </span>
                                  <span className="ml-2 font-medium">{c.label}</span>
                                  <span className="ml-2 text-muted-foreground">
                                    {c.entityName ?? c.contractName ?? c.projectName ?? "—"} ·{" "}
                                    <span className="tabular-nums">{formatEur(c.amountHt)}</span>
                                  </span>
                                </div>
                                <span
                                  className={`rounded-full border px-2 py-0.5 text-[10px] tabular-nums ${scoreTone(c.score.total)}`}
                                >
                                  {(c.score.total * 100).toFixed(0)} %
                                </span>
                                <LinkInvoiceButton invoiceId={c.invoiceId} dougsId={s.dougs.id} />
                              </li>
                            );
                          }
                          // kind === "new_project_milestone"
                          return (
                            <li
                              key={`p-${c.projectId}`}
                              className="flex items-center justify-between gap-2 rounded-md border border-indigo-200 bg-indigo-50/30 px-3 py-2 text-xs dark:border-indigo-900 dark:bg-indigo-950/20"
                            >
                              <div className="min-w-0 flex-1">
                                <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] text-indigo-700 uppercase tracking-wide dark:bg-indigo-900 dark:text-indigo-300">
                                  Projet
                                  {c.detectedPercent != null ? ` · ${c.detectedPercent} %` : ""}
                                </span>
                                <Link
                                  href={`/projets/${c.projectId}?tab=billing`}
                                  className="ml-2 font-medium hover:underline"
                                >
                                  {c.projectName}
                                </Link>
                                <span className="ml-2 text-muted-foreground">
                                  {c.entityName ?? "—"} · total{" "}
                                  <span className="tabular-nums">
                                    {formatEur(c.projectValueHt)}
                                  </span>{" "}
                                  → facture{" "}
                                  <span className="tabular-nums">{formatEur(c.amountHt)}</span>
                                </span>
                              </div>
                              <span
                                className={`rounded-full border px-2 py-0.5 text-[10px] tabular-nums ${scoreTone(c.score.total)}`}
                                title={`Nom ${(c.score.name * 100).toFixed(0)} % · % standard ${(c.score.amount * 100).toFixed(0)} % · Date ${(c.score.date * 100).toFixed(0)} %`}
                              >
                                {(c.score.total * 100).toFixed(0)} %
                              </span>
                              <LinkProjectAsMilestoneButton
                                projectId={c.projectId}
                                dougsId={s.dougs.id}
                                detectedPercent={c.detectedPercent}
                              />
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <div className="flex flex-col gap-1.5">
                      <ManualLinkInvoice dougsId={s.dougs.id} projects={projectOptions} />
                      <ManualLinkCoworkingInvoice
                        dougsId={s.dougs.id}
                        invoices={coworkingInvoiceOptions}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-lg border border-rose-200 bg-rose-50/20 dark:border-rose-900 dark:bg-rose-950/10">
            <header className="border-rose-200 border-b px-6 py-4 dark:border-rose-900">
              <h2 className="flex items-center gap-2 font-medium text-sm">
                <Receipt className="size-4 text-rose-700 dark:text-rose-300" />
                Factures d'avoir Dougs ({creditNotes.length})
              </h2>
              <p className="text-rose-700/80 text-xs dark:text-rose-300/70">
                Montants négatifs — séparés des factures pour éviter de fausser les rapprochements.
                Rattache chaque avoir à la facture qu'il annule.
              </p>
            </header>
            {creditNotes.length === 0 ? (
              <p className="px-6 py-6 text-center text-muted-foreground text-sm">
                Aucun avoir Dougs.
              </p>
            ) : (
              <ul className="divide-y divide-rose-200 dark:divide-rose-900">
                {creditNotes.map((cn) => (
                  <li key={cn.dougs.id} className="space-y-2 px-6 py-4 text-sm">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <a
                        href={`https://app.dougs.fr/app/c/107610/invoicing/sales-invoice?status=waiting&salesInvoiceId=${cn.dougs.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs hover:underline"
                      >
                        {cn.dougs.reference ?? "—"}
                        <ExternalLink className="size-3" />
                      </a>
                      <span className="rounded-full border border-rose-300 bg-rose-100 px-1.5 py-0.5 font-medium text-[10px] text-rose-700 uppercase tracking-wide dark:border-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
                        Avoir
                      </span>
                      <span className="font-medium">{cn.dougs.clientName}</span>
                      <span className="text-rose-700 tabular-nums dark:text-rose-300">
                        {formatEur(cn.dougs.totalHt)} HT
                      </span>
                      {cn.dougs.createdAt ? (
                        <span className="text-[11px] text-muted-foreground">
                          créé le {new Date(cn.dougs.createdAt).toLocaleDateString("fr-FR")}
                        </span>
                      ) : null}
                    </div>
                    {cn.link ? (
                      <div className="flex items-center justify-between gap-2 rounded-md border bg-background px-3 py-2 text-xs">
                        <div className="min-w-0 flex-1">
                          <span className="text-muted-foreground">Annule&nbsp;:</span>{" "}
                          <span className="font-mono">
                            {cn.link.invoice?.reference ?? cn.link.cancelsDougsInvoiceId}
                          </span>
                          {cn.link.invoice ? (
                            <span className="ml-2 text-muted-foreground">
                              {cn.link.invoice.clientName} ·{" "}
                              <span className="tabular-nums">
                                {formatEur(cn.link.invoice.totalHt)}
                              </span>
                            </span>
                          ) : (
                            <span className="ml-2 text-amber-700 text-xs">
                              (facture introuvable dans Dougs)
                            </span>
                          )}
                        </div>
                        <UnlinkCreditNoteButton creditNoteId={cn.dougs.id} />
                      </div>
                    ) : (
                      <LinkCreditNotePicker creditNoteId={cn.dougs.id} options={invoiceOptions} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <details className="rounded-lg border bg-card">
            <summary className="flex cursor-pointer select-none items-center gap-2 px-6 py-4 font-medium text-sm hover:bg-muted/30">
              <span className="text-muted-foreground">▸</span>
              Déjà rattachés ({linkedTotal})
              <span className="text-muted-foreground text-xs">
                · {linked.quotes.length} devis · {linked.invoices.length} factures
              </span>
            </summary>
            <div className="border-t">
              {linkedTotal === 0 ? (
                <p className="px-6 py-6 text-center text-muted-foreground text-sm">
                  Aucun lien Dougs ↔ Paradeos pour le moment.
                </p>
              ) : (
                <ul className="divide-y">
                  {linked.quotes.map((q) => (
                    <LinkedQuoteRow
                      key={`q-${q.invoiceId}`}
                      quote={q}
                      projectOptions={linked.freeQuoteProjects.map((p) => ({
                        id: p.id,
                        name: p.name,
                        entityName: p.entityName,
                      }))}
                    />
                  ))}
                  {linked.invoices.map((i) => (
                    <LinkedInvoiceRow
                      key={`i-${i.invoiceId}`}
                      invoice={i}
                      freeInvoices={linked.freeInvoices}
                    />
                  ))}
                </ul>
              )}
            </div>
          </details>
        </>
      ) : null}
    </div>
  );
}
