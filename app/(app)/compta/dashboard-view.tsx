import { coworkingContracts } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { demoAmount, demoCompanyName, demoProjectName } from "@/lib/demo/anonymize";
import { isDemoMode } from "@/lib/demo/server";
import {
  ArrowRight,
  BellRinging,
  Buildings,
  Coins,
  FlagPennant,
  HourglassMedium,
  Signature,
} from "@phosphor-icons/react/dist/ssr";
import { and, eq, inArray, isNull, ne, or } from "drizzle-orm";
import Link from "next/link";
import { ComptaSegmentSwitcher } from "./compta-segment-switcher";
import { type ComptaPeriod, PeriodSelector } from "./period-selector";
import { inWindow, periodWindow } from "./period-window";

export type ComptaSegment = "conso" | "presta" | "cowork";

const SEGMENT_KINDS: Record<ComptaSegment, ("milestone" | "coworking" | "one_off")[]> = {
  conso: ["milestone", "coworking", "one_off"],
  presta: ["milestone", "one_off"],
  cowork: ["coworking"],
};

function formatEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

type Tint = "blue" | "green" | "gray" | "orange" | "mauve";

function tintStyles(tint: Tint) {
  return {
    background: `var(--ds-tint-${tint}-bg)`,
    color: `var(--ds-tint-${tint}-text)`,
    borderColor: `var(--ds-tint-${tint}-bg)`,
  };
}

type PendingItem = {
  invoiceId: string;
  kind: "milestone" | "coworking" | "one_off";
  label: string;
  projectId: string | null;
  projectName: string | null;
  coworkingContractId: string | null;
  contractName: string | null;
  entityId: string | null;
  entityName: string | null;
  amountHt: number;
  status: "draft" | "sent";
};

type ProjectDetailRow = {
  projectId: string;
  projectName: string;
  entityId: string | null;
  entityName: string | null;
  quoteReference: string | null;
  signedHt: number;
  billedHt: number;
  cashedHt: number;
  remainingHt: number;
};

