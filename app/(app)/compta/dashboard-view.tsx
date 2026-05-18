import { coworkingContracts } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { eq, inArray } from "drizzle-orm";
import { ArrowRight, FileText, Receipt } from "lucide-react";
import Link from "next/link";
import { type ComptaPeriod, PeriodSelector } from "./period-selector";

function formatEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

type KpiTone = "neutral" | "ok" | "warn";

function kpiToneClasses(tone: KpiTone): string {
  switch (tone) {
    case "ok":
      return "border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100";
    case "warn":
      return "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100";
    default:
      return "border-border bg-card text-foreground";
  }
}

type PendingItem = {
  invoiceId: string;
  kind: "milestone" | "coworking" | "one_off";
  label: string;
  projectId: string | null;
  projectName: string | null;
  coworkingContractId: string | null;
  contractName: string | null;
  entityName: string | null;
  amountHt: number;
  status: "draft" | "sent";
};

function periodWindow(period: ComptaPeriod): {
  start: Date | null;
  end: Date | null;
  label: string;
} {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (period) {
    case "current_month":
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 1), label: "mois en cours" };
    case "last_month":
      return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1), label: "mois dernier" };
    case "last_3_months":
      return { start: new Date(y, m - 2, 1), end: new Date(y, m + 1, 1), label: "3 derniers mois" };
    case "current_year":
      return { start: new Date(y, 0, 1), end: new Date(y + 1, 0, 1), label: "année en cours" };
    case "last_year":
      return { start: new Date(y - 1, 0, 1), end: new Date(y, 0, 1), label: "année dernière" };
    case "all":
      return { start: null, end: null, label: "tout" };
    default:
      return {
        start: new Date(y, m - 11, 1),
        end: new Date(y, m + 1, 1),
        label: "12 derniers mois",
      };
  }
}

function inWindow(value: Date | null, win: { start: Date | null; end: Date | null }): boolean {
  if (!value) return false;
  if (win.start && value < win.start) return false;
  if (win.end && value >= win.end) return false;
  return true;
}

