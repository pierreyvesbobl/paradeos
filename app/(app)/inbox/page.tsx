import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/server";
import { getInboxItems } from "@/lib/db/queries/inbox";
import { InboxView } from "./inbox-view";

export const metadata = {
  title: "À traiter — Paradeos",
};

export default async function InboxPage() {
  const user = await requireUser();
  const { items, counts } = await getInboxItems(user.id);

  return (
    <div className="mx-auto flex max-w-[1024px] flex-col gap-6">
      <PageHeader
        title="À traiter"
        description={
          counts.total === 0
            ? "Rien qui traîne. Profites-en."
            : `${counts.total} extraction${counts.total > 1 ? "s" : ""} IA en attente de validation.`
        }
      />
      <InboxView items={items} />
    </div>
  );
}