export async function DashboardView({
  period,
  segment,
}: {
  period: ComptaPeriod;
  segment: ComptaSegment;
}) {
  const conn = await db();
  const win = periodWindow(period);
  const showSigned = segment !== "cowork";
  const demo = await isDemoMode();
  const dAmt = (id: string, n: number) => (demo ? demoAmount(id, n) : n);
  const dCompany = (id: string | null, name: string | null) =>
    demo && id ? demoCompanyName(id) : name;
  const dProject = (id: string | null, name: string | null) =>
    demo && id ? demoProjectName(id) : name;

  // Toutes les invoices facturables, filtrées par segment.
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
      projectEntityId: entities.id,
      projectEntityName: entities.name,
      contractName: coworkingContracts.name,
    })
    .from(invoices)
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .where(
      and(
        inArray(invoices.kind, SEGMENT_KINDS[segment]),
        // Exclut les factures coworking facturées par G&O des KPIs.
        or(ne(invoices.billedBy, "g_and_o"), isNull(invoices.billedBy)),
      ),
    );

  // Devis signés (quote + accepted), pour total "Montant signé" et détail
  // par projet. Filtrage par période = date d'émission de la quote.
  // En mode Cowork, on n'a pas de devis : on saute la requête.
  const allSigned = showSigned
    ? await conn
        .select({
          invoiceId: invoices.id,
          projectId: invoices.projectId,
          projectName: projects.name,
          entityId: entities.id,
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
        .where(and(eq(invoices.kind, "quote"), eq(invoices.status, "accepted")))
    : [];

  const signedQuotes =
    win.start === null && win.end === null
      ? allSigned
      : allSigned.filter((q) => inWindow(q.issuedAt ?? q.dougsIssuedAt ?? null, win));

  let billedHt = 0;
  let cashedHt = 0;
  let toBillHt = 0;
  let toCashHt = 0;
  const pending: PendingItem[] = [];

  for (const r of rows) {
    const amount = dAmt(r.id, Number(r.amountHt) || 0);
    const status = r.status;
    if (status === "draft") {
      toBillHt += amount;
      pending.push({
        invoiceId: r.id,
        kind: r.kind as PendingItem["kind"],
        label: r.label,
        projectId: r.projectId,
        projectName: dProject(r.projectId, r.projectName),
        coworkingContractId: r.coworkingContractId,
        contractName: r.contractName,
        entityId: r.projectEntityId,
        entityName: dCompany(r.projectEntityId, r.projectEntityName),
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
        projectName: dProject(r.projectId, r.projectName),
        coworkingContractId: r.coworkingContractId,
        contractName: r.contractName,
        entityId: r.projectEntityId,
        entityName: dCompany(r.projectEntityId, r.projectEntityName),
        amountHt: amount,
        status: "sent",
      });
    } else if (status === "paid") {
      const issued = r.invoicedAt ?? r.paidAt;
      if (inWindow(issued, win)) billedHt += amount;
      if (inWindow(r.paidAt, win)) cashedHt += amount;
    }
  }

  pending.sort((a, b) => {
    const so = (a.status === "draft" ? 0 : 1) - (b.status === "draft" ? 0 : 1);
    if (so !== 0) return so;
    return b.amountHt - a.amountHt;
  });
  const pendingTotal = pending.reduce((s, p) => s + p.amountHt, 0);

  // Agrégats par projet pour la section "Détail par projet".
  const projectIds = signedQuotes.map((q) => q.projectId).filter((id): id is string => id !== null);
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
  const aggByProject = new Map<string, { billed: number; cashed: number }>();
  for (const inv of projectInvoices) {
    if (!inv.projectId) continue;
    const a = aggByProject.get(inv.projectId) ?? { billed: 0, cashed: 0 };
    const amount = dAmt(inv.projectId, Number(inv.amountHt) || 0);
    if (inv.status === "sent" || inv.status === "paid") a.billed += amount;
    if (inv.status === "paid") a.cashed += amount;
    aggByProject.set(inv.projectId, a);
  }
  const detailRows: ProjectDetailRow[] = signedQuotes
    .filter((q): q is typeof q & { projectId: string } => q.projectId !== null)
    .map((q) => {
      const agg = aggByProject.get(q.projectId) ?? { billed: 0, cashed: 0 };
      const signedHt = dAmt(`signed:${q.projectId}`, Number(q.dougsTotalHt ?? q.amountHt ?? 0));
      return {
        projectId: q.projectId,
        projectName: dProject(q.projectId, q.projectName) ?? "(projet supprimé)",
        entityId: q.entityId,
        entityName: dCompany(q.entityId, q.entityName),
        quoteReference: q.dougsReference ?? q.reference,
        signedHt,
        billedHt: agg.billed,
        cashedHt: agg.cashed,
        remainingHt: Math.max(0, signedHt - agg.billed),
      };
    })
    .sort((a, b) => b.signedHt - a.signedHt);

  const totalSignedHt = detailRows.reduce((s, r) => s + r.signedHt, 0);
  // En mode Cowork, on n'a pas de "signé" donc le reste-à-facturer = brouillons.
  const remainingToBillTotal = showSigned
    ? Math.max(0, totalSignedHt - billedHt - toBillHt) + toBillHt
    : toBillHt;
  const factPct = totalSignedHt > 0 ? Math.round((billedHt / totalSignedHt) * 100) : 0;
  const encPct = totalSignedHt > 0 ? Math.round((cashedHt / totalSignedHt) * 100) : 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <PeriodSelector current={period} />
        <ComptaSegmentSwitcher current={segment} />
        <span className="flex-1" />
        <p className="text-[11px] text-[var(--ds-text-tertiary)]">
          Sur la période · restes en temps réel
        </p>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {showSigned ? (
          <KpiCard
            tint="blue"
            icon={<Signature size={18} weight="duotone" />}
            label="Montant signé"
            value={totalSignedHt}
            hint={`${detailRows.length} ${detailRows.length > 1 ? "projets signés" : "projet signé"}`}
          />
        ) : (
          <KpiCard
            tint="blue"
            icon={<Signature size={18} weight="duotone" />}
            label="Facturé"
            value={billedHt}
            hint={"Sur la période"}
          />
        )}
        <KpiCard
          tint="green"
          icon={<Coins size={18} weight="duotone" />}
          label="Encaissé"
          value={cashedHt}
          hint={showSigned && totalSignedHt > 0 ? `${encPct} % du signé` : "Sur la période"}
        />
        <KpiCard
          tint="gray"
          icon={<HourglassMedium size={18} weight="duotone" />}
          label="Reste à facturer"
          value={remainingToBillTotal}
          hint={toBillHt > 0 ? `${formatEur(toBillHt)} en brouillon` : "à émettre"}
        />
        <KpiCard
          tint="orange"
          icon={<BellRinging size={18} weight="duotone" />}
          label="Reste à encaisser"
          value={toCashHt}
          hint="émis non payé"
        />
      </div>

      {showSigned ? (
        <SignedFlowCard
          signed={totalSignedHt}
          billed={billedHt}
          cashed={cashedHt}
          toBill={remainingToBillTotal}
          factPct={factPct}
          encPct={encPct}
        />
      ) : null}

      {showSigned && detailRows.length > 0 ? <ProjectDetailCard rows={detailRows} /> : null}

      <PendingCard items={pending} total={pendingTotal} />
    </div>
  );
}

