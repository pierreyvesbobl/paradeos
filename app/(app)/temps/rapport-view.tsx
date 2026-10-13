import { Clock, Terminal } from "@phosphor-icons/react/dist/ssr";
import { EmptyState } from "@/components/empty-state";
import Link from "@/components/link";
import { RepoLinkPicker } from "@/components/temps/repo-link-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { addDays, isoDate, startOfIsoWeek } from "@/lib/calendar";
import { type ClaudeActivity, getClaudeActivity } from "@/lib/db/queries/claude-activity";
import { getGlobalProfitability } from "@/lib/db/queries/profitability";
import { getRepoLinkChoices, type RepoLinkChoice } from "@/lib/db/queries/project-repos";
import { getGlobalTimeStats } from "@/lib/db/queries/time-stats";
import { formatDate, formatDays, formatDuration, formatEuro } from "@/lib/format";
import { computeDaysWorked, computeEffectiveDailyRate } from "@/lib/profitability-math";
import { projectKindLabels } from "@/lib/schemas/projects";

export type Range = "week" | "month" | "all";

function startOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function resolveRange(range: Range | undefined, weekParam: string | undefined) {
  if (range === "all") {
    return {
      start: new Date(2000, 0, 1),
      end: new Date(2100, 0, 1),
      label: "Tout",
    };
  }
  if (range === "month") {
    const start = startOfMonth();
    const end = endOfMonth();
    const fmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
    return { start, end, label: fmt.format(start) };
  }
  // Default week.
  const base =
    weekParam && /^\d{4}-\d{2}-\d{2}$/.test(weekParam)
      ? new Date(`${weekParam}T00:00:00`)
      : new Date();
  const start = startOfIsoWeek(base);
  const end = addDays(start, 7);
  return {
    start,
    end,
    label: `Semaine du ${formatDate(start)}`,
  };
}

