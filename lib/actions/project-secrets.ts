"use server";

import { projectSecrets } from "@/db/schema/project-secrets";
import { action } from "@/lib/actions/action";
import { requireProjectSensitiveAccess } from "@/lib/auth/project-access";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { db } from "@/lib/db/server";
import {
  createProjectSecretSchema,
  deleteProjectSecretSchema,
  revealProjectSecretSchema,
  updateProjectSecretSchema,
} from "@/lib/schemas/project-secrets";
import { eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

function encryptOptional(v: string | undefined): string | null {
  if (v == null) return null;
  if (v.length === 0) return null;
  return encryptSecret(v);
}

/**
 * Contrôle d'accès commun : admin ou membre déclaré du projet
 * (`project_members`), jamais un viewer. Cf. `lib/auth/project-access.ts`.
 */
async function requireAccessToSecret(secretId: string, userId: string): Promise<string> {
  const conn = await db();
  const [row] = await conn
    .select({ projectId: projectSecrets.projectId })
    .from(projectSecrets)
    .where(eq(projectSecrets.id, secretId))
    .limit(1);
  if (!row) throw new Error("Secret introuvable.");
  await requireProjectSensitiveAccess(userId, row.projectId);
  return row.projectId;
}

export const createProjectSecret = action(createProjectSecretSchema, async ({ input, user }) => {
  await requireProjectSensitiveAccess(user.id, input.projectId);
  const conn = await db();
  const [row] = await conn
    .insert(projectSecrets)
    .values({
      projectId: input.projectId,
      label: input.label,
      url: input.url ?? null,
      usernameEnc: encryptOptional(input.username),
      valueEnc: encryptSecret(input.value),
      notesEnc: encryptOptional(input.notes),
      createdBy: user.id,
    })
    .returning({ id: projectSecrets.id });

  revalidatePath(`/projets/${input.projectId}`);
  return { id: row?.id };
});

/**
 * `value`/`username`/`notes` à `undefined` → champ inchangé.
 * Chaîne vide → champ effacé (mis à NULL).
 * Pour `value` (NOT NULL en base), chaîne vide est traitée comme inchangée.
 */
export const updateProjectSecret = action(updateProjectSecretSchema, async ({ input, user }) => {
  const projectId = await requireAccessToSecret(input.id, user.id);
  const conn = await db();

  const patch: Record<string, unknown> = {
    label: input.label,
    url: input.url ?? null,
    updatedAt: new Date(),
  };
  if (input.value !== undefined && input.value.length > 0) {
    patch.valueEnc = encryptSecret(input.value);
  }
  if (input.username !== undefined) {
    patch.usernameEnc = input.username.length > 0 ? encryptSecret(input.username) : null;
  }
  if (input.notes !== undefined) {
    patch.notesEnc = input.notes.length > 0 ? encryptSecret(input.notes) : null;
  }

  await conn.update(projectSecrets).set(patch).where(eq(projectSecrets.id, input.id));

  revalidatePath(`/projets/${projectId}`);
  return { id: input.id };
});

export const deleteProjectSecret = action(deleteProjectSecretSchema, async ({ input, user }) => {
  const projectId = await requireAccessToSecret(input.id, user.id);
  const conn = await db();
  await conn.delete(projectSecrets).where(eq(projectSecrets.id, input.id));
  revalidatePath(`/projets/${projectId}`);
  return { id: input.id };
});

/**
 * Déchiffre et renvoie la valeur en clair. Réservé aux admins et aux
 * membres du projet ; chaque consultation est tracée sur la ligne
 * (compteur + dernier lecteur). Aucun ciphertext n'est envoyé au client.
 */
export const revealProjectSecret = action(revealProjectSecretSchema, async ({ input, user }) => {
  await requireAccessToSecret(input.id, user.id);
  const conn = await db();
  await conn
    .update(projectSecrets)
    .set({
      revealCount: sql`${projectSecrets.revealCount} + 1`,
      lastRevealedAt: new Date(),
      lastRevealedBy: user.id,
    })
    .where(eq(projectSecrets.id, input.id));
  const [row] = await conn
    .select({
      valueEnc: projectSecrets.valueEnc,
      usernameEnc: projectSecrets.usernameEnc,
      notesEnc: projectSecrets.notesEnc,
    })
    .from(projectSecrets)
    .where(eq(projectSecrets.id, input.id))
    .limit(1);
  if (!row) throw new Error("Secret introuvable.");

  return {
    value: decryptSecret(row.valueEnc),
    username: row.usernameEnc ? decryptSecret(row.usernameEnc) : null,
    notes: row.notesEnc ? decryptSecret(row.notesEnc) : null,
  };
});
