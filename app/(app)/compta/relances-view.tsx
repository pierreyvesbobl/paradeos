import { EmptyState } from "@/components/empty-state";
import { coworkingContracts } from "@/db/schema/coworking";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { demoAmount, demoCompanyName, demoProjectName } from "@/lib/demo/anonymize";
import { isDemoMode } from "@/lib/demo/server";
import {
  type DougsAgingSummary,
  getDougsAgingSummary,
  getDougsPaymentHints,
} from "@/lib/dougs/signals";
import { BellRinging, Clock, CurrencyEur, HandCoins, Scales } from "@phosphor-icons/react/dist/ssr";
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import Link from "next/link";
import { type RelanceItem, RelanceRow } from "./relance-row";

function formatEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type UserOption = { id: string; fullName: string | null; avatarUrl: string | null };

/**
 * Récupère les factures envoyées non payées, séparées en trois paniers :
 *   - overdue : due_date passée
 *   - soon    : due_date dans les 7 prochains jours
 *   - later   : plus tard ou sans échéance
 * Exclut les factures coworking facturées par G&O (cohérent avec le
 * dashboard Compta).
 *
 * `assigneeFilter` = "me" filtre par l'utilisateur courant. "all" = tout.
 */
export async function RelancesView({ assigneeFilter }: { assigneeFilter: "all" | "me" }) {
  const conn = await db();
  const demo = await isDemoMode();
  const authUser = await requireUser();
  const today = toISODate(new Date());

  // Liste des utilisateurs pour le picker assignee. ~10 personnes max
  // attendu — pas de pagination.
  const userOptions: UserOption[] = await conn
    .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
    .from(users)
    .orderBy(asc(users.fullName));

  // Signaux Dougs, en parallèle et sans jamais bloquer la page : les
  // deux helpers avalent leurs erreurs et renvoient vide si Dougs est
  // injoignable ou le cookie expiré.
  const [paymentHints, aging] = await Promise.all([
    getDougsPaymentHints(authUser.id),
    getDougsAgingSummary(authUser.id),
  ]);

  const baseWhere = and(
    eq(invoices.status, "sent"),
    inArray(invoices.kind, ["milestone", "coworking", "one_off"]),
    or(ne(invoices.billedBy, "g_and_o"), isNull(invoices.billedBy)),
    assigneeFilter === "me" ? eq(invoices.assignedTo, authUser.id) : undefined,
  );

  const rows = await conn
    .select({
      id: invoices.id,
      kind: invoices.kind,
      label: invoices.label,
      amountHt: invoices.amountHt,
      invoicedAt: invoices.invoicedAt,
      dueDate: invoices.dueDate,
      lastRemindedAt: invoices.lastRemindedAt,
      reminderCount: invoices.reminderCount,
      dougsInvoiceId: invoices.dougsInvoiceId,
      assignedTo: invoices.assignedTo,
      assignedFullName: users.fullName,
      assignedAvatarUrl: users.avatarUrl,
      projectId: invoices.projectId,
      projectName: projects.name,
      coworkingContractId: invoices.coworkingContractId,
      contractName: coworkingContracts.name,
      entityId: entities.id,
      entityName: entities.name,
    })
    .from(invoices)
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .leftJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
    .leftJoin(users, eq(users.id, invoices.assignedTo))
    .where(baseWhere)
    .orderBy(sql`${invoices.dueDate} asc nulls last, ${invoices.invoicedAt} asc`);

  const overdue: RelanceItem[] = [];
  const soon: RelanceItem[] = [];
  const later: RelanceItem[] = [];

  for (const r of rows) {
    const amount = demo ? demoAmount(r.id, Number(r.amountHt) || 0) : Number(r.amountHt) || 0;
    const item: RelanceItem = {
      invoiceId: r.id,
      kind: r.kind as RelanceItem["kind"],
      label: r.label,
      projectId: r.projectId,
      projectName: demo && r.projectId ? demoProjectName(r.projectId) : r.projectName,
      coworkingContractId: r.coworkingContractId,
      contractName: r.contractName,
      entityName: demo && r.entityId ? demoCompanyName(r.entityId) : r.entityName,
      amountHt: amount,
      invoicedAt: r.invoicedAt ? r.invoicedAt.toISOString() : null,
      dueDate: r.dueDate,
      lastRemindedAt: r.lastRemindedAt ? r.lastRemindedAt.toISOString() : null,
      reminderCount: r.reminderCount,
      dougsInvoiceId: r.dougsInvoiceId,
      assignedTo: r.assignedTo,
      assignedFullName: r.assignedFullName,
      assignedAvatarUrl: r.assignedAvatarUrl,
      paymentHint: r.dougsInvoiceId ? (paymentHints.get(r.dougsInvoiceId) ?? null) : null,
    };
    if (!r.dueDate) {
      later.push(item);
      continue;
    }
    if (r.dueDate <= today) overdue.push(item);
    else if (daysBetween(today, r.dueDate) <= 7) soon.push(item);
    else later.push(item);
  }

  const overdueTotal = overdue.reduce((s, i) => s + i.amountHt, 0);
  const soonTotal = soon.reduce((s, i) => s + i.amountHt, 0);

  const allItems = [...overdue, ...soon, ...later];
  const alreadyPaid = allItems.filter((i) => i.paymentHint);
  const alreadyPaidTotal = alreadyPaid.reduce((s, i) => s + i.amountHt, 0);

  const recentlyRemindedCount = allItems.filter((i) => {
    if (!i.lastRemindedAt) return false;
    const ago = (Date.now() - Date.parse(i.lastRemindedAt)) / 86_400_000;
    return ago <= 7;
  }).length;

  return (
    <div className="space-y-6">
      <AssigneeFilterBar current={assigneeFilter} />

      {alreadyPaid.length > 0 ? (
        <PaymentHintBanner count={alreadyPaid.length} total={alreadyPaidTotal} />
      ) : null}

      {overdue.length === 0 && soon.length === 0 && later.length === 0 ? (
        <EmptyState
          title={
            assigneeFilter === "me"
              ? "Aucune facture à relancer pour toi"
              : "Aucune facture à relancer"
          }
          description={
            assigneeFilter === "me"
              ? "Aucune facture envoyée non payée ne t'est assignée."
              : "Toutes les factures envoyées sont soit payées, soit avant leur échéance."
          }
        />
      ) : (
        <>
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <KpiCard
              tint="orange"
              icon={<Clock size={16} weight="duotone" />}
              label="En retard"
              value={overdue.length.toString()}
              sub={`${formatEur(overdueTotal)} HT`}
            />
            <KpiCard
              tint="blue"
              icon={<CurrencyEur size={16} weight="duotone" />}
              label="Échéance proche"
              value={soon.length.toString()}
              sub={`${formatEur(soonTotal)} HT — sous 7 j`}
            />
            <KpiCard
              tint="mauve"
              icon={<BellRinging size={16} weight="duotone" />}
              label="Relancées récemment"
              value={recentlyRemindedCount.toString()}
              sub="Sur les 7 derniers jours"
            />
          </section>

          {overdue.length > 0 ? (
            <Section title="En retard" count={overdue.length} total={overdueTotal}>
              {overdue.map((it) => (
                <RelanceRow key={it.invoiceId} item={it} today={today} userOptions={userOptions} />
              ))}
            </Section>
          ) : null}

          {soon.length > 0 ? (
            <Section title="Échéance proche" count={soon.length} total={soonTotal}>
              {soon.map((it) => (
                <RelanceRow key={it.invoiceId} item={it} today={today} userOptions={userOptions} />
              ))}
            </Section>
          ) : null}

          {later.length > 0 ? (
            <Section
              title="Plus tard ou sans échéance"
              count={later.length}
              total={later.reduce((s, i) => s + i.amountHt, 0)}
            >
              {later.map((it) => (
                <RelanceRow key={it.invoiceId} item={it} today={today} userOptions={userOptions} />
              ))}
            </Section>
          ) : null}
        </>
      )}

      {aging ? <AgingCrossCheck aging={aging} paradeosOverdue={overdueTotal} /> : null}
    </div>
  );
}

