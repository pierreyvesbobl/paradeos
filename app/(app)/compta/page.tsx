import { PageHeader } from "@/components/page-header";
import { ComptaTabs } from "./compta-tabs";
import { DashboardView } from "./dashboard-view";
import type { ComptaPeriod } from "./period-selector";
import { RapprochementView } from "./rapprochement-view";

export const dynamic = "force-dynamic";

const VALID_PERIODS: ComptaPeriod[] = [
  "current_month",
  "last_month",
  "last_3_months",
  "last_12_months",
  "current_year",
  "last_year",
  "all",
];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ComptaPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tab = params.tab === "rapprochement" ? "rapprochement" : "dashboard";
  const debug = typeof params.debug === "string" ? params.debug : undefined;
  const periodRaw = typeof params.period === "string" ? params.period : null;
  const period: ComptaPeriod = (
    periodRaw && (VALID_PERIODS as string[]).includes(periodRaw) ? periodRaw : "last_12_months"
  ) as ComptaPeriod;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Compta"
        description="Vue d'ensemble des montants facturés, à facturer, encaissés et rapprochement Dougs."
      />
      <ComptaTabs current={tab} />
      {tab === "dashboard" ? (
        <DashboardView period={period} />
      ) : (
        <RapprochementView debug={debug} />
      )}
    </div>
  );
}
