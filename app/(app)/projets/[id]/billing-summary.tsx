import type { BillingMilestone } from "@/db/schema/projects";
import { CheckCircle2, ExternalLink, FileText, Hourglass, Wallet } from "lucide-react";
import Link from "next/link";

type Props = {
  /** Montant projet saisi à la main (valueAmount ou budgetAmount). */
  projectValueHt: number;
  /** Total Dougs si un devis est lié — source de vérité quand présent. */
  dougsQuoteTotalHt: number | null;
  dougsQuoteReference: string | null;
  dougsQuoteId: string | null;
  milestones: BillingMilestone[];
};

function formatEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

/**
 * Synthèse facturation du projet :
 *   - Total = montant Dougs si devis lié, sinon montant manuel
 *   - Facturé = somme des jalons avec statut invoiced ou paid
 *   - Payé = somme des jalons avec statut paid
 *   - Reste = total - facturé
 *
 * Source de vérité visuelle : si Dougs renvoie un total, on l'affiche
 * en priorité avec un badge "depuis Dougs" — sinon valueAmount manuel.
 */
export function BillingSummary({
  projectValueHt,
  dougsQuoteTotalHt,
  dougsQuoteReference,
  dougsQuoteId,
  milestones,
}: Props) {
  const fromDougs = dougsQuoteTotalHt != null;
  const total = fromDougs ? dougsQuoteTotalHt : projectValueHt;

  const invoiced = milestones
    .filter((m) => m.status === "invoiced" || m.status === "paid")
    .reduce((s, m) => s + (m.amountHt || 0), 0);
  const paid = milestones
    .filter((m) => m.status === "paid")
    .reduce((s, m) => s + (m.amountHt || 0), 0);
  const remaining = Math.max(0, total - invoiced);

  const pctInvoiced = total > 0 ? Math.round((invoiced / total) * 100) : 0;
  const pctPaid = total > 0 ? Math.round((paid / total) * 100) : 0;

  return (
    <section className="rounded-lg border bg-card p-5">
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-medium text-sm">Synthèse facturation</h3>
        {fromDougs && dougsQuoteId ? (
          <Link
            href={`https://app.dougs.fr/app/c/107610/invoicing/quote?status=pending&quoteId=${dougsQuoteId}`}
            target="_blank"
            className="inline-flex items-center gap-1 rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300"
            title="Source : devis Dougs"
          >
            <FileText className="size-3" />
            Source : Dougs {dougsQuoteReference ?? ""}
            <ExternalLink className="size-2.5" />
          </Link>
        ) : (
          <span className="rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] text-muted-foreground">
            Source : montant projet (manuel)
          </span>
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat
          icon={<Wallet className="size-4" />}
          label="Total"
          value={formatEur(total)}
          tone="default"
        />
        <Stat
          icon={<FileText className="size-4" />}
          label="Facturé"
          value={formatEur(invoiced)}
          sub={total > 0 ? `${pctInvoiced} %` : null}
          tone={invoiced > 0 ? "amber" : "muted"}
        />
        <Stat
          icon={<CheckCircle2 className="size-4" />}
          label="Payé"
          value={formatEur(paid)}
          sub={total > 0 ? `${pctPaid} %` : null}
          tone={paid > 0 ? "emerald" : "muted"}
        />
        <Stat
          icon={<Hourglass className="size-4" />}
          label="Reste à facturer"
          value={formatEur(remaining)}
          tone={remaining > 0 ? "indigo" : "muted"}
        />
      </div>

      {total > 0 ? (
        <div className="mt-4">
          <div className="relative h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="absolute inset-y-0 left-0 bg-amber-300 dark:bg-amber-700"
              style={{ width: `${Math.min(100, pctInvoiced)}%` }}
            />
            <div
              className="absolute inset-y-0 left-0 bg-emerald-500 dark:bg-emerald-700"
              style={{ width: `${Math.min(100, pctPaid)}%` }}
            />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-muted-foreground">
            <Legend color="bg-emerald-500 dark:bg-emerald-700" label={`Payé ${pctPaid} %`} />
            <Legend
              color="bg-amber-300 dark:bg-amber-700"
              label={`Facturé non payé ${Math.max(0, pctInvoiced - pctPaid)} %`}
            />
            <Legend
              color="bg-muted-foreground/30"
              label={`Reste ${Math.max(0, 100 - pctInvoiced)} %`}
            />
          </div>
        </div>
      ) : null}

      {fromDougs && total > 0 && projectValueHt > 0 && Math.abs(projectValueHt - total) > 1 ? (
        <p className="mt-3 text-[11px] text-muted-foreground">
          ⓘ Montant projet manuel : {formatEur(projectValueHt)}. Le devis Dougs prévaut.
        </p>
      ) : null}
    </section>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string | null;
  tone: "default" | "amber" | "emerald" | "indigo" | "muted";
}) {
  const toneCls =
    tone === "amber"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "emerald"
        ? "text-emerald-700 dark:text-emerald-400"
        : tone === "indigo"
          ? "text-indigo-700 dark:text-indigo-400"
          : tone === "muted"
            ? "text-muted-foreground"
            : "text-foreground";
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
        {icon}
        {label}
      </div>
      <p className={`mt-1 font-semibold text-base tabular-nums ${toneCls}`}>{value}</p>
      {sub ? <p className="text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`size-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}
