import { PageHeader } from "@/components/page-header";
import { Suspense } from "react";
import { AchatsView } from "./achats-view";
import { ComptaTabs } from "./compta-tabs";
import { type ComptaSegment, DashboardView } from "./dashboard-view";
import { FacturesView } from "./factures-view";
import type { ComptaPeriod } from "./period-selector";
import { RapprochementView } from "./rapprochement-view";
import { RelancesView, countOverdueInvoices } from "./relances-view";

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

const VALID_SEGMENTS: ComptaSegment[] = ["conso", "presta", "cowork"];

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ComptaPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tabRaw = params.tab;
  const tab: "dashboard" | "rapprochement" | "factures" | "achats" | "relances" =
    tabRaw === "rapprochement"
      ? "rapprochement"
      : tabRaw === "factures"
        ? "factures"
        : tabRaw === "achats"
          ? "achats"
          : tabRaw === "relances"
            ? "relances"
            : "dashboard";
  const debug = typeof params.debug === "string" ? params.debug : undefined;
  const periodRaw = typeof params.period === "string" ? params.period : null;
  const period: ComptaPeriod = (
    periodRaw && (VALID_PERIODS as string[]).includes(periodRaw) ? periodRaw : "last_12_months"
  ) as ComptaPeriod;
  const segmentRaw = typeof params.segment === "string" ? params.segment : null;
  const segment: ComptaSegment = (
    segmentRaw && (VALID_SEGMENTS as string[]).includes(segmentRaw) ? segmentRaw : "conso"
  ) as ComptaSegment;

  const overdueCount = await countOverdueInvoices();
  const assigneeFilter: "all" | "me" = params.assignee === "me" ? "me" : "all";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Compta"
        description="Vue d'ensemble du signé, facturé, encaissé et rapprochement Dougs."
      />
      <ComptaTabs current={tab} relancesCount={overdueCount} />
      {tab === "dashboard" ? (
        <DashboardView period={period} segment={segment} />
      ) : tab === "factures" ? (
        <FacturesView />
      ) : tab === "achats" ? (
        <Suspense fallback={<AchatsSkeleton />}>
          <AchatsView />
        </Suspense>
      ) : tab === "relances" ? (
        <RelancesView assigneeFilter={assigneeFilter} />
      ) : (
        <Suspense fallback={<RapprochementSkeleton />}>
          <RapprochementView debug={debug} />
        </Suspense>
      )}
    </div>
  );
}

/** Squelette pendant le fetch Dougs des factures d'achat. */
function AchatsSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[86px] animate-pulse rounded-xl border bg-muted-foreground/5" />
        ))}
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <li key={i} className="space-y-2 px-4 py-3">
            <div className="h-4 w-1/3 animate-pulse rounded bg-muted-foreground/15" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-muted-foreground/10" />
          </li>
        ))}
      </ul>
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
        <div className="h-8 w-32 animate-pulse rounded-md bg-muted-foreground/15" />
      </div>
      <div className="rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <div className="h-4 w-48 animate-pulse rounded bg-muted-foreground/15" />
        </div>
        <ul className="divide-y">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className="space-y-2 px-6 py-4">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted-foreground/15" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted-foreground/10" />
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-lg border bg-card">
        <div className="border-b px-6 py-4">
          <div className="h-4 w-40 animate-pulse rounded bg-muted-foreground/15" />
        </div>
        <ul className="divide-y">
          {[0, 1, 2, 3, 4].map((i) => (
            <li key={i} className="space-y-2 px-6 py-4">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted-foreground/15" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted-foreground/10" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
