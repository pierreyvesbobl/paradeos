import { coworkingContracts, coworkingInvoices } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { type BillingMilestone, projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { asc, eq } from "drizzle-orm";
import { ArrowRight, FileText, Receipt } from "lucide-react";
import Link from "next/link";

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

type PendingMilestone = {
  kind: "milestone";
  projectId: string;
  projectName: string;
  entityName: string | null;
  milestoneId: string;
  label: string;
  amountHt: number;
  status: "todo" | "invoiced";
};

type PendingCoworking = {
  kind: "coworking";
  invoiceId: string;
  name: string;
  contractName: string | null;
  entityName: string | null;
  amountHt: number;
  status: "a_facturer" | "envoyee";
  periodStart: string;
};

type PendingItem = PendingMilestone | PendingCoworking;

export async function DashboardView() {
  const conn = await db();

  // Tous les projets client (peu importe le statut) — on filtre les
  // jalons par leur propre status pour calculer les agrégats.
  const projectRows = await conn
    .select({
      id: projects.id,
      name: projects.name,
      entityName: entities.name,
      milestones: projects.billingMilestones,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(eq(projects.kind, "client"))
    .orderBy(asc(projects.name));

  // Toutes les factures coworking (avec contrat + entité de facturation).
  const cwRows = await conn
    .select({
      id: coworkingInvoices.id,
      name: coworkingInvoices.name,
      desks: coworkingInvoices.desks,
      unitPriceHt: coworkingInvoices.unitPriceHt,
      status: coworkingInvoices.status,
      periodStart: coworkingInvoices.periodStart,
      contractName: coworkingContracts.name,
      entityName: entities.name,
    })
    .from(coworkingInvoices)
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, coworkingInvoices.contractId))
    .leftJoin(entities, eq(entities.id, coworkingContracts.billToEntityId));

  // Agrégats HT.
  let billedHt = 0; // émise ou payée (projets: invoiced+paid, coworking: envoyee+payee)
  let cashedHt = 0; // payée
  let toBillHt = 0; // à facturer (projets: todo, coworking: a_facturer)
  let toCashHt = 0; // émise non payée (projets: invoiced, coworking: envoyee)

  const pending: PendingItem[] = [];

  for (const p of projectRows) {
    const ms: BillingMilestone[] = Array.isArray(p.milestones) ? p.milestones : [];
    for (const m of ms) {
      const amount = Number(m.amountHt) || 0;
      if (m.status === "todo") {
        toBillHt += amount;
        pending.push({
          kind: "milestone",
          projectId: p.id,
          projectName: p.name,
          entityName: p.entityName,
          milestoneId: m.id,
          label: m.label,
          amountHt: amount,
          status: "todo",
        });
      } else if (m.status === "invoiced") {
        billedHt += amount;
        toCashHt += amount;
        pending.push({
          kind: "milestone",
          projectId: p.id,
          projectName: p.name,
          entityName: p.entityName,
          milestoneId: m.id,
          label: m.label,
          amountHt: amount,
          status: "invoiced",
        });
      } else if (m.status === "paid") {
        billedHt += amount;
        cashedHt += amount;
      }
    }
  }

  for (const c of cwRows) {
    const amount = (Number(c.unitPriceHt) || 0) * c.desks;
    if (c.status === "a_facturer") {
      toBillHt += amount;
      pending.push({
        kind: "coworking",
        invoiceId: c.id,
        name: c.name,
        contractName: c.contractName,
        entityName: c.entityName,
        amountHt: amount,
        status: "a_facturer",
        periodStart: c.periodStart,
      });
    } else if (c.status === "envoyee") {
      billedHt += amount;
      toCashHt += amount;
      pending.push({
        kind: "coworking",
        invoiceId: c.id,
        name: c.name,
        contractName: c.contractName,
        entityName: c.entityName,
        amountHt: amount,
        status: "envoyee",
        periodStart: c.periodStart,
      });
    } else if (c.status === "payee") {
      billedHt += amount;
      cashedHt += amount;
    }
  }

  // Tri liste d'attente : à facturer d'abord (action immédiate), puis
  // émises non payées (relance), montant décroissant à statut égal.
  const statusOrder: Record<PendingItem["status"], number> = {
    todo: 0,
    a_facturer: 0,
    invoiced: 1,
    envoyee: 1,
  };
  pending.sort((a, b) => {
    const so = statusOrder[a.status] - statusOrder[b.status];
    if (so !== 0) return so;
    return b.amountHt - a.amountHt;
  });

  const pendingTotal = pending.reduce((s, p) => s + p.amountHt, 0);

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard tone="neutral" label="Facturé" value={billedHt} hint="Émis + encaissé" />
        <KpiCard tone="ok" label="Encaissé" value={cashedHt} hint="Marqué payé" />
        <KpiCard
          tone="warn"
          label="Reste à facturer"
          value={toBillHt}
          hint="Jalons todo + à facturer"
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
              Jalons et factures à facturer ou en attente d'encaissement.
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
              <PendingRow
                key={p.kind === "milestone" ? `m-${p.milestoneId}` : `c-${p.invoiceId}`}
                item={p}
              />
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

function statusBadge(status: PendingItem["status"]): { label: string; classes: string } {
  switch (status) {
    case "todo":
      return {
        label: "À facturer",
        classes: "border-slate-300 bg-slate-50 text-slate-700",
      };
    case "a_facturer":
      return {
        label: "À facturer",
        classes: "border-slate-300 bg-slate-50 text-slate-700",
      };
    case "invoiced":
      return {
        label: "Émis",
        classes: "border-amber-300 bg-amber-50 text-amber-700",
      };
    case "envoyee":
      return {
        label: "Émis",
        classes: "border-amber-300 bg-amber-50 text-amber-700",
      };
  }
}

function PendingRow({ item }: { item: PendingItem }) {
  const badge = statusBadge(item.status);
  if (item.kind === "milestone") {
    return (
      <li className="flex items-center justify-between gap-3 px-6 py-3 text-sm">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
              <FileText className="-mt-0.5 mr-1 inline size-3" />
              Jalon
            </span>
            <Link
              href={`/projets/${item.projectId}?tab=billing`}
              className="truncate font-medium hover:underline"
            >
              {item.projectName}
            </Link>
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
        <Link
          href={`/projets/${item.projectId}?tab=billing`}
          aria-label="Ouvrir le projet"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="size-4" />
        </Link>
      </li>
    );
  }
  return (
    <li className="flex items-center justify-between gap-3 px-6 py-3 text-sm">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide">
            <Receipt className="-mt-0.5 mr-1 inline size-3" />
            Coworking
          </span>
          <Link
            href={`/coworking/factures/${item.invoiceId}`}
            className="truncate font-medium hover:underline"
          >
            {item.name}
          </Link>
          <span className="truncate text-muted-foreground text-xs">
            {item.contractName ?? "—"}
            {item.entityName ? ` · ${item.entityName}` : ""}
          </span>
        </div>
      </div>
      <span className={`rounded-full border px-2 py-0.5 text-[10px] ${badge.classes}`}>
        {badge.label}
      </span>
      <span className="w-24 text-right font-medium tabular-nums">{formatEur(item.amountHt)}</span>
      <Link
        href={`/coworking/factures/${item.invoiceId}`}
        aria-label="Ouvrir la facture"
        className="text-muted-foreground hover:text-foreground"
      >
        <ArrowRight className="size-4" />
      </Link>
    </li>
  );
}
