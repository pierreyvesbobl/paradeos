import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { OpportunityForm } from "../../opportunity-form";

type Params = Promise<{ id: string }>;

export default async function EditOpportunityPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();

  const [opp] = await conn.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
  if (!opp) notFound();

  const [entityList, contactList, userList] = await Promise.all([
    conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .orderBy(asc(entities.name)),
    conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        entityId: contacts.entityId,
      })
      .from(contacts)
      .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
    conn
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .orderBy(asc(users.fullName)),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Opportunités" title={`Modifier — ${opp.title}`} />
      <OpportunityForm
        mode="edit"
        entities={entityList}
        contacts={contactList}
        users={userList}
        defaultValues={{
          id: opp.id,
          title: opp.title,
          status: opp.status,
          entityId: opp.entityId ?? "",
          contactId: opp.contactId ?? "",
          valueAmount: opp.valueAmount ?? "",
          probability: opp.probability != null ? String(opp.probability) : "",
          source: opp.source ?? "",
          firstContactDate: opp.firstContactDate ?? "",
          lastContactDate: opp.lastContactDate ?? "",
          followUpDate: opp.followUpDate ?? "",
          expectedCloseDate: opp.expectedCloseDate ?? "",
          ownerId: opp.ownerId ?? "",
          notes: opp.notes ?? "",
        }}
      />
    </div>
  );
}
