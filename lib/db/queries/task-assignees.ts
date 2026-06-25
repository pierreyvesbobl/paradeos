import { eq, inArray } from "drizzle-orm";
import type { Database } from "../../../db/client";
import { contacts } from "../../../db/schema/contacts";
import { entities } from "../../../db/schema/entities";
import { taskAssignees } from "../../../db/schema/task-assignees";
import { users } from "../../../db/schema/users";

export type AssigneeRef = { kind: "user" | "contact"; id: string };

export type FetchedAssignee =
  | { kind: "user"; id: string; fullName: string | null; avatarUrl: string | null }
  | { kind: "contact"; id: string; fullName: string; entityName: string | null };

/**
 * Type accepté par les helpers : connexion top-level OU transaction Drizzle.
 * Les transactions n'exposent pas `$client` mais ont la même API insert /
 * delete / select.
 */
type DbOrTx = Pick<Database, "insert" | "delete" | "select">;

/**
 * Remplace les assignés d'une tâche : DELETE puis INSERT en batch. À
 * appeler à l'intérieur d'une transaction Drizzle pour garder l'atomicité
 * write task + sync assignees.
 */
export async function setTaskAssignees(
  tx: DbOrTx,
  taskId: string,
  next: AssigneeRef[],
  createdBy: string | null,
): Promise<void> {
  await tx.delete(taskAssignees).where(eq(taskAssignees.taskId, taskId));
  if (next.length === 0) return;
  // Dédup côté app : la PK est synthétique mais les index uniques partiels
  // refuseraient des doublons (task,user) ou (task,contact).
  const seen = new Set<string>();
  const rows = next
    .filter((a) => {
      const key = `${a.kind}:${a.id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((a) => ({
      taskId,
      kind: a.kind,
      userId: a.kind === "user" ? a.id : null,
      contactId: a.kind === "contact" ? a.id : null,
      createdBy,
    }));
  if (rows.length === 0) return;
  await tx.insert(taskAssignees).values(rows);
}

/**
 * Hydrate les assignés pour une liste de tâches en 1 requête. Retourne une
 * map id-tâche → liste d'assignés (peut être vide). Préserve l'ordre
 * d'insertion en DB (created_at puis kind).
 */
export async function fetchAssigneesForTasks(
  conn: Database,
  taskIds: string[],
): Promise<Map<string, FetchedAssignee[]>> {
  const out = new Map<string, FetchedAssignee[]>();
  if (taskIds.length === 0) return out;
  const rows = await conn
    .select({
      taskId: taskAssignees.taskId,
      kind: taskAssignees.kind,
      createdAt: taskAssignees.createdAt,
      userId: taskAssignees.userId,
      userName: users.fullName,
      userAvatarUrl: users.avatarUrl,
      contactId: taskAssignees.contactId,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactEntityName: entities.name,
    })
    .from(taskAssignees)
    .leftJoin(users, eq(taskAssignees.userId, users.id))
    .leftJoin(contacts, eq(taskAssignees.contactId, contacts.id))
    .leftJoin(entities, eq(contacts.entityId, entities.id))
    .where(inArray(taskAssignees.taskId, taskIds));

  for (const r of rows) {
    const list = out.get(r.taskId) ?? [];
    if (r.kind === "user" && r.userId) {
      list.push({
        kind: "user",
        id: r.userId,
        fullName: r.userName,
        avatarUrl: r.userAvatarUrl,
      });
    } else if (r.kind === "contact" && r.contactId) {
      list.push({
        kind: "contact",
        id: r.contactId,
        fullName: `${r.contactFirstName ?? ""} ${r.contactLastName ?? ""}`.trim(),
        entityName: r.contactEntityName ?? null,
      });
    }
    out.set(r.taskId, list);
  }
  // Tri stable : users avant contacts, alphabétique
  for (const [k, list] of out) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "user" ? -1 : 1;
      return (a.fullName ?? "").localeCompare(b.fullName ?? "");
    });
    out.set(k, list);
  }
  return out;
}
