import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { and, eq, inArray } from "drizzle-orm";
import { ArrowRight, CheckCircle2, FileSignature, Hourglass, Wallet } from "lucide-react";
import Link from "next/link";
import { type ComptaPeriod, PeriodSelector } from "./period-selector";
import { inWindow, periodWindow } from "./period-window";

function formatEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

type ProjectRow = {
  projectId: string;
  projectName: string;
  entityName: string | null;
  // Montant du devis signé (source de vérité = total Dougs si présent,
  // sinon valeur saisie manuellement sur l'invoice).
  quoteHt: number;
  quoteReference: string | null;
  quoteIssuedAt: Date | null;
  facturedHt: number;
  paidHt: number;
  remainingHt: number;
};

export async function SignedQuotesView({ period }: { period: ComptaPeriod }) {
  const conn = await db();
  const win = periodWindow(period);

  // Devis "signés" : invoice kind=quote avec status='accepted'.
  // Filtrage par période = date de signature/émission (invoicedAt avec
  // fallback dougsIssuedAt). "Tout" => pas de filtre.
  const allSigned = await conn
    .select({
      invoiceId: invoices.id,
      projectId: invoices.projectId,
      projectName: projects.name,
      entityName: entities.name,
      amountHt: invoices.amountHt,
      dougsTotalHt: invoices.dougsTotalHt,
      reference: invoices.reference,
      dougsReference: invoices.dougsReference,
      issuedAt: invoices.invoicedAt,
      dougsIssuedAt: invoices.dougsIssuedAt,
    })
    .from(invoices)
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(and(eq(invoices.kind, "quote"), eq(invoices.status, "accepted")));

  const signedQuotes =
    win.start === null && win.end === null
      ? allSigned
      : allSigned.filter((q) => inWindow(q.issuedAt ?? q.dougsIssuedAt ?? null, win));

  const projectIds = signedQuotes.map((q) => q.projectId).filter((id): id is string => id !== null);

  // Toutes les factures liées à ces projets (milestones + one_off, pas
  // les quotes ni credit_notes). On agrège facturé / payé par project_id.
  const projectInvoices =
    projectIds.length > 0
      ? await conn
          .select({
            projectId: invoices.projectId,
            amountHt: invoices.amountHt,
            status: invoices.status,
          })
          .from(invoices)
          .where(
            and(
              inArray(invoices.kind, ["milestone", "one_off"]),
              inArray(invoices.projectId, projectIds),
            ),
          )
      : [];

  // Agg par projet.
  const aggByProject = new Map<string, { factured: number; paid: number }>();
  for (const inv of projectInvoices) {
    if (!inv.projectId) continue;
    const a = aggByProject.get(inv.projectId) ?? { factured: 0, paid: 0 };
    const amount = Number(inv.amountHt) || 0;
    if (inv.status === "sent" || inv.status === "paid") a.factured += amount;
    if (inv.status === "paid") a.paid += amount;
    aggByProject.set(inv.projectId, a);
  }

  const rows: ProjectRow[] = signedQuotes
    .filter((q): q is typeof q & { projectId: string } => q.projectId !== null)
    .map((q) => {
      const agg = aggByProject.get(q.projectId) ?? { factured: 0, paid: 0 };
      const quoteHt = Number(q.dougsTotalHt ?? q.amountHt ?? 0);
      return {
        projectId: q.projectId,
        projectName: q.projectName ?? "(projet supprimé)",
        entityName: q.entityName,
        quoteHt,
        quoteReference: q.dougsReference ?? q.reference,
        quoteIssuedAt: q.issuedAt,
        facturedHt: agg.factured,
        paidHt: agg.paid,
        remainingHt: Math.max(0, quoteHt - agg.factured),
      };
    })
    .sort((a, b) => b.quoteHt - a.quoteHt);

  // Totaux agrégés.
  const totalSigned = rows.reduce((s, r) => s + r.quoteHt, 0);
  const totalFactured = rows.reduce((s, r) => s + r.facturedHt, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paidHt, 0);
  const totalRemaining = rows.reduce((s, r) => s + r.remainingHt, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodSelector current={period} />
        <p className="text-[11px] text-muted-foreground">
          Filtre par date de signature (émission du devis).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          tone="indigo"
          icon={FileSignature}
          label="Devis signés"
          value={totalSigned}
          hint={`${rows.length} projet${rows.length > 1 ? "s" : ""}`}
        />
        <KpiCard
          tone="amber"
          icon={Wallet}
          label="Facturés"
          value={totalFactured}
          hint={pct(totalFactured, totalSigned)}
        />
        <KpiCard
          tone="slate"
          icon={Hourglass}
          label="Reste à facturer"
          value={totalRemaining}
          hint={pct(totalRemaining, totalSigned)}
        />
        <KpiCard
          tone="emerald"
          icon={CheckCircle2}
          label="Encaissés"
          value={totalPaid}
          hint={pct(totalPaid, totalSigned)}
        />
      </div>

      <section className="rounded-lg border bg-card">
        <header className="border-b px-6 py-4">
          <h2 className="font-medium text-sm">Détail par projet</h2>
        </header>
        {rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-muted-foreground text-sm">
            Aucun devis signé pour le moment.
          </p>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <ProjectProgressRow key={r.projectId} row={r} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

type Tone = "indigo" | "amber" | "slate" | "emerald";

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "indigo":
      return "border-indigo-200 bg-indigo-50/50 text-indigo-900 dark:border-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-100";
    case "amber":
      return "border-amber-200 bg-amber-50/50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100";
    case "emerald":
      return "border-emerald-200 bg-emerald-50/50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-100";
    default:
      return "border-border bg-card text-foreground";
  }
}

function iconColor(tone: Tone): string {
  switch (tone) {
    case "indigo":
      return "text-indigo-600 dark:text-indigo-300";
    case "amber":
      return "text-amber-600 dark:text-amber-300";
    case "emerald":
      return "text-emerald-600 dark:text-emerald-300";
    default:
      return "text-muted-foreground";
  }
}

function pct(value: number, total: number): string {
  if (total <= 0) return "—";
  return `${((value / total) * 100).toFixed(0)} % du signé`;
}

function KpiCard({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  tone: Tone;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className={`rounded-lg border p-4 ${toneClasses(tone)}`}>
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide opacity-70">
        <Icon className={`size-4 ${iconColor(tone)}`} />
        {label}
      </div>
      <div className="mt-1 font-semibold text-2xl tabular-nums">{formatEur(value)}</div>
      {hint ? <div className="mt-1 text-[11px] opacity-60">{hint}</div> : null}
    </div>
  );
}

function ProjectProgressRow({ row }: { row: ProjectRow }) {
  const total = row.quoteHt;
  const facturedPct = total > 0 ? Math.min(100, (row.facturedHt / total) * 100) : 0;
  const paidPct = total > 0 ? Math.min(100, (row.paidHt / total) * 100) : 0;

  return (
    <li className="px-6 py-4 hover:bg-muted/20 transition-colors">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <Link
              href={`/projets/${row.projectId}?tab=billing`}
              className="font-medium text-sm hover:underline"
            >
              {row.projectName}
            </Link>
            {row.entityName ? (
              <span className="text-muted-foreground text-xs">{row.entityName}</span>
            ) : null}
            {row.quoteReference ? (
              <span className="rounded-full border bg-muted/40 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                {row.quoteReference}
              </span>
            ) : null}
          </div>
        </div>
        <Link
          href={`/projets/${row.projectId}?tab=billing`}
          aria-label="Ouvrir le projet"
          className="text-muted-foreground hover:text-foreground"
        >
          <ArrowRight className="size-4" />
        </Link>
      </div>

      {/* Barre de progression stratifiée :
            base muted (reste à facturer)
            amber (facturé non payé)
            emerald (payé)
      */}
      <div className="relative h-2.5 overflow-hidden rounded-full bg-muted">
        <div
          className="absolute inset-y-0 left-0 bg-amber-300 dark:bg-amber-700"
          style={{ width: `${facturedPct}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 bg-emerald-500 dark:bg-emerald-600"
          style={{ width: `${paidPct}%` }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-indigo-400" />
          <span className="text-muted-foreground">Signé</span>
          <strong className="tabular-nums">{formatEur(total)}</strong>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-amber-400" />
          <span className="text-muted-foreground">Facturé</span>
          <strong className="tabular-nums">{formatEur(row.facturedHt)}</strong>
          <span className="text-muted-foreground">({facturedPct.toFixed(0)} %)</span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">Encaissé</span>
          <strong className="tabular-nums">{formatEur(row.paidHt)}</strong>
          <span className="text-muted-foreground">({paidPct.toFixed(0)} %)</span>
        </span>
        <span className="ml-auto inline-flex items-center gap-1.5">
          <span className="text-muted-foreground">Reste à facturer</span>
          <strong className="tabular-nums">{formatEur(row.remainingHt)}</strong>
        </span>
      </div>
    </li>
  );
}