function KpiCard({
  tint,
  icon,
  label,
  value,
  hint,
}: {
  tint: Tint;
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
}) {
  const t = tintStyles(tint);
  return (
    <div
      className="flex flex-col gap-2.5 rounded-[10px] border p-4"
      style={{ background: t.background, borderColor: t.background }}
    >
      <div className="flex items-center gap-2" style={{ color: `var(--ds-tint-${tint}-dot)` }}>
        {icon}
        <span
          className="font-semibold text-[11px] uppercase tracking-wider"
          style={{ color: t.color, opacity: 0.85 }}
        >
          {label}
        </span>
      </div>
      <span
        className="font-semibold text-[25px] tabular-nums tabular-nums tracking-tight"
        style={{ color: t.color }}
      >
        {formatEur(value)}
      </span>
      {hint ? (
        <span className="text-[12px]" style={{ color: t.color, opacity: 0.7 }}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function SignedFlowCard({
  signed,
  billed,
  cashed,
  toBill,
  factPct,
  encPct,
}: {
  signed: number;
  billed: number;
  cashed: number;
  toBill: number;
  factPct: number;
  encPct: number;
}) {
  const billedW = signed > 0 ? Math.min(100, (billed / signed) * 100) : 0;
  const cashedW = signed > 0 ? Math.min(100, (cashed / signed) * 100) : 0;
  return (
    <section className="rounded-xl border bg-card p-4 sm:p-5">
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="font-semibold text-[14px] text-foreground">Du signé à l'encaissé</h2>
        <span className="flex-1" />
        <span className="text-[12px] text-[var(--ds-text-tertiary)]">
          Reste à facturer{" "}
          <b className="font-semibold text-muted-foreground tabular-nums">{formatEur(toBill)}</b>
        </span>
      </div>
      <div className="relative h-3 overflow-hidden rounded-full bg-[var(--ds-bg-press)]">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${billedW}%`,
            background: "color-mix(in srgb, var(--ds-tint-blue-dot) 48%, white)",
          }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${cashedW}%`,
            background: "color-mix(in srgb, var(--ds-tint-green-dot) 48%, white)",
          }}
        />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-[12px] text-muted-foreground">
        <Legend dotColor="var(--ds-text-tertiary)" label="Signé" value={formatEur(signed)} />
        <Legend
          dotColor="var(--ds-tint-blue-dot)"
          label="Facturé"
          value={formatEur(billed)}
          pct={signed > 0 ? `${factPct} %` : null}
        />
        <Legend
          dotColor="var(--ds-tint-green-dot)"
          label="Encaissé"
          value={formatEur(cashed)}
          pct={signed > 0 ? `${encPct} %` : null}
        />
      </div>
    </section>
  );
}

function Legend({
  dotColor,
  label,
  value,
  pct,
}: {
  dotColor: string;
  label: string;
  value: string;
  pct?: string | null;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block size-2 flex-none rounded-full"
        style={{ background: dotColor }}
      />
      {label} <b className="font-semibold text-foreground tabular-nums">{value}</b>
      {pct ? <span className="text-[var(--ds-text-tertiary)]">{pct}</span> : null}
    </span>
  );
}

function ProjectDetailCard({ rows }: { rows: ProjectDetailRow[] }) {
  return (
    <section className="rounded-xl border bg-card px-4 pb-3 sm:px-5">
      <header className="flex items-baseline gap-3 px-1 pt-4 pb-1.5">
        <h2 className="font-semibold text-[15px] text-foreground">Détail par projet</h2>
        <span className="text-[12px] text-[var(--ds-text-tertiary)]">
          Prestations · par montant signé décroissant
        </span>
      </header>
      {rows.map((r) => {
        const billedW = r.signedHt > 0 ? Math.min(100, (r.billedHt / r.signedHt) * 100) : 0;
        const cashedW = r.signedHt > 0 ? Math.min(100, (r.cashedHt / r.signedHt) * 100) : 0;
        const factPct = r.signedHt > 0 ? Math.round((r.billedHt / r.signedHt) * 100) : 0;
        const encPct = r.signedHt > 0 ? Math.round((r.cashedHt / r.signedHt) * 100) : 0;
        return (
          <Link
            key={r.projectId}
            href={`/projets/${r.projectId}?tab=billing`}
            className="block border-t px-1 py-3.5 transition-colors hover:bg-[var(--ds-bg-hover)]"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-foreground text-sm">{r.projectName}</span>
              {r.entityName ? (
                <span className="text-[12px] text-[var(--ds-text-tertiary)]">{r.entityName}</span>
              ) : null}
              {r.quoteReference ? (
                <span className="rounded border bg-[var(--ds-bg-surface)] px-1.5 py-0 text-[11px] text-[var(--ds-text-tertiary)] tabular-nums">
                  {r.quoteReference}
                </span>
              ) : null}
              <span className="flex-1" />
              <span className="text-[12px] text-[var(--ds-text-tertiary)]">Reste à facturer</span>
              <span className="font-semibold text-[13px] text-foreground tabular-nums">
                {formatEur(r.remainingHt)}
              </span>
            </div>
            <div className="relative my-2.5 h-2 overflow-hidden rounded-full bg-[var(--ds-bg-press)]">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${billedW}%`,
                  background: "color-mix(in srgb, var(--ds-tint-blue-dot) 48%, white)",
                }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${cashedW}%`,
                  background: "color-mix(in srgb, var(--ds-tint-green-dot) 48%, white)",
                }}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px] text-muted-foreground">
              <Legend
                dotColor="var(--ds-text-tertiary)"
                label="Signé"
                value={formatEur(r.signedHt)}
              />
              <Legend
                dotColor="var(--ds-tint-blue-dot)"
                label="Facturé"
                value={formatEur(r.billedHt)}
                pct={r.signedHt > 0 ? `${factPct} %` : null}
              />
              <Legend
                dotColor="var(--ds-tint-green-dot)"
                label="Encaissé"
                value={formatEur(r.cashedHt)}
                pct={r.signedHt > 0 ? `${encPct} %` : null}
              />
            </div>
          </Link>
        );
      })}
    </section>
  );
}