export async function RapportView({ range, week }: { range?: Range; week?: string }) {
  const activeRange: Range = range && ["week", "month", "all"].includes(range) ? range : "week";
  const { start, end } = resolveRange(activeRange, week);

  const [stats, profitability, claude] = await Promise.all([
    getGlobalTimeStats(start, end),
    getGlobalProfitability(start, end),
    getClaudeActivity(start, end),
  ]);
  // Dépôts arrivés sans projet : de quoi trancher sur place.
  const unlinked = claude.byProject.filter((r) => r.projectId === null).flatMap((r) => r.remotes);
  const choices = await getRepoLinkChoices(unlinked);
  const totalRevenue = profitability.reduce((acc, p) => acc + p.revenueAmount, 0);
  const totalCost = profitability.reduce((acc, p) => acc + p.costAmount, 0);
  const totalMargin = totalRevenue - totalCost;
  const totalDaysWorked = computeDaysWorked(stats.totals.actualMinutes);
  const effectiveDailyRate = computeEffectiveDailyRate(totalRevenue, stats.totals.actualMinutes);

  const prevWeek = activeRange === "week" ? addDays(start, -7) : null;
  const nextWeek = activeRange === "week" ? addDays(start, 7) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <FilterLink
          href="/temps?tab=rapport&range=week"
          active={activeRange === "week"}
          label="Semaine"
        />
        <FilterLink
          href="/temps?tab=rapport&range=month"
          active={activeRange === "month"}
          label="Mois"
        />
        <FilterLink
          href="/temps?tab=rapport&range=all"
          active={activeRange === "all"}
          label="Tout"
        />

        {prevWeek && nextWeek ? (
          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/temps?tab=rapport&range=week&week=${isoDate(prevWeek)}`}>← Préc.</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/temps?tab=rapport&range=week">Cette semaine</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/temps?tab=rapport&range=week&week=${isoDate(nextWeek)}`}>Suiv. →</Link>
            </Button>
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiBox label="Réalisé" value={formatDuration(stats.totals.actualMinutes)} tone="actual" />
        <KpiBox
          label="Planifié"
          value={formatDuration(stats.totals.plannedMinutes)}
          tone="planned"
        />
        <KpiBox
          label="Écart temps"
          value={
            (stats.totals.actualMinutes >= stats.totals.plannedMinutes ? "+" : "−") +
            formatDuration(Math.abs(stats.totals.actualMinutes - stats.totals.plannedMinutes))
          }
          tone="muted"
        />
        <KpiBox label="Jours-hommes" value={formatDays(totalDaysWorked)} tone="muted" />
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-muted-foreground text-xs">
        <span className="uppercase tracking-wide">Réalisé par provenance</span>
        <SourceStat label="Saisi" minutes={stats.bySource.manual} />
        <SourceStat label="Calendrier" minutes={stats.bySource.calendar} />
      </div>

      <ClaudeActivitySection activity={claude} choices={choices} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiBox label="Revenu" value={formatEuro(totalRevenue)} tone="actual" />
        <KpiBox label="Coût interne" value={formatEuro(totalCost)} tone="muted" />
        <KpiBox
          label="Marge"
          value={(totalMargin >= 0 ? "+" : "−") + formatEuro(Math.abs(totalMargin))}
          tone={totalMargin >= 0 ? "actual" : "planned"}
        />
        <KpiBox
          label="TJM effectif"
          value={effectiveDailyRate == null ? "—" : formatEuro(effectiveDailyRate)}
          tone="muted"
        />
      </div>

      <section className="space-y-3 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Par projet</h2>
        {stats.byProject.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="Aucun créneau sur la période."
            description="Les créneaux du calendrier alimentent automatiquement ce rapport."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Projet</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Réalisé</TableHead>
                <TableHead className="text-right">Planifié</TableHead>
                <TableHead className="text-right">Écart</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.byProject.map((p, i) => {
                const delta = p.actualMinutes - p.plannedMinutes;
                return (
                  <TableRow key={p.projectId ?? `unassigned-${i}`}>
                    <TableCell className="font-medium">
                      {p.projectId ? (
                        <Link href={`/projets/${p.projectId}`} className="hover:underline">
                          {p.projectName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Sans projet</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {p.projectKind ? (
                        <Badge variant="outline">
                          {projectKindLabels[p.projectKind as keyof typeof projectKindLabels] ??
                            p.projectKind}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatDuration(p.actualMinutes)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground text-sm">
                      {formatDuration(p.plannedMinutes)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground text-sm">
                      {(delta >= 0 ? "+" : "−") + formatDuration(Math.abs(delta))}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      {profitability.length > 0 ? (
        <section className="space-y-3 rounded-lg border bg-card p-6">
          <h2 className="font-medium text-sm">Rentabilité par projet</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Projet</TableHead>
                <TableHead className="text-right">Heures</TableHead>
                <TableHead className="text-right">Revenu</TableHead>
                <TableHead className="text-right">Coût</TableHead>
                <TableHead className="text-right">Marge</TableHead>
                <TableHead className="text-right">Marge %</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profitability.map((p) => {
                const positive = p.marginAmount >= 0;
                const sign = p.marginAmount === 0 ? "" : positive ? "+" : "−";
                const marginTone = positive
                  ? p.marginPct == null || p.marginPct >= 50
                    ? "text-emerald-600 dark:text-emerald-400"
                    : p.marginPct >= 30
                      ? "text-amber-600 dark:text-amber-400"
                      : "text-orange-600 dark:text-orange-400"
                  : "text-rose-600 dark:text-rose-400";
                return (
                  <TableRow key={p.projectId ?? "__none__"}>
                    <TableCell className="font-medium">
                      {p.projectId ? (
                        <Link href={`/projets/${p.projectId}`} className="hover:underline">
                          {p.projectName}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Sans projet</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground text-sm">
                      {formatDuration(p.actualMinutes)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {formatEuro(p.revenueAmount)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground text-sm">
                      {formatEuro(p.costAmount)}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-sm ${marginTone}`}>
                      {sign}
                      {formatEuro(Math.abs(p.marginAmount))}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-sm ${marginTone}`}>
                      {p.marginPct == null ? "—" : `${p.marginPct.toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {stats.byUser.length > 0 ? (
        <section className="space-y-3 rounded-lg border bg-card p-6">
          <h2 className="font-medium text-sm">Par membre</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Membre</TableHead>
                <TableHead className="text-right">Réalisé</TableHead>
                <TableHead className="text-right">Planifié</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stats.byUser.map((u) => (
                <TableRow key={u.userId}>
                  <TableCell className="font-medium">{u.userName ?? "(sans nom)"}</TableCell>
                  <TableCell className="text-right font-mono text-sm">
                    {formatDuration(u.actualMinutes)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground text-sm">
                    {formatDuration(u.plannedMinutes)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}
    </div>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      className={`rounded-md border px-3 py-1.5 text-sm transition-colors ${
        active ? "bg-foreground text-background" : "hover:bg-muted"
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * Activité Claude Code : un indicateur d'où est parti l'effort, pas du
 * temps réalisé. Rien de ce bloc n'entre dans les KPI ci-dessus ni dans la
 * marge : c'est une source parmi d'autres (réunions, mails, calendrier) à
 * partir de laquelle on décide ce qu'on saisit vraiment.
 */
function ClaudeActivitySection({
  activity,
  choices,
}: {
  activity: ClaudeActivity;
  choices: RepoLinkChoice[];
}) {
  if (activity.byProject.length === 0) return null;
  const choiceFor = new Map(choices.map((c) => [c.remote, c]));
  return (
    <section className="space-y-3 rounded-lg border border-dashed bg-muted/30 p-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 font-medium text-sm">
          <Terminal className="size-4 text-muted-foreground" weight="regular" />
          Activité Claude Code
        </h2>
        <span className="font-mono text-muted-foreground text-xs">
          {formatDuration(activity.totalMinutes)}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        Indicatif, non compté dans le réalisé : à arbitrer avec les réunions, les mails et le
        calendrier avant de saisir un créneau.
      </p>
      <ul className="space-y-1">
        {activity.byProject.map((row) =>
          row.projectId ? (
            <li key={row.projectId} className="flex items-baseline justify-between gap-3 text-sm">
              <Link href={`/projets/${row.projectId}`} className="truncate hover:underline">
                {row.projectName ?? "Projet"}
              </Link>
              <span className="shrink-0 font-mono text-muted-foreground text-xs">
                {formatDuration(row.minutes)}
              </span>
            </li>
          ) : (
            // Un dépôt en doute par remote : le nom seul n'a pas suffi.
            row.remotes.map((remote) => {
              const choice = choiceFor.get(remote);
              return (
                <li
                  key={remote}
                  className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
                >
                  <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="truncate font-mono text-muted-foreground text-xs">
                      {remote}
                    </span>
                    {choice ? <RepoLinkPicker choice={choice} /> : null}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground text-xs">
                    {row.remotes.length === 1 ? formatDuration(row.minutes) : ""}
                  </span>
                </li>
              );
            })
          ),
        )}
      </ul>
    </section>
  );
}

function SourceStat({ label, minutes }: { label: string; minutes: number }) {
  return (
    <span>
      {label} <span className="font-mono text-foreground">{formatDuration(minutes)}</span>
    </span>
  );
}

function KpiBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "actual" | "planned" | "muted";
}) {
  const accent =
    tone === "actual"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "planned"
        ? "text-primary"
        : "text-muted-foreground";
  return (
    <div className="rounded-lg border bg-card p-4">
      <p className="text-muted-foreground text-xs uppercase tracking-wide">{label}</p>
      <p className={`mt-1 font-semibold text-2xl tracking-tight ${accent}`}>{value}</p>
    </div>
  );
}
