import { ContractForm } from "@/components/coworking/contract-form";
import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { db } from "@/lib/db/server";
import { asc } from "drizzle-orm";

export default async function NewContractPage() {
  const conn = await db();
  const contactOptions = await conn
    .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
    .from(contacts)
    .orderBy(asc(contacts.lastName), asc(contacts.firstName));

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Coworking" title="Nouveau contrat" />
      <div className="max-w-2xl">
        <ContractForm
          mode="create"
          contactOptions={contactOptions.map((c) => ({
            id: c.id,
            label: `${c.firstName} ${c.lastName}`.trim(),
          }))}
        />
      </div>
    </div>
  );
}
