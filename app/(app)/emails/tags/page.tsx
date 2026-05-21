import { Breadcrumbs } from "@/components/breadcrumbs";
import { TagsManagement } from "@/components/emails/tags-management";
import { PageHeader } from "@/components/page-header";
import { requireUser } from "@/lib/auth/server";
import { listAllTags } from "@/lib/gmail/queries";

export default async function EmailTagsPage() {
  const user = await requireUser();
  const tags = await listAllTags(user.id);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Emails", href: "/emails" }, { label: "Tags" }]} />}
        title="Tags Gmail"
        description="Catégories personnalisées (Compta, Annexe…) et tags auto-créés depuis le CRM. Chaque tag = un label Gmail Paradeos/…"
      />

      <TagsManagement
        categories={tags.filter((t) => t.kind === "category")}
        projects={tags.filter((t) => t.kind === "project")}
        contacts={tags.filter((t) => t.kind === "contact")}
        entities={tags.filter((t) => t.kind === "entity")}
      />
    </div>
  );
}
