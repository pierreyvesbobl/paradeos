import { PageHeader } from "@/components/page-header";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { type ContactQualification, contactQualificationEnum } from "@/lib/schemas/coworking";
import { asc } from "drizzle-orm";
import { ContactForm } from "../contact-form";

type SearchParams = Promise<{ entityId?: string; qualification?: string }>;

export default async function NewContactPage({ searchParams }: { searchParams: SearchParams }) {
  const { entityId, qualification: rawQualif } = await searchParams;
  const qualification: ContactQualification | "" =
    rawQualif && (contactQualificationEnum.options as readonly string[]).includes(rawQualif)
      ? (rawQualif as ContactQualification)
      : "";

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
          qualification,
          notes: "",
        }}
      />
    </div>
  );
}
