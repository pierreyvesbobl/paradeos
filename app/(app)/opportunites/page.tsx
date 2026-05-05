import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { asc, sql } from "drizzle-orm";
import { List, Plus } from "lucide-react";
import Link from "next/link";
import { KanbanBoard } from "./kanban-board";

export default async function OpportunitiesPage() {
  const conn = await db();
  const rows = await conn
    .select({
      id: opportunities.id,
      title: opportunities.title,
      status: opportunities.status,
      valueAmount: opportunities.valueAmount,
      probability: opportunities.probability,
      followUpDate: opportunities.followUpDate,
      entityId: entities.id,
      entityName: entities.name,
      ownerId: users.id,
      ownerName: users.fullName,
      ownerAvatarUrl: users.avatarUrl,
    })
    .from(opportunities)
    .leftJoin(entities, sql`${opportunities.entityId} = ${entities.id}`)
    .leftJoin(users, sql`${opportunities.ownerId} = ${users.id}`)
    .orderBy(asc(opportunities.title));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Opportunités"
        description="Pipeline commercial Automato. Drag & drop pour changer le statut."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/opportunites/liste">
                <List className="size-4" />
                Vue liste
              </Link>
            </Button>
            <Button asChild>
              <Link href="/opportunites/nouveau">
                <Plus className="size-4" />
                Nouvelle
              </Link>
            </Button>
          </>
        }
      />

      <KanbanBoard
        items={rows.map((r) => ({
          id: r.id,
          title: r.title,
          status: r.status,
          valueAmount: r.valueAmount,
          probability: r.probability,
          followUpDate: r.followUpDate,
          entityId: r.entityId,
          entityName: r.entityName,
          ownerId: r.ownerId,
          ownerName: r.ownerName,
          ownerAvatarUrl: r.ownerAvatarUrl,
        }))}
      />
    </div>
  );
}