function PendingCard({ items, total }: { items: PendingItem[]; total: number }) {
  return (
    <section className="rounded-xl border bg-card px-4 pb-3 sm:px-5">
      <header className="flex items-baseline gap-3 px-1 pt-4 pb-1.5">
        <h2 className="font-semibold text-[15px] text-foreground">En attente</h2>
        <span className="text-[13px] text-[var(--ds-text-tertiary)]">
          {items.length}{" "}
          {items.length > 1 ? "factures à émettre ou encaisser" : "facture à émettre ou encaisser"}
        </span>
        <span className="flex-1" />
        <span className="text-[13px] text-muted-foreground tabular-nums">
          Total {formatEur(total)} HT
        </span>
      </header>
      {items.length === 0 ? (
        <p className="border-t px-1 py-6 text-center text-muted-foreground text-sm">
          Tout est à jour.
        </p>
      ) : (
        items.map((p) => <PendingRow key={p.invoiceId} item={p} />)
      )}
    </section>
  );
}

function PendingRow({ item }: { item: PendingItem }) {
  const targetLink =
    item.kind === "coworking"
      ? `/coworking/factures/${item.invoiceId}`
      : item.projectId
        ? `/projets/${item.projectId}?tab=billing`
        : null;
  const tagTint: Tint =
    item.kind === "coworking" ? "mauve" : item.kind === "milestone" ? "blue" : "gray";
  const tagLabel =
    item.kind === "milestone" ? "JALON" : item.kind === "coworking" ? "COWORKING" : "FACTURE";
  const tagIcon =
    item.kind === "coworking" ? (
      <Buildings size={13} weight="duotone" />
    ) : (
      <FlagPennant size={13} weight="duotone" />
    );
  const statusTint: Tint = item.status === "draft" ? "gray" : "orange";
  const statusLabel = item.status === "draft" ? "À facturer" : "Émis";

  const body = (
    <>
      <span
        className="inline-flex flex-none items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold text-[10px] tracking-wider"
        style={{
          background: `var(--ds-tint-${tagTint}-bg)`,
          color: `var(--ds-tint-${tagTint}-text)`,
        }}
      >
        <span style={{ color: `var(--ds-tint-${tagTint}-dot)` }}>{tagIcon}</span>
        {tagLabel}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground text-sm">
          {item.projectName ?? item.contractName ?? item.label}
        </div>
        <div className="truncate text-[12px] text-[var(--ds-text-tertiary)]">
          {item.label}
          {item.entityName ? ` · ${item.entityName}` : ""}
        </div>
      </div>
      <span
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold text-[11px]"
        style={{
          background: `var(--ds-tint-${statusTint}-bg)`,
          color: `var(--ds-tint-${statusTint}-text)`,
        }}
      >
        <span
          className="inline-block size-1.5 rounded-full"
          style={{ background: `var(--ds-tint-${statusTint}-dot)` }}
        />
        {statusLabel}
      </span>
      <span className="min-w-[96px] text-right font-semibold text-[14px] text-foreground tabular-nums tabular-nums">
        {formatEur(item.amountHt)}
      </span>
      <ArrowRight
        size={13}
        weight="bold"
        className={targetLink ? "text-[var(--ds-text-tertiary)]" : "invisible"}
      />
    </>
  );

  if (targetLink) {
    return (
      <Link
        href={targetLink}
        className="flex items-center gap-3.5 border-t px-1 py-3 transition-colors hover:bg-[var(--ds-bg-hover)]"
      >
        {body}
      </Link>
    );
  }
  return <div className="flex items-center gap-3.5 border-t px-1 py-3">{body}</div>;
}
