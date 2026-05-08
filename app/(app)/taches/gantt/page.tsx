import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { addDays, isoDate, startOfIsoWeek } from "@/lib/calendar";
import { db } from "@/lib/db/server";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import Link from "next/link";
import { GanttProjectFilter } from "./gantt-project-filter";
import { GanttQuickAdd } from "./gantt-quick-add";
import { GanttView } from "./gantt-view";

type SearchParams = Promise<{ from?: string; project?: string }>;

function parseFromParam(raw: string | undefined): Date {
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00`);
    if (!Number.isNaN(d.getTime())) return startOfIsoWeek(d);
  }
  // Par défaut, on commence une semaine avant aujourd'hui pour laisser
  // un peu de contexte passé.
  return addDays(startOfIsoWeek(new Date()), -7);
}

export default async function GanttPage({ searchParams }: { searchParams: SearchParams }) {
  const { from, project } = await searchParams;
  const viewStart = parseFromParam(from);
  const prev = addDays(viewStart, -28);
  const next = addDays(viewStart, 28);

  const conn = await db();
  const [taskRows, projectList] = await Promise.all([
    conn
      .select({
        id: tasks.id,
        title: tasks.title,
        status: tasks.status,
        priority: tasks.priority,
        projectId: tasks.projectId,
        projectName: projects.name,
        projectColor: projects.color,
        startDate: tasks.startDate,
        dueDate: tasks.dueDate,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(project ? and(eq(tasks.projectId, project), isNotNull(tasks.id)) : undefined)
      .orderBy(asc(tasks.startDate), asc(tasks.dueDate), asc(tasks.title)),
    conn
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .orderBy(asc(projects.name)),
  ]);

  const scheduled = taskRows.filter((t) => t.startDate || t.dueDate);
  const unscheduled = taskRows.filter((t) => !t.startDate && !t.dueDate);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Tâches"
        title="Gantt"
        description="Planification visuelle des tâches dans le temps. Drag pour déplacer, glisser les bords pour redimensionner."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/taches/gantt?from=${isoDate(prev)}${project ? `&project=${project}` : ""}`}
              >
                ← 4 sem.
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/taches/gantt${project ? `?project=${project}` : ""}`}>Aujourd'hui</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/taches/gantt?from=${isoDate(next)}${project ? `&project=${project}` : ""}`}
              >
                4 sem. →
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/taches">Liste</Link>
            </Button>
          </>
        }
      />

      <GanttProjectFilter
        projects={projectList}
        selected={project ?? null}
        viewStartIso={isoDate(viewStart)}
      />

      {unscheduled.length > 0 ? (
        <p className="rounded-md border border-dashed bg-muted/30 p-2 text-muted-foreground text-xs">
          {unscheduled.length} tâche{unscheduled.length > 1 ? "s" : ""} sans dates —{" "}
          <Link href="/taches" className="underline hover:text-foreground">
            définir dans la liste
          </Link>{" "}
          puis revenir ici.
        </p>
      ) : null}

      <GanttView
        viewStartIso={isoDate(viewStart)}
        tasks={scheduled.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          projectId: t.projectId,
          projectName: t.projectName,
          projectColor: t.projectColor,
          // Si une seule date présente, on traite comme 1-jour pour l'afficher.
          startDate: t.startDate ?? t.dueDate,
          dueDate: t.dueDate ?? t.startDate,
        }))}
      />

      <GanttQuickAdd projectId={project ?? null} />
    </div>
  );
}
