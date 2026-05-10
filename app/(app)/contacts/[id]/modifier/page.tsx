import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ContactForm } from "../../contact-form";

type Params = Promise<{ id: string }>;

export default async function EditContactPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();
  const [contact] = await conn.select().from(contacts).where(eq(contacts.id, id)).limit(1);
  if (!contact) notFound();

  const entityList = await conn
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .orderBy(asc(entities.name));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Contacts"
        title={`Modifier — ${contact.firstName} ${contact.lastName}`}
      />
      <ContactForm
        mode="edit"
        entities={entityList}
        defaultValues={{
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          email: contact.email ?? "",
          phone: contact.phone ?? "",
          jobTitle: contact.jobTitle ?? "",
          linkedinUrl: contact.linkedinUrl ?? "",
          entityId: contact.entityId ?? "",
          qualification: contact.qualification ?? "",
          notes: contact.notes ?? "",
        }}
      />
    </div>
  );
}
