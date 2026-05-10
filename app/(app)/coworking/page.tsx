import { CoworkingTabs } from "@/components/coworking/coworking-tabs";
import {
  ContractDesksEditor,
  ContractNameEditor,
  ContractPeriodEditor,
  ContractPriceEditor,
  ContractStatusEditor,
  InvoiceBilledByEditor,
  InvoiceNameEditor,
  InvoicePeriodEditor,
  InvoiceStatusEditor,
} from "@/components/coworking/inline-editors";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listCoworkers,
  listCoworkingContracts,
  listCoworkingInvoices,
} from "@/lib/db/queries/coworking";
import { formatEuro } from "@/lib/format";
import { invoiceTotalHt, invoiceTotalTtc, monthsBetween } from "@/lib/schemas/coworking";
import { ArrowRight, Banknote, Clock, FileText, Mail, Plus, TrendingUp, Users } from "lucide-react";
import Link from "next/link";

export default async function CoworkingPage() {
  const [contracts, invoices, coworkers] = await Promise.all([
    listCoworkingContracts(),
    listCoworkingInvoices(),
    listCoworkers(),
  ]);

  const enCoursContracts = contracts.filter((c) => c.status === "en_cours");
  const aFacturer = invoices.filter((i) => i.status === "a_facturer");

  // KPIs en haut de page (calculés sur les factures déjà chargées).
  const now = new Date();
  const thisMonth = now.getMonth();
  const thisYear = now.getFullYear();

  function htOf(i: (typeof invoices)[number]): number {
    return invoiceTotalHt(i.desks, i.unitPriceHt, monthsBetween(i.periodStart, i.periodEnd));
  }

  // À facturer ce mois-ci (factures `a_facturer` dont la date facture
  // est ce mois ou null + période qui touche le mois en cours).
  const aFacturerThisMonth = aFacturer.filter((i) => {
    const ps = new Date(i.periodStart);
    const pe = new Date(i.periodEnd);
    return (
      (ps.getFullYear() === thisYear && ps.getMonth() === thisMonth) ||
      (pe.getFullYear() === thisYear && pe.getMonth() === thisMonth) ||
      (ps <= now && now <= pe)
    );
  });
  const aFacturerHt = aFacturerThisMonth.reduce((sum, i) => sum + htOf(i), 0);

  // Envoyées et pas encore payées.
  const enAttente = invoices.filter((i) => i.status === "envoyee");
  const enAttenteHt = enAttente.reduce((sum, i) => sum + htOf(i), 0);

  // CA HT YTD : factures `payee` sur l'année courante (par period_start).
  const caYtdHt = invoices
    .filter((i) => i.status === "payee" && new Date(i.periodStart).getFullYear() === thisYear)
    .reduce((sum, i) => sum + htOf(i), 0);

  const contractsTab = (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {contracts.length} contrat{contracts.length > 1 ? "s" : ""} ·{" "}
          <span className="text-foreground">{enCoursContracts.length} en cours</span>
        </p>
        <Button asChild size="sm">
          <Link href="/coworking/contrats/nouveau">
            <Plus className="mr-1 size-4" /> Nouveau contrat
          </Link>
        </Button>
      </div>

      {contracts.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Aucun contrat."
          description="Crée un contrat pour démarrer le suivi d'un coworker."
          action={
            <Button asChild size="sm">
              <Link href="/coworking/contrats/nouveau">Nouveau contrat</Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Coworker</TableHead>
                <TableHead className="text-right">Postes</TableHead>
                <TableHead className="text-right">Prix HT/mois</TableHead>
                <TableHead>Période</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {contracts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <ContractNameEditor id={c.id} value={c.name} />
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {c.contactName ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ContractDesksEditor id={c.id} value={c.desks} />
                  </TableCell>
                  <TableCell className="text-right">
                    <ContractPriceEditor id={c.id} value={c.unitPriceHt} />
                  </TableCell>
                  <TableCell>
                    <ContractPeriodEditor id={c.id} startDate={c.startDate} endDate={c.endDate} />
                  </TableCell>
                  <TableCell>
                    <ContractStatusEditor id={c.id} value={c.status} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/coworking/contrats/${c.id}`}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Ouvrir"
                    >
                      <ArrowRight className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );

  const invoicesTab = (
    <section className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {invoices.length} facture{invoices.length > 1 ? "s" : ""} ·{" "}
        <span className="text-foreground">{aFacturer.length} à facturer</span>
      </p>

      {invoices.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Aucune facture."
          description="Les factures se créent depuis un contrat."
        />
      ) : (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Contrat</TableHead>
                <TableHead>Période</TableHead>
                <TableHead>Émetteur</TableHead>
                <TableHead className="text-right">Postes</TableHead>
                <TableHead className="text-right">HT</TableHead>
                <TableHead className="text-right">TTC</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoices.map((i) => {
                const months = monthsBetween(i.periodStart, i.periodEnd);
                const ht = invoiceTotalHt(i.desks, i.unitPriceHt, months);
                const ttc = invoiceTotalTtc(i.desks, i.unitPriceHt, months, i.vatRate);
                return (
                  <TableRow key={i.id}>
                    <TableCell>
                      <InvoiceNameEditor id={i.id} value={i.name} />
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      <Link
                        href={`/coworking/contrats/${i.contractId}`}
                        className="hover:underline"
                      >
                        {i.contractName}
                      </Link>
                      {i.contactName ? <span className="text-xs"> · {i.contactName}</span> : null}
                    </TableCell>
                    <TableCell>
                      <InvoicePeriodEditor
                        id={i.id}
                        periodStart={i.periodStart}
                        periodEnd={i.periodEnd}
                      />
                    </TableCell>
                    <TableCell>
                      <InvoiceBilledByEditor id={i.id} value={i.billedBy} />
                    </TableCell>
                    <TableCell
                      className="text-right text-muted-foreground tabular-nums"
                      title="Postes du contrat (édition sur la fiche contrat)"
                    >
                      {i.desks}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(ht)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatEuro(ttc)}</TableCell>
                    <TableCell>
                      <InvoiceStatusEditor id={i.id} value={i.status} />
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
  );

  const coworkersTab = (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground text-sm">
          {coworkers.length} coworker{coworkers.length > 1 ? "s" : ""}
        </p>
        <Button asChild size="sm" variant="outline">
          <Link href="/contacts/nouveau?qualification=coworker">
            <Plus className="mr-1 size-4" /> Nouveau coworker
          </Link>
        </Button>
      </div>

      {coworkers.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Pas encore de coworker."
          description="Crée un contact qualifié 'Coworker' depuis la fiche contact ou via le bouton ci-dessus."
        />
      ) : (
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nom</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Téléphone</TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {coworkers.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link href={`/contacts/${c.id}`} className="hover:underline">
                      {c.firstName} {c.lastName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {c.email ? (
                      <a
                        href={`mailto:${c.email}`}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Mail className="size-3" />
                        {c.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{c.phone ?? "—"}</TableCell>
                  <TableCell>
                    <Link
                      href={`/contacts/${c.id}`}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Ouvrir"
                    >
                      <ArrowRight className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin Parade"
        title="Coworking"
        description="Suivi des contrats de location de poste et facturation associée."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard
          icon={<Banknote className="size-4 text-amber-600 dark:text-amber-400" />}
          label="À facturer ce mois"
          value={`${aFacturerThisMonth.length} facture${aFacturerThisMonth.length > 1 ? "s" : ""}`}
          sub={formatEuro(aFacturerHt)}
        />
        <KpiCard
          icon={<Clock className="size-4 text-blue-600 dark:text-blue-400" />}
          label="En attente de paiement"
          value={`${enAttente.length} facture${enAttente.length > 1 ? "s" : ""}`}
          sub={formatEuro(enAttenteHt)}
        />
        <KpiCard
          icon={<TrendingUp className="size-4 text-emerald-600 dark:text-emerald-400" />}
          label={`CA HT ${thisYear}`}
          value={formatEuro(caYtdHt)}
          sub="Factures payées cette année"
        />
      </div>

      <CoworkingTabs
        contracts={contractsTab}
        invoices={invoicesTab}
        coworkers={coworkersTab}
        contractsCount={contracts.length}
        invoicesCount={invoices.length}
        coworkersCount={coworkers.length}
      />
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        {icon}
        <span className="uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1.5 font-semibold text-xl tabular-nums">{value}</p>
      <p className="text-muted-foreground text-xs tabular-nums">{sub}</p>
    </div>
  );
}
