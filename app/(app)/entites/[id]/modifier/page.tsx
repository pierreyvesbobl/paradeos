import { Breadcrumbs } from "@/components/breadcrumbs";
import { PageHeader } from "@/components/page-header";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { EntityForm } from "../../entity-form";

type Params = Promise<{ id: string }>;

export default async function EditEntityPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();
  const [entity] = await conn.select().from(entities).where(eq(entities.id, id)).limit(1);
  if (!entity) notFound();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow={
          <Breadcrumbs
            items={[
              { label: "Entités", href: "/entites" },
              { label: entity.name, href: `/entites/${entity.id}` },
              { label: "Modifier" },
            ]}
          />
        }
        title={`Modifier — ${entity.name}`}
      />
      <EntityForm
        mode="edit"
        defaultValues={{
          id: entity.id,
          name: entity.name,
          kind: entity.kind,
          website: entity.website ?? "",
          siren: entity.siren ?? "",
          vatNumber: entity.vatNumber ?? "",
          address: entity.address ?? {},
          notes: entity.notes ?? "",
        }}
      />
    </div>
  );
}
