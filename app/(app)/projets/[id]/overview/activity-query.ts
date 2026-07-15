import "server-only";

import { auditLog } from "@/db/schema/audit-log";
import { gmailTags, gmailThreadTags, gmailThreads } from "@/db/schema/gmail";
import { notes } from "@/db/schema/notes";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { db } from "@/lib/db/server";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

export type ActivityKind = "email" | "note" | "task_created" | "status_transition";

export type ActivityItem = {
  kind: ActivityKind;
  at: Date;
  title: string;
  meta: string;
  href?: string;
};

/**
 * Agrège les événements récents d'un projet en une timeline unique
 * pour la carte « Activité » de la Vue d'ensemble. Sources :
 *   - `gmail_threads` liés au projet (via gmail_tags kind=project)
 *   - `notes` avec subject_type=project
 *   - `tasks.createdAt` du projet
 *   - `audit_log` sur `projects` où le statut a changé
 * Le tri se fait en JS (les 4 sub-queries sont indépendantes et petites).
 */
export async function getProjectActivity(projectId: string, limit = 12): Promise<ActivityItem[]> {
  const conn = await db();

  const [emailRows, noteRows, taskRows, auditRows] = await Promise.all([
    // Threads emails liés au projet (derniers 6)
    conn
      .select({
        id: gmailThreads.id,
        subject: gmailThreads.subject,
        lastMessageAt: gmailThreads.lastMessageAt,
        gmailThreadId: gmailThreads.gmailThreadId,
      })
      .from(gmailThreads)
      .innerJoin(gmailThreadTags, eq(gmailThreadTags.threadId, gmailThreads.id))
      .innerJoin(gmailTags, eq(gmailTags.id, gmailThreadTags.tagId))
      .where(and(eq(gmailTags.kind, "project"), eq(gmailTags.targetId, projectId)))
      .orderBy(desc(gmailThreads.lastMessageAt))
      .limit(6),

    // Notes du projet (dernières 6)
    conn
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.content,
        kind: notes.kind,
        occurredAt: notes.occurredAt,
        authorName: users.fullName,
      })
      .from(notes)
      .leftJoin(users, eq(notes.authorId, users.id))
      .where(and(eq(notes.subjectType, "project"), eq(notes.subjectId, projectId)))
      .orderBy(desc(notes.occurredAt))
      .limit(6),

    // Tâches créées sur le projet (dernières 6)
    conn
      .select({
        id: tasks.id,
        title: tasks.title,
        createdAt: tasks.createdAt,
      })
      .from(tasks)
      .where(eq(tasks.projectId, projectId))
      .orderBy(desc(tasks.createdAt))
      .limit(6),

    // Transitions de statut sur le projet
    conn
      .select({
        createdAt: auditLog.createdAt,
        diff: auditLog.diff,
      })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.tableName, "projects"),
          eq(auditLog.rowId, projectId),
          eq(auditLog.action, "update"),
          // On ne garde que les lignes où le status apparaît dans le diff.
          isNotNull(sql`(${auditLog.diff}->'after'->>'status')`),
        ),
      )
      .orderBy(desc(auditLog.createdAt))
      .limit(20),
  ]);

  const items: ActivityItem[] = [];

  for (const t of emailRows) {
    if (!t.lastMessageAt) continue;
    items.push({
      kind: "email",
      at: t.lastMessageAt,
      title: t.subject ?? "(sans objet)",
      meta: "Email",
      href: `/emails/${t.id}`,
    });
  }

  for (const n of noteRows) {
    items.push({
      kind: "note",
      at: n.occurredAt,
      title: n.title || n.content.slice(0, 80) || "Note",
      meta: `Note · ${n.authorName ?? "—"}`,
    });
  }

  for (const t of taskRows) {
    items.push({
      kind: "task_created",
      at: t.createdAt,
      title: `Tâche créée · ${t.title}`,
      meta: "Tâches",
      href: `/taches/${t.id}`,
    });
  }

  // Dédup les transitions de statut consécutives — trigger `update` peut
  // écrire plusieurs lignes pour un même changement (revalidation, etc.).
  let previousStatus: string | null = null;
  for (const a of auditRows.slice().reverse()) {
    const diff = a.diff as { after?: { status?: string }; before?: { status?: string } } | null;
    const after = diff?.after?.status;
    if (!after || after === previousStatus) continue;
    previousStatus = after;
    items.push({
      kind: "status_transition",
      at: a.createdAt,
      title: `Statut passé à « ${after} »`,
      meta: "Transition",
    });
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items.slice(0, limit);
}
