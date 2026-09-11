import "server-only";

import { projectMembers } from "@/db/schema/project-members";
import { getUserRole } from "@/lib/auth/admin";
import { db } from "@/lib/db/server";
import { and, eq } from "drizzle-orm";

/**
 * Accès aux données sensibles d'un projet (secrets, identifiants
 * clients) : administrateur, ou membre déclaré du projet. Les `viewer`
 * n'y ont jamais accès. Le reste du projet (tâches, notes, facturation)
 * reste partagé entre tous les membres de l'équipe.
 */
export async function requireProjectSensitiveAccess(
  userId: string,
  projectId: string,
): Promise<void> {
  const role = await getUserRole(userId);
  if (role === "viewer") throw new Error("Compte en lecture seule.");
  if (role === "admin") return;

  const conn = await db();
  const [member] = await conn
    .select({ userId: projectMembers.userId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
    .limit(1);
  if (!member) {
    throw new Error(
      "Secrets réservés aux membres du projet. Demande à un administrateur de t'ajouter.",
    );
  }
}
