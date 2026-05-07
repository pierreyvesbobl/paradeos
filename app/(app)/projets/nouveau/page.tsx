import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import type { ProjectKind, ProjectStatus } from "@/lib/schemas/projects";
import { asc } from "drizzle-orm";
import { ProjectForm } from "../project-form";

type SearchParams = Promise<{
  kind?: ProjectKind;
  entityId?: string;
  status?: ProjectStatus;
}>;

export default async function NewProjectPage({ searchParams }: { searchParams: SearchParams }) {
  const authUser = await requireUser();
  const { kind, entityId, status } = await searchParams;
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
      })
      .from(contacts)
      .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
    conn
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .orderBy(asc(users.fullName)),
  ]);

  // Pour kind=client, démarre par défaut au stade commercial.
  // Pour les autres (product/transverse), pas de phase commerciale → active direct.
  const initialKind: ProjectKind = kind ?? "client";
  const initialStatus: ProjectStatus =
    status ?? (initialKind === "client" ? "not_started" : "active");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Projets" title="Nouveau projet / deal" />
      <ProjectForm
        mode="create"
        entities={entityList}
        contacts={contactList}
        users={userList}
        defaultValues={{
          name: "",
          kind: initialKind,
          status: initialStatus,
          entityId: entityId ?? "",
          contactId: "",
          color: "",
          icon: "",
          description: "",
          startDate: "",
          endDate: "",
          ownerId: authUser.id,
          billingType: initialKind === "client" ? "fixed" : "none",
          budgetAmount: "",
          hourlyRate: "",
          valueAmount: "",
          probability: "",
          source: "",
          firstContactDate: "",
          lastContactDate: "",
          followUpDate: "",
          expectedCloseDate: "",
        }}
      />
    </div>
  );
}