/**
 * Dougs a repéré un virement entrant qui correspond à une facture qu'on
 * s'apprête à relancer, mais l'écriture n'est pas encore validée côté
 * compta. Relancer là-dessus, c'est réclamer de l'argent déjà reçu.
 */
function PaymentHintBanner({ count, total }: { count: number; total: number }) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-xl border px-4 py-3"
      style={{ background: "var(--ds-tint-green-bg)", borderColor: "var(--ds-tint-green-bg)" }}
    >
      <span className="mt-0.5 flex-none" style={{ color: "var(--ds-tint-green-dot)" }}>
        <HandCoins size={18} weight="duotone" />
      </span>
      <div className="space-y-0.5 text-[13px]">
        <p className="font-semibold" style={{ color: "var(--ds-tint-green-text)" }}>
          {count === 1
            ? "1 facture semble déjà encaissée"
            : `${count} factures semblent déjà encaissées`}{" "}
          — {formatEur(total)} HT
        </p>
        <p className="text-[var(--ds-text-tertiary)]">
          Dougs a détecté le virement correspondant sur le compte, mais le rapprochement n'est pas
          encore validé. Vérifie avant de relancer.
        </p>
      </div>
    </div>
  );
}

/**
 * Contrôle croisé avec la balance âgée native de Dougs. Un écart marqué
 * signale en général une facture émise directement depuis Dougs qui n'a
 * jamais été redescendue dans Paradeos — donc invisible dans les
 * relances ci-dessus.
 *
 * Seuil : on n'alerte qu'au-delà de 500 € ET 10 % d'écart, pour ne pas
 * crier au loup sur des décalages de TVA ou de date d'arrêté.
 */
