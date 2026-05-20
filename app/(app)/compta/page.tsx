import { PageHeader } from "@/components/page-header";
import { Suspense } from "react";
import { ComptaTabs } from "./compta-tabs";
import { DashboardView } from "./dashboard-view";
import type { ComptaPeriod } from "./period-selector";
import { RapprochementView } from "./rapprochement-view";
import { SignedQuotesView } from "./signed-quotes-view";

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
  const tabRaw = params.tab;
  const tab: "dashboard" | "signed" | "rapprochement" =
    tabRaw === "rapprochement" ? "rapprochement" : tabRaw === "signed" ? "signed" : "dashboard";
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
      ) : tab === "signed" ? (
        <SignedQuotesView />
      ) : (
        <Suspense fallback={<RapprochementSkeleton />}>
          <RapprochementView debug={debug} />
        </Suspense>
      )}
    </div>
  );
}

/**
 * Squelette affiché immédiatement pendant que les 50+ appels Dougs API
 * du matcher s'exécutent. Sans Suspense, l'utilisateur voyait une page
 * blanche pendant 3-5s.
 */
function RapprochementSkeleton() {
  return (
    <div className="space-y-6 text-sm">
      <div className="flex items-center justify-between gap-3">
        <p className="text-muted-foreground">Synchronisation Dougs en cours…</p>
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
      </div>
      <div className="rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        </div>
        <ul className="divide-y">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="space-y-2 px-6 py-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted/70" />
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        </div>
        <ul className="divide-y">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="space-y-2 px-6 py-4">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted/70" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
