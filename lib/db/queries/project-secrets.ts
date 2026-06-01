import "server-only";

import { projectSecrets } from "@/db/schema/project-secrets";
import { db } from "@/lib/db/server";
import { asc, eq, isNotNull } from "drizzle-orm";

export type ProjectSecretListItem = {
  id: string;
  label: string;
  url: string | null;
  hasUsername: boolean;
  hasNotes: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/**
 * Liste les secrets d'un projet — métadonnées uniquement, AUCUN
 * ciphertext renvoyé au client. La révélation passe obligatoirement
 * par la Server Action `revealProjectSecret`.
 */
export async function getProjectSecretsList(projectId: string): Promise<ProjectSecretListItem[]> {
  const conn = await db();
  const rows = await conn
    .select({
      id: projectSecrets.id,
      label: projectSecrets.label,
      url: projectSecrets.url,
      hasUsername: isNotNull(projectSecrets.usernameEnc),
      hasNotes: isNotNull(projectSecrets.notesEnc),
      createdAt: projectSecrets.createdAt,
      updatedAt: projectSecrets.updatedAt,
    })
    .from(projectSecrets)
    .where(eq(projectSecrets.projectId, projectId))
    .orderBy(asc(projectSecrets.label));

  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    url: r.url,
    hasUsername: Boolean(r.hasUsername),
    hasNotes: Boolean(r.hasNotes),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}
