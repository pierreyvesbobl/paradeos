import {
  ArrowUpRight,
  BellRinging,
  Briefcase,
  CheckSquare,
  Clock,
  Receipt,
  Sigma,
  Warning,
  WarningCircle,
} from "@phosphor-icons/react/dist/ssr";
import { and, eq, gte, isNotNull, lte, ne, or, sql } from "drizzle-orm";
import Link from "next/link";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { timeEntries } from "@/db/schema/time-entries";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { EuroAmount } from "@/lib/demo/components";
import { getDoneTodayCount, getMyOpenTasks } from "./queries";
import { bucketFor, isoDaysFromNow, todayIso } from "./shared";

export async function KpiStrip() {
  const authUser = await requireUser();
  const conn = await db();

  const today = todayIso();
  const weekEnd = isoDaysFromNow(7);
  const last7Start = isoDaysFromNow(-7);

  const [
    myOpenTasks,
    doneTodayCount,
    [relancesAggRow],
    [trackedRow],
    [trackedTotalRow],
    [toCollectRow],
  ] = await Promise.all([
    getMyOpenTasks(authUser.id),
    getDoneTodayCount(authUser.id),
    // relances cette semaine (agrégat)
    conn
      .select({
        count: sql<number>`count(*)::int`,
        total: sql<string>`coalesce(sum(${projects.valueAmount}), 0)`,
      })
      .from(projects)
      .where(
        and(
          isNotNull(projects.followUpDate),
          gte(projects.followUpDate, today),
          lte(projects.followUpDate, weekEnd),
          ne(projects.status, "lost"),
        ),
      ),
    // temps tracké (7 derniers jours, mon temps réel)
    conn
      .select({
        minutes: sql<number>`coalesce(sum(extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60), 0)::int`,
      })
      .from(timeEntries)
      .where(
        and(
          eq(timeEntries.userId, authUser.id),
          eq(timeEntries.kind, "actual"),
          gte(timeEntries.startAt, new Date(`${last7Start}T00:00:00Z`)),
        ),
      ),
    // temps tracké (total)
    conn
      .select({
        minutes: sql<number>`coalesce(sum(extract(epoch from (${timeEntries.endAt} - ${timeEntries.startAt})) / 60), 0)::int`,
      })
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, authUser.id), eq(timeEntries.kind, "actual"))),
    // factures à encaisser (sent, non payées) — filtré par utilisateur.
    // `overdue` = due_date passée. Fallback sur l'heuristique 30j pour les
    // factures historiques sans due_date renseignée (backfill 0058 a
    // couvert l'existant mais une création hors UI pourrait ne pas en avoir).
    // On ne montre que les factures dont la personne courante est responsable.
    conn
      .select({
        total: sql<string>`coalesce(sum(${invoices.amountHt}), 0)`,
        count: sql<number>`count(*)::int`,
        overdue: sql<number>`count(*) filter (where
          (${invoices.dueDate} is not null and ${invoices.dueDate} <= current_date)
          or (${invoices.dueDate} is null and ${invoices.invoicedAt} < now() - interval '30 days')
        )::int`,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.status, "sent"),
          eq(invoices.assignedTo, authUser.id),
          or(
            eq(invoices.kind, "milestone"),
            eq(invoices.kind, "coworking"),
            eq(invoices.kind, "one_off"),
          ),
        ),
      ),
  ]);

  const overdueCount = myOpenTasks.filter(
    (t) => bucketFor(t.dueDate, today, weekEnd) === "overdue",
  ).length;

  const relancesCount = relancesAggRow?.count ?? 0;
  const relancesTotal = Number(relancesAggRow?.total ?? 0);

  const trackedHours = Math.round((trackedRow?.minutes ?? 0) / 60);
  const trackedTotalHours = Math.round((trackedTotalRow?.minutes ?? 0) / 60);

  const toCollect = Number(toCollectRow?.total ?? 0);
  const toCollectCount = toCollectRow?.count ?? 0;
  const toCollectOverdue = toCollectRow?.overdue ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
      <MetricCard
        href="/taches?scope=mine&status=open"
        label="Tâches en retard"
        icon={<WarningCircle weight="duotone" className="size-5 text-tint-red-dot" />}
        value={String(overdueCount)}
        sub={overdueCount > 0 ? "à traiter" : "à jour"}
        valueClassName={overdueCount > 0 ? "text-tint-red-text" : "text-ds-text"}
        footIcon={<CheckSquare weight="duotone" className="size-3.5 text-ds-text-muted" />}
        footText={`${doneTodayCount} terminée${doneTodayCount > 1 ? "s" : ""} aujourd'hui`}
        footClassName="text-ds-text-muted"
      />
      <MetricCard
        href="/projets"
        label="Relances à effectuer"
        icon={<BellRinging weight="duotone" className="size-5 text-tint-orange-dot" />}
        value={String(relancesCount)}
        sub={relancesCount > 1 ? "clients" : "client"}
        valueClassName="text-ds-text"
        footIcon={<Briefcase weight="duotone" className="size-3.5 text-ds-text-muted" />}
        footText={
          <>
            Pipeline · <EuroAmount value={relancesTotal} demoId="kpi-relances" compact />
          </>
        }
        footClassName="text-ds-text-muted"
      />
      <MetricCard
        href="/temps"
        label="Temps tracké"
        icon={<Clock weight="duotone" className="size-5 text-primary-500" />}
        value={`${trackedHours}h`}
        sub="7 derniers jours"
        valueClassName="text-ds-text"
        footIcon={<Sigma weight="duotone" className="size-3.5 text-ds-text-muted" />}
        footText={`${trackedTotalHours}h au total`}
        footClassName="text-ds-text-muted"
      />
      <MetricCard
        href="/compta?tab=relances&assignee=me"
        label="À encaisser (mes factures)"
        icon={<Receipt weight="duotone" className="size-5 text-tint-mauve-dot" />}
        value={<EuroAmount value={toCollect} demoId="kpi-to-collect" compact />}
        sub={`${toCollectCount} facture${toCollectCount > 1 ? "s" : ""}`}
        valueClassName="text-ds-text"
        footIcon={
          <Warning
            weight="duotone"
            className={
              toCollectOverdue > 0
                ? "size-3.5 text-tint-orange-text"
                : "size-3.5 text-ds-text-muted"
            }
          />
        }
        footText={toCollectOverdue > 0 ? `${toCollectOverdue} en retard` : "aucune en retard"}
        footClassName={toCollectOverdue > 0 ? "text-tint-orange-text" : "text-ds-text-muted"}
      />
    </div>
  );
}

