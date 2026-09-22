import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { formatPersonName } from "@/lib/format";
import { asc, eq } from "drizzle-orm";
import { NewMeetingForm } from "./new-meeting-form";

// Le formulaire enchaîne création puis extraction LLM dans la même
// transition : les deux Server Actions sont servies par cette route et
// héritent de ce budget (cf. LLM_BUDGET_MS).
export const maxDuration = 300;

export default async function NewMeetingPage() {
  const conn = await db();
  const [projectList, userList, contactList] = await Promise.all([
    conn
      .select({ id: projects.id, name: projects.name, entityId: projects.entityId })
      .from(projects)
      .orderBy(asc(projects.name)),
    conn
      .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
      .from(users)
      .orderBy(asc(users.fullName)),
    conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        entityName: entities.name,
      })
      .from(contacts)
      .leftJoin(entities, eq(entities.id, contacts.entityId))
      .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Meetings"
        title="Nouveau meeting"
        description="Colle le transcript ou téléverse un fichier .txt / .vtt / .srt. L'extraction LLM démarrera après l'enregistrement."
      />
      <NewMeetingForm
        projects={projectList}
        users={userList}
        contacts={contactList.map((c) => ({
          id: c.id,
          fullName: formatPersonName(c.firstName, c.lastName),
          entityName: c.entityName ?? null,
        }))}
      />
    </div>
  );
}