function AgingCrossCheck({
  aging,
  paradeosOverdue,
}: {
  aging: DougsAgingSummary;
  paradeosOverdue: number;
}) {
  const gap = aging.total - paradeosOverdue;
  const significant = gap > 500 && paradeosOverdue > 0 && gap / paradeosOverdue > 0.1;

  return (
    <section className="rounded-xl border bg-card px-4 py-3 sm:px-5">
      <header className="flex items-center gap-2">
        <span style={{ color: "var(--ds-tint-blue-dot)" }}>
          <Scales size={16} weight="duotone" />
        </span>
        <h2 className="font-semibold text-[13px] text-foreground">Balance âgée Dougs</h2>
        <span className="flex-1" />
        <span className="text-[12px] text-muted-foreground tabular-nums">
          Total {formatEur(aging.total)}
        </span>
      </header>

      <dl className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1.5">
        {aging.buckets.map((b) => (
          <div key={b.label} className="flex items-baseline gap-1.5">
            <dt className="text-[12px] text-[var(--ds-text-tertiary)]">{b.label}</dt>
            <dd className="font-medium text-[13px] text-foreground tabular-nums">
              {formatEur(b.amount)}
            </dd>
          </div>
        ))}
      </dl>

      {significant ? (
        <p className="mt-2.5 text-[12px] text-[var(--ds-text-tertiary)]">
          Dougs voit {formatEur(gap)} d'impayé de plus que Paradeos ({formatEur(paradeosOverdue)} en
          retard ci-dessus) — probablement une facture émise depuis Dougs et jamais rapatriée. À
          vérifier dans l'onglet Rapprochement.
        </p>
      ) : null}
    </section>
  );
}

function AssigneeFilterBar({ current }: { current: "all" | "me" }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-[var(--ds-text-tertiary)]">Filtrer :</span>
      <FilterPill href="/compta?tab=relances" label="Toutes" active={current === "all"} />
      <FilterPill
        href="/compta?tab=relances&assignee=me"
        label="Mes factures"
        active={current === "me"}
      />
    </div>
  );
}

function FilterPill({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={
        active
          ? "rounded-full bg-foreground px-3 py-1 font-semibold text-[12px] text-background"
          : "rounded-full border px-3 py-1 font-medium text-[12px] text-foreground hover:bg-muted/40"
      }
    >
      {label}
    </Link>
  );
}

function Section({
  title,
  count,
  total,
  children,
}: {
  title: string;
  count: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card px-4 pb-3 sm:px-5">
      <header className="flex items-baseline gap-3 px-1 pt-4 pb-1.5">
        <h2 className="font-semibold text-[15px] text-foreground">{title}</h2>
        <span className="text-[13px] text-[var(--ds-text-tertiary)]">
          {count} {count > 1 ? "factures" : "facture"}
        </span>
        <span className="flex-1" />
        <span className="text-[13px] text-muted-foreground tabular-nums">
          Total {formatEur(total)} HT
        </span>
      </header>
      {children}
    </section>
  );
}

function KpiCard({
  tint,
  icon,
  label,
  value,
  sub,
}: {
  tint: "orange" | "blue" | "mauve";
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="rounded-xl border bg-card px-4 py-3">
      <div
        className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 font-semibold text-[10px] tracking-wider"
        style={{
          background: `var(--ds-tint-${tint}-bg)`,
          color: `var(--ds-tint-${tint}-text)`,
        }}
      >
        <span style={{ color: `var(--ds-tint-${tint}-dot)` }}>{icon}</span>
        {label.toUpperCase()}
      </div>
      <div className="mt-2 font-semibold text-[22px] text-foreground tabular-nums">{value}</div>
      <div className="text-[12px] text-[var(--ds-text-tertiary)]">{sub}</div>
    </div>
  );
}

function daysBetween(fromISO: string, toISO: string): number {
  const a = Date.parse(`${fromISO}T00:00:00Z`);
  const b = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

/** Compte des factures en retard. Si `assignedTo` est fourni, filtre. */
export async function countOverdueInvoices(opts: { assignedTo?: string } = {}): Promise<number> {
  const conn = await db();
  const today = toISODate(new Date());
  const [row] = await conn
    .select({ c: sql<number>`count(*)::int` })
    .from(invoices)
    .where(
      and(
        eq(invoices.status, "sent"),
        inArray(invoices.kind, ["milestone", "coworking", "one_off"]),
        or(ne(invoices.billedBy, "g_and_o"), isNull(invoices.billedBy)),
        sql`${invoices.dueDate} is not null and ${invoices.dueDate} <= ${today}`,
        opts.assignedTo ? eq(invoices.assignedTo, opts.assignedTo) : undefined,
      ),
    );
  return row?.c ?? 0;
}
