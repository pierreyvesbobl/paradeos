import { PageHeader } from "@/components/page-header";
import { ComptaTabs } from "./compta-tabs";
import { DashboardView } from "./dashboard-view";
import { RapprochementView } from "./rapprochement-view";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function ComptaPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const tab = params.tab === "rapprochement" ? "rapprochement" : "dashboard";
  const debug = typeof params.debug === "string" ? params.debug : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finance"
        title="Compta"
        description="Vue d'ensemble des montants facturés, à facturer, encaissés et rapprochement Dougs."
      />
      <ComptaTabs current={tab} />
      {tab === "dashboard" ? <DashboardView /> : <RapprochementView debug={debug} />}
    </div>
  );
}
