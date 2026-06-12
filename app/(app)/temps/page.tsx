import { PageHeader } from "@/components/page-header";
import { PlanningView } from "./planning-view";
import { type Range, RapportView } from "./rapport-view";
import { TempsTabs } from "./temps-tabs";

type SearchParams = Promise<{ tab?: string; range?: Range; week?: string }>;

export default async function TempsPage({ searchParams }: { searchParams: SearchParams }) {
  const { tab, range, week } = await searchParams;
  const activeTab = tab === "rapport" ? "rapport" : "planning";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Time tracking"
        title="Time tracking"
        description="Planification du calendrier, suivi du temps et rentabilité par projet."
      />

      <TempsTabs current={activeTab} />

      {activeTab === "planning" ? (
        <PlanningView week={week} />
      ) : (
        <RapportView range={range} week={week} />
      )}
    </div>
  );
}
