import {
  ProjBilling,
  ProjBudget,
  ProjPeriod,
  ProjProbability,
  ProjValueAmount,
} from "@/app/(app)/projets/[id]/inline-fields";
import type { ProjectBillingType } from "@/lib/schemas/projects";

/**
 * Bandeau « facts » 5 colonnes en tête de la Vue d'ensemble : Budget /
 * Prévisionnel / Probabilité / Facturation / Période. Tout est éditable
 * inline — clic sur la valeur ouvre l'éditeur adéquat (nombre, slider,
 * select, date range). Cellules séparées par des hairlines (grid gap=1px).
 *
 * Le prévisionnel édite `valueAmount` (le montant contrat manuel). Si un
 * devis Dougs est déjà remonté, son montant peut piloter le prévisionnel
 * affiché ailleurs — mais la valeur éditable ici reste bien le champ
 * projet, pas le devis.
 */
export function FactsBand({
  projectId,
  budgetAmount,
  valueAmount,
  probability,
  billingType,
  startDate,
  endDate,
}: {
  projectId: string;
  budgetAmount: string | null;
  valueAmount: string | null;
  probability: number | null;
  billingType: ProjectBillingType;
  startDate: string | null;
  endDate: string | null;
}) {
  return (
    <div className="overflow-hidden rounded-[10px] border border-ds-border bg-ds-border">
      <div className="grid grid-cols-2 gap-px sm:grid-cols-3 lg:grid-cols-5">
        <Cell label="Budget">
          <ProjBudget id={projectId} value={budgetAmount} />
        </Cell>
        <Cell label="Prévisionnel">
          <ProjValueAmount id={projectId} value={valueAmount} />
        </Cell>
        <Cell label="Probabilité">
          <ProjProbability id={projectId} value={probability} />
        </Cell>
        <Cell label="Facturation">
          <ProjBilling id={projectId} value={billingType} />
        </Cell>
        <Cell label="Période">
          <ProjPeriod id={projectId} startValue={startDate} endValue={endDate} />
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
