import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { asc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ProjectForm } from "../../project-form";

type Params = Promise<{ id: string }>;

export default async function EditProjectPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();
  const [project] = await conn.select().from(projects).where(eq(projects.id, id)).limit(1);
  if (!project) notFound();

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

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Projets" title={`Modifier — ${project.name}`} />
      <ProjectForm
        mode="edit"
        entities={entityList}
        contacts={contactList}
        users={userList}
        defaultValues={{
          id: project.id,
          name: project.name,
          kind: project.kind,
          status: project.status,
          entityId: project.entityId ?? "",
          contactId: project.contactId ?? "",
          color: project.color ?? "",
          icon: project.icon ?? "",
          description: project.description ?? "",
          startDate: project.startDate ?? "",
          endDate: project.endDate ?? "",
          ownerId: project.ownerId ?? "",
          billingType: project.billingType,
          budgetAmount: project.budgetAmount ?? "",
          hourlyRate: project.hourlyRate ?? "",
          valueAmount: project.valueAmount ?? "",
          probability: project.probability != null ? String(project.probability) : "",
          source: project.source ?? "",
          firstContactDate: project.firstContactDate ?? "",
          lastContactDate: project.lastContactDate ?? "",
          followUpDate: project.followUpDate ?? "",
          expectedCloseDate: project.expectedCloseDate ?? "",
        }}
      />
    </div>
  );
}
