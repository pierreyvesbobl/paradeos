import { PageHeader } from "@/components/page-header";
import { entities } from "@/db/schema/entities";
import { users } from "@/db/schema/users";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import type { ProjectKind } from "@/lib/schemas/projects";
import { asc } from "drizzle-orm";
import { ProjectForm } from "../project-form";

type SearchParams = Promise<{ kind?: ProjectKind; entityId?: string }>;

export default async function NewProjectPage({ searchParams }: { searchParams: SearchParams }) {
  const authUser = await requireUser();
  const { kind, entityId } = await searchParams;
  const conn = await db();
  const [entityList, userList] = await Promise.all([
    conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .orderBy(asc(entities.name)),
    conn
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .orderBy(asc(users.fullName)),
  ]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader eyebrow="Projets" title="Nouveau projet" />
      <ProjectForm
        mode="create"
        entities={entityList}
        users={userList}
        defaultValues={{
          name: "",
          kind: kind ?? "transverse",
          status: "planning",
          entityId: entityId ?? "",
          color: "",
          icon: "",
          description: "",
          startDate: "",
          endDate: "",
          ownerId: authUser.id,
          billingType: kind === "client" ? "fixed" : "none",
          budgetAmount: "",
          hourlyRate: "",
        }}
      />
    </div>
  );
}