export async function DashboardView({ period }: { period: ComptaPeriod }) {
  const conn = await db();
  const win = periodWindow(period);

  // Toutes les invoices facturables (jalons, coworking, one_off — pas
  // les quotes ni les credit_notes pour le dashboard "facturé").
  const rows = await conn
    .select({
      id: invoices.id,
      kind: invoices.kind,
      label: invoices.label,
      amountHt: invoices.amountHt,
      status: invoices.status,
      invoicedAt: invoices.invoicedAt,
      paidAt: invoices.paidAt,
      projectId: invoices.projectId,
      coworkingContractId: invoices.coworkingContractId,
      projectName: projects.name,
      projectEntityName: entities.name,
      contractName: coworkingContracts.name,
    })
    .from(invoices)
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .where(inArray(invoices.kind, ["milestone", "coworking", "one_off"]));

  let billedHt = 0;
  let cashedHt = 0;
  let toBillHt = 0;
  let toCashHt = 0;
  const pending: PendingItem[] = [];

  for (const r of rows) {
    const amount = Number(r.amountHt) || 0;
    const status = r.status;
    if (status === "draft") {
      toBillHt += amount;
      pending.push({
        invoiceId: r.id,
        kind: r.kind as PendingItem["kind"],
        label: r.label,
        projectId: r.projectId,
        projectName: r.projectName,
        coworkingContractId: r.coworkingContractId,
        contractName: r.contractName,
        entityName: r.projectEntityName,
        amountHt: amount,
        status: "draft",
      });
    } else if (status === "sent") {
      if (inWindow(r.invoicedAt, win)) billedHt += amount;
      toCashHt += amount;
      pending.push({
        invoiceId: r.id,
        kind: r.kind as PendingItem["kind"],
        label: r.label,
        projectId: r.projectId,
        projectName: r.projectName,
        coworkingContractId: r.coworkingContractId,
        contractName: r.contractName,
        entityName: r.projectEntityName,
        amountHt: amount,
        status: "sent",
      });
    } else if (status === "paid") {
      const issued = r.invoicedAt ?? r.paidAt;
      if (inWindow(issued, win)) billedHt += amount;
      if (inWindow(r.paidAt, win)) cashedHt += amount;
    }
  }

  // Tri : draft (action) en haut, puis sent (relance), montant décroissant.
  pending.sort((a, b) => {
    const so = (a.status === "draft" ? 0 : 1) - (b.status === "draft" ? 0 : 1);
    if (so !== 0) return so;
    return b.amountHt - a.amountHt;
  });

  const pendingTotal = pending.reduce((s, p) => s + p.amountHt, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelector current={period} />
        <p className="text-[11px] text-muted-foreground">
          Facturé et Encaissé filtrés sur la période. Reste à facturer/encaisser : valeurs
          actuelles.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="neutral" label="Facturé" value={billedHt} hint={`Sur ${win.label}`} />
        <KpiCard tone="ok" label="Encaissé" value={cashedHt} hint={`Sur ${win.label}`} />
        <KpiCard
          tone="warn"
          label="Reste à facturer"
          value={toBillHt}
          hint="Toutes les factures status=draft"
        />
        <KpiCard
          tone="warn"
          label="Reste à encaisser"
          value={toCashHt}
          hint="Émis non payé (relance)"
        />
      </div>

      <section className="rounded-lg border bg-card">
        <header className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h2 className="font-medium text-sm">En attente ({pending.length})</h2>
            <p className="text-muted-foreground text-xs">
              Factures à émettre ou en attente d'encaissement.
            </p>
          </div>
          <span className="text-muted-foreground text-xs tabular-nums">
            Total : {formatEur(pendingTotal)} HT
          </span>
        </header>
        {pending.length === 0 ? (
          <p className="px-6 py-8 text-center text-muted-foreground text-sm">Tout est à jour. 🎉</p>
        ) : (
          <ul className="divide-y">
            {pending.map((p) => (
              <PendingRow key={p.invoiceId} item={p} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint?: string;
  tone: KpiTone;
}) {
  return (
    <div className={`rounded-lg border p-4 ${kpiToneClasses(tone)}`}>
      <div className="text-[11px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 font-semibold text-2xl tabular-nums">{formatEur(value)}</div>
      {hint ? <div className="mt-1 text-[11px] opacity-60">{hint}</div> : null}
    </div>
  );
}

function statusBadge(status: "draft" | "sent"): { label: string; classes: string } {
  if (status === "draft") {
    return { label: "À facturer", classes: "border-slate-300 bg-slate-50 text-slate-700" };
  }
  return { label: "Émis", classes: "border-amber-300 bg-amber-50 text-amber-700" };
}

function PendingRow({ item }: { item: PendingItem }) {
  const badge = statusBadge(item.status);
  const targetLink =
    item.kind === "coworking"
      ? `/coworking/factures/${item.invoiceId}`
      : item.projectId
        ? `/projets/${item.projectId}?tab=billing`
        : null;
  const kindBadge =
    item.kind === "milestone" ? "Jalon" : item.kind === "coworking" ? "Coworking" : "Facture";
  const icon = item.kind === "coworking" ? Receipt : FileText;
  const Icon = icon;
  return (
    <li className="flex items-center justify-between gap-3 px-6 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            <Icon className="-mt-0.5 mr-1 inline size-3" />
            {kindBadge}
          </span>
          {targetLink ? (
            <Link href={targetLink} className="truncate font-medium hover:underline">
              {item.projectName ?? item.contractName ?? item.label}
            </Link>
          ) : (
            <span className="truncate font-medium">{item.label}</span>
          )}
          <span className="truncate text-muted-foreground text-xs">
            {item.label}
            {item.entityName ? ` · ${item.entityName}` : ""}
          </span>
        </div>
      </div>
      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.classes}`}>
        {badge.label}
      </span>
      <span className="w-24 text-right font-medium tabular-nums">{formatEur(item.amountHt)}</span>
      {targetLink ? (
        <Link
          href={targetLink}
          aria-label="Ouvrir"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="size-4" />
        </Link>
      ) : null}
    </li>
  );
}