function MetricCard({
  href,
  label,
  icon,
  value,
  sub,
  valueClassName,
  footIcon,
  footText,
  footClassName,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  sub?: string;
  valueClassName?: string;
  footIcon?: React.ReactNode;
  footText?: React.ReactNode;
  footClassName?: string;
}) {
  return (
    <Link
      href={href}
      className="statcard group/card flex flex-col gap-2.5 rounded-[10px] border border-ds-border bg-ds-app px-4 py-3.5 transition-colors hover:bg-ds-surface"
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="font-semibold text-[11px] text-ds-text-tertiary uppercase tracking-[0.06em]">
          {label}
        </span>
        <span className="flex-1" />
        <ArrowUpRight
          weight="bold"
          className="size-3 text-ds-text-tertiary opacity-0 transition-opacity group-hover/card:opacity-100"
        />
      </div>
      <div className="flex items-baseline gap-2">
        <span className={`font-semibold text-[29px] leading-none ${valueClassName ?? ""}`}>
          {value}
        </span>
        {sub ? <span className="text-ds-text-tertiary text-xs">{sub}</span> : null}
      </div>
      <div className="flex items-center gap-1.5 border-ds-border border-t pt-2">
        {footIcon}
        <span className={`text-xs ${footClassName ?? "text-ds-text-muted"}`}>{footText}</span>
      </div>
    </Link>
  );
}
