/**
 * Resources MCP : URIs lecture seule exposant les données pour
 * consommation directe par Claude (pas besoin d'appeler un tool).
 */
import { meetings } from "../db/schema/meetings";
import { projects } from "../db/schema/projects";
import { tasks } from "../db/schema/tasks";
import { and, asc, desc, eq, isNotNull, lte, sql } from "drizzle-orm";
import type { UserContext } from "./context";
import { db } from "./db";

export const RESOURCE_TEMPLATES = [
  {
    uriTemplate: "paradeos://projects",
    name: "Tous les projets",
    description: "Liste compacte de tous les projets actifs (kind, status, dates clés).",
    mimeType: "application/json",
  },
  {
    uriTemplate: "paradeos://projects/{id}",
    name: "Détail projet",
    description: "Fiche projet avec entité, owner, tâches, temps passé.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "paradeos://meetings/{id}",
    name: "Résumé meeting",
    description: "Résumé markdown d'un meeting + propositions LLM en attente.",
    mimeType: "text/markdown",
  },
  {
    uriTemplate: "paradeos://tasks/today",
    name: "Mes tâches du jour",
    description: "Tâches assignées au current user dont l'échéance est ≤ aujourd'hui.",
    mimeType: "application/json",
  },
  {
    uriTemplate: "paradeos://tasks/overdue",
    name: "Mes tâches en retard",
    description: "Tâches dont la due_date est passée et qui ne sont pas terminées.",
    mimeType: "application/json",
  },
];

export async function readResource(uri: string, ctx: UserContext) {
  // paradeos://projects
  if (uri === "paradeos://projects") {
    const conn = db();
    const rows = await conn
      .select({
        id: projects.id,
        name: projects.name,
        kind: projects.kind,
        status: projects.status,
      })
      .from(projects)
      .orderBy(desc(projects.updatedAt))
      .limit(100);
    return { mimeType: "application/json", text: JSON.stringify(rows, null, 2) };
  }

  // paradeos://projects/{id}
  const projMatch = uri.match(/^paradeos:\/\/projects\/([0-9a-f-]+)$/i);
  if (projMatch) {
    const conn = db();
    const [proj] = await conn
      .select()
      .from(projects)
      .where(eq(projects.id, projMatch[1] ?? ""))
      .limit(1);
    if (!proj) throw new Error("Projet introuvable.");
    return { mimeType: "application/json", text: JSON.stringify(proj, null, 2) };
  }

  // paradeos://meetings/{id}
  const meetingMatch = uri.match(/^paradeos:\/\/meetings\/([0-9a-f-]+)$/i);
  if (meetingMatch) {
    const conn = db();
    const [m] = await conn
      .select()
      .from(meetings)
      .where(eq(meetings.id, meetingMatch[1] ?? ""))
      .limit(1);
    if (!m) throw new Error("Meeting introuvable.");
    const md = `# ${m.title}\n\n${m.occurredAt ? `_${new Date(m.occurredAt).toLocaleString("fr-FR")}_\n\n` : ""}${m.summary ?? "_Pas encore de résumé._"}`;
    return { mimeType: "text/markdown", text: md };
  }

  // paradeos://tasks/today
  if (uri === "paradeos://tasks/today") {
    const conn = db();
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const rows = await conn
      .select({ id: tasks.id, title: tasks.title, status: tasks.status, dueDate: tasks.dueDate })
      .from(tasks)
      .where(
        and(
          eq(tasks.assigneeId, ctx.userId),
          isNotNull(tasks.dueDate),
          sql`${tasks.dueDate} <= ${today.toISOString().slice(0, 10)}`,
          sql`${tasks.status} not in ('done', 'cancelled')`,
        ),
      )
      .orderBy(asc(tasks.dueDate));
    return { mimeType: "application/json", text: JSON.stringify(rows, null, 2) };
  }

  // paradeos://tasks/overdue
  if (uri === "paradeos://tasks/overdue") {
    const conn = db();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rows = await conn
      .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, status: tasks.status })
      .from(tasks)
      .where(
        and(
          eq(tasks.assigneeId, ctx.userId),
          lte(tasks.dueDate, today.toISOString().slice(0, 10)),
          sql`${tasks.status} not in ('done', 'cancelled')`,
        ),
      )
      .orderBy(asc(tasks.dueDate));
    return { mimeType: "application/json", text: JSON.stringify(rows, null, 2) };
  }

  throw new Error(`URI non reconnue : ${uri}`);
}
