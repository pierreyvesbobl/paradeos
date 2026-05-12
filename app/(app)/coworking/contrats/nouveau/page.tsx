import { Breadcrumbs } from "@/components/breadcrumbs";
import { ContractForm } from "@/components/coworking/contract-form";
import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { asc } from "drizzle-orm";

export default async function NewContractPage() {
  const conn = await db();
  const [contactRows, entityRows] = await Promise.all([
    conn
      .select({ id: contacts.id, firstName: contacts.firstName, lastName: contacts.lastName })
      .from(contacts)
      .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
    conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .orderBy(asc(entities.name)),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Breadcrumbs
            items={[
              { label: "Coworking", href: "/coworking" },
              { label: "Contrats", href: "/coworking?tab=contracts" },
              { label: "Nouveau" },
            ]}
          />
        }
        title="Nouveau contrat"
      />
      <div className="max-w-2xl">
        <ContractForm
          mode="create"
          contactOptions={contactRows.map((c) => ({
            id: c.id,
            label: `${c.firstName} ${c.lastName}`.trim(),
          }))}
          entityOptions={entityRows.map((e) => ({ id: e.id, label: e.name }))}
        />
      </div>
    </div>
  );
}
