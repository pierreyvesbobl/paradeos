import { BellRinging } from "@phosphor-icons/react/dist/ssr";
import { and, asc, eq, gte, isNotNull, lte, ne } from "drizzle-orm";
import Link from "next/link";
import { entities } from "@/db/schema/entities";
import { projects } from "@/db/schema/projects";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { EntityName, ProjectName } from "@/lib/demo/components";
import {
  isoDaysFromNow,
  projectTint,
  RELANCE_STATUS_LABEL,
  SectionHeader,
  shortDateFmt,
  todayIso,
} from "./shared";

export function FollowupsSectionHeader() {
  return (
    <SectionHeader
      icon={<BellRinging weight="duotone" className="size-4.5 text-primary-500" />}
      title="Relances cette semaine"
    />
  );
}

/** Relances projet prévues dans les 7 jours (5 premières). */
export async function FollowupsSection() {
  await requireUser();
  const conn = await db();
  const today = todayIso();
  const weekEnd = isoDaysFromNow(7);

  const relances = await conn
    .select({
      id: projects.id,
      title: projects.name,
      followUpDate: projects.followUpDate,
      status: projects.status,
      entityId: entities.id,
      entityName: entities.name,
      color: projects.color,
    })
    .from(projects)
    .leftJoin(entities, eq(projects.entityId, entities.id))
    .where(
      and(
        isNotNull(projects.followUpDate),
        gte(projects.followUpDate, today),
        lte(projects.followUpDate, weekEnd),
        ne(projects.status, "lost"),
      ),
    )
    .orderBy(asc(projects.followUpDate))
    .limit(5);

  return (
    <section>
      <FollowupsSectionHeader />
      <div className="overflow-hidden rounded-[10px] border border-ds-border">
        {relances.length === 0 ? (
          <div className="bg-ds-app px-3.5 py-4 text-ds-text-tertiary text-sm">
            Aucune relance prévue d'ici 7 jours.
          </div>
        ) : (
          relances.map((r, i) => (
            <Link
              href={`/projets/${r.id}`}
              key={r.id}
              className={`flex items-center gap-2.5 bg-ds-app px-3.5 py-3 transition-colors hover:bg-ds-hover ${i < relances.length - 1 ? "border-ds-border border-b" : ""}`}
            >
              <span
                className="size-[9px] flex-none rounded-full"
                style={{ background: projectTint({ id: r.id, color: r.color }) }}
              />
              <div className="min-w-0 flex-1">
                <ProjectName
                  project={{ id: r.id, name: r.title }}
                  className="block truncate text-ds-text text-sm"
                />
                <div className="truncate text-ds-text-tertiary text-xs">
                  <EntityName entity={r.entityId ? { id: r.entityId, name: r.entityName } : null} />{" "}
                  · {RELANCE_STATUS_LABEL[r.status] ?? r.status}
                </div>
              </div>
              <span className="font-medium text-ds-text-tertiary text-xs">
                {r.followUpDate ? shortDateFmt.format(new Date(r.followUpDate)) : ""}
              </span>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
