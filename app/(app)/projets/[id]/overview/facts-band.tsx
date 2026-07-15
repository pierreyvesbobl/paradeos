import { formatDate } from "@/lib/format";
import { type ProjectBillingType, projectBillingTypeLabels } from "@/lib/schemas/projects";
import { cn } from "@/lib/utils";

const FMT_EUR = new Intl.NumberFormat("fr-FR", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 2,
});

function formatEuroOrDash(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  const num = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(num)) return "—";
  return FMT_EUR.format(num);
}

/**
 * Bandeau « facts » 5 colonnes en tête de la Vue d'ensemble : Budget /
 * Prévisionnel / Probabilité / Facturation / Période. Cellules
 * séparées par des hairlines réalisées via un `gap:1px` sur `--border`
 * (technique CSS grid + fond) — chaque cellule reprend le fond `app`.
 */
export function FactsBand({
  budgetAmount,
  forecastAmount,
  probability,
  billingType,
  periodStart,
}: {
  budgetAmount: number | string | null;
  forecastAmount: number | string | null;
  probability: number | null;
  billingType: ProjectBillingType;
  periodStart: string | Date | null;
}) {
  const probaClamped =
    probability == null ? null : Math.max(0, Math.min(100, Math.round(probability)));
  const periodLabel = periodStart ? `Dès le ${formatDate(periodStart)}` : "—";

  return (
    <div className="overflow-hidden rounded-[10px] border border-ds-border bg-ds-border">
      <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5">
        <Cell label="Budget">
          <span className="font-mono font-semibold text-[15px] text-foreground">
            {formatEuroOrDash(budgetAmount)}
          </span>
        </Cell>
        <Cell label="Prévisionnel">
          <span className="font-mono font-semibold text-[15px] text-foreground">
            {formatEuroOrDash(forecastAmount)}
          </span>
        </Cell>
        <Cell label="Probabilité">
          <div className="space-y-1.5">
            <span className="font-mono font-semibold text-[15px] text-foreground">
              {probaClamped == null ? "—" : `${probaClamped} %`}
            </span>
            {probaClamped == null ? null : (
              <div className="h-[5px] w-full overflow-hidden rounded-full bg-ds-press">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${probaClamped}%` }}
                />
              </div>
            )}
          </div>
        </Cell>
        <Cell label="Facturation">
          <span
            className={cn(
              "inline-flex w-fit items-center rounded-md border border-ds-border bg-ds-app px-2 py-0.5 text-[13px] text-foreground",
            )}
          >
            {projectBillingTypeLabels[billingType]}
          </span>
        </Cell>
        <Cell label="Période">
          <span className="font-medium text-[13px] text-foreground">{periodLabel}</span>
        </Cell>
      </div>
    </div>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5 bg-ds-app px-4 py-3">
      <p className="font-semibold text-[10px] text-muted-foreground uppercase tracking-[0.05em]">
        {label}
      </p>
      {children}
    </div>
  );
}
