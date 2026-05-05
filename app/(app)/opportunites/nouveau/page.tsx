import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { asc } from "drizzle-orm";
import { OpportunityForm } from "../opportunity-form";

export default async function NewOpportunityPage() {
  const authUser = await requireUser();
  const conn = await db();

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
      <PageHeader eyebrow="Opportunités" title="Nouvelle opportunité" />
      <OpportunityForm
        mode="create"
        entities={entityList}
        contacts={contactList}
        users={userList}
        defaultValues={{
          title: "",
          status: "not_started",
          entityId: "",
          contactId: "",
          valueAmount: "",
          probability: "",
          source: "",
          firstContactDate: "",
          lastContactDate: "",
          followUpDate: "",
          expectedCloseDate: "",
          ownerId: authUser.id,
          notes: "",
        }}
      />
    </div>
  );
}
