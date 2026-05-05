import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { formatDate, formatEuro } from "@/lib/format";
import { opportunityStatusLabels } from "@/lib/schemas/opportunities";
import { and, count, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { ArrowUpRight, Briefcase, CheckSquare, Sparkles, Trophy } from "lucide-react";
import Link from "next/link";

function startOfMonth(d = new Date()): string {
  const date = new Date(d.getFullYear(), d.getMonth(), 1);
  return date.toISOString().slice(0, 10);
}

function endOfWeek(d = new Date()): string {
  // ISO week ends on Sunday → on prend +7 jours pour la fenêtre "cette semaine".
  const date = new Date(d);
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const authUser = await requireUser();
  const conn = await db();

  const [profile] = await conn
    .select({ fullName: users.fullName })
    .from(users)
    .where(eq(users.id, authUser.id))
    .limit(1);

  const firstName =
    profile?.fullName?.trim().split(/\s+/)[0] ?? authUser.email?.split("@")[0] ?? "toi";

  const monthStart = startOfMonth();
  const today = todayIso();
  const weekEnd = endOfWeek();

  // Pipeline pondéré : Σ valeur × proba/100 sur les opps non clôturées.
  const [pipelineRow] = await conn
    .select({
      weighted: sql<string>`coalesce(sum(${opportunities.valueAmount} * ${opportunities.probability} / 100), 0)`,
      total: sql<string>`coalesce(sum(${opportunities.valueAmount}), 0)`,
      openCount: sql<number>`count(*)::int`,
    })
    .from(opportunities)
    .where(
      sql`${opportunities.status} not in ('won', 'lost') and ${opportunities.valueAmount} is not null`,
    );

  // Deals signés ce mois.
  const [wonRow] = await conn
    .select({
      count: sql<number>`count(*)::int`,
      total: sql<string>`coalesce(sum(${opportunities.valueAmount}), 0)`,
    })
    .from(opportunities)
    .where(and(eq(opportunities.status, "won"), gte(opportunities.lastContactDate, monthStart)));

  // Tâches ouvertes (toutes / les miennes).
  const [openTasksRow] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(sql`${tasks.status} not in ('done', 'cancelled')`);

  const [myOpenTasksRow] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(eq(tasks.assigneeId, authUser.id), sql`${tasks.status} not in ('done', 'cancelled')`),
    );

  // Projets actifs.
  const [activeProjectsRow] = await conn
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(inArray(projects.status, ["planning", "active"]));

  // Counts entités / contacts.
  const [entitiesCount] = await conn.select({ count: count() }).from(entities);
  const [contactsCount] = await conn.select({ count: count() }).from(contacts);

  // Relances cette semaine (follow_up_date entre today et today+7).
  const followUps = await conn
    .select({
      id: opportunities.id,
      title: opportunities.title,
      followUpDate: opportunities.followUpDate,
      status: opportunities.status,
      entityName: entities.name,
    })
    .from(opportunities)
    .leftJoin(entities, eq(opportunities.entityId, entities.id))
    .where(
      and(
        isNotNull(opportunities.followUpDate),
        gte(opportunities.followUpDate, today),
        lte(opportunities.followUpDate, weekEnd),
        ne(opportunities.status, "lost"),
      ),
    )
    .orderBy(opportunities.followUpDate)
    .limit(8);

  // Tâches en retard (échues dans le passé, non terminées).
  const overdue = await conn
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        isNotNull(tasks.dueDate),
        sql`${tasks.dueDate} < ${today}`,
        sql`${tasks.status} not in ('done', 'cancelled')`,
        eq(tasks.assigneeId, authUser.id),
      ),
    )
    .orderBy(tasks.dueDate)
    .limit(5);

  // Activité récente : 5 opportunités les plus récemment modifiées.
  const recent = await conn
    .select({
      id: opportunities.id,
      title: opportunities.title,
      status: opportunities.status,
      updatedAt: opportunities.updatedAt,
      entityName: entities.name,
    })
    .from(opportunities)
    .leftJoin(entities, eq(opportunities.entityId, entities.id))
    .orderBy(desc(opportunities.updatedAt))
    .limit(5);

  const weighted = Number(pipelineRow?.weighted ?? 0);
  const totalPipeline = Number(pipelineRow?.total ?? 0);
  const wonTotal = Number(wonRow?.total ?? 0);

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <p className="text-muted-foreground text-sm">Dashboard</p>
        <h1 className="font-semibold text-3xl tracking-tight">Bonjour {firstName}.</h1>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          title="Pipeline pondéré"
          value={formatEuro(weighted)}
          subtitle={`${pipelineRow?.openCount ?? 0} deals · ${formatEuro(totalPipeline)} brut`}
          icon={Sparkles}
          href="/opportunites"
        />
        <KpiCard
          title="Signés ce mois"
          value={formatEuro(wonTotal)}
          subtitle={`${wonRow?.count ?? 0} deal${(wonRow?.count ?? 0) > 1 ? "s" : ""}`}
          icon={Trophy}
          href="/opportunites?status=won"
        />
        <KpiCard
          title="Mes tâches ouvertes"
          value={String(myOpenTasksRow?.count ?? 0)}
          subtitle={`${openTasksRow?.count ?? 0} au total`}
          icon={CheckSquare}
          href="/taches?scope=mine&status=open"
        />
        <KpiCard
          title="Projets actifs"
          value={String(activeProjectsRow?.count ?? 0)}
          subtitle={`${entitiesCount?.count ?? 0} entités · ${contactsCount?.count ?? 0} contacts`}
          icon={Briefcase}
          href="/projets"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 rounded-lg border bg-card p-6 lg:col-span-2">
          <h2 className="font-medium text-sm">Relances cette semaine</h2>
          {followUps.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucune relance prévue d'ici 7 jours.</p>
          ) : (
            <ul className="divide-y">
              {followUps.map((f) => (
                <li key={f.id} className="py-2.5">
                  <Link
                    href={`/opportunites/${f.id}`}
                    className="flex items-center justify-between gap-3 hover:underline"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-sm">{f.title}</p>
                      <p className="text-muted-foreground text-xs">
                        {f.entityName ?? "—"} · {opportunityStatusLabels[f.status]}
                      </p>
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {f.followUpDate ? formatDate(f.followUpDate) : ""}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-6">
          <h2 className="font-medium text-sm">Mes tâches en retard</h2>
          {overdue.length === 0 ? (
            <p className="text-muted-foreground text-sm">Rien en retard. 🎉</p>
          ) : (
            <ul className="space-y-2">
              {overdue.map((t) => (
                <li key={t.id}>
                  <Link
                    href={`/taches/${t.id}`}
                    className="block rounded-md border bg-background px-3 py-2 hover:bg-muted"
                  >
                    <p className="font-medium text-sm">{t.title}</p>
                    <p className="text-destructive text-xs">
                      {t.dueDate ? formatDate(t.dueDate) : ""}
                      {t.projectName ? ` · ${t.projectName}` : ""}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Activité récente</h2>
        <ul className="divide-y">
          {recent.map((r) => (
            <li key={r.id} className="py-2.5">
              <Link
                href={`/opportunites/${r.id}`}
                className="flex items-center justify-between gap-3 hover:underline"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-sm">{r.title}</p>
                  <p className="text-muted-foreground text-xs">
                    {r.entityName ?? "—"} · {opportunityStatusLabels[r.status]}
                  </p>
                </div>
                <span className="text-muted-foreground text-xs">{formatDate(r.updatedAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  href,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-2 rounded-lg border bg-card p-4 transition-colors hover:border-foreground/30"
    >
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-xs uppercase tracking-wide">{title}</span>
        <Icon className="size-4" />
      </div>
      <p className="font-semibold text-2xl tracking-tight">{value}</p>
      {subtitle ? (
        <div className="flex items-center justify-between text-muted-foreground text-xs">
          <span>{subtitle}</span>
          <ArrowUpRight className="size-3 opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      ) : null}
    </Link>
  );
}
