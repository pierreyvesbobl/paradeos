import { PageHeader } from "@/components/page-header";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { asc } from "drizzle-orm";
import { ContactForm } from "../contact-form";

type SearchParams = Promise<{ entityId?: string }>;

export default async function NewContactPage({ searchParams }: { searchParams: SearchParams }) {
  const { entityId } = await searchParams;
  const conn = await db();
  const entityList = await conn
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .orderBy(asc(entities.name));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Contacts" title="Nouveau contact" />
      <ContactForm
        mode="create"
        entities={entityList}
        defaultValues={{
          firstName: "",
          lastName: "",
          email: "",
          phone: "",
          jobTitle: "",
          linkedinUrl: "",
          entityId: entityId ?? "",
          notes: "",
        }}
      />
    </div>
  );
}
