"use server";

import { projectSecrets } from "@/db/schema/project-secrets";
import { action } from "@/lib/actions/action";
import { decryptSecret, encryptSecret } from "@/lib/crypto/secrets";
import { db } from "@/lib/db/server";
import {
  createProjectSecretSchema,
  deleteProjectSecretSchema,
  revealProjectSecretSchema,
  updateProjectSecretSchema,
} from "@/lib/schemas/project-secrets";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

function encryptOptional(v: string | undefined): string | null {
  if (v == null) return null;
  if (v.length === 0) return null;
  return encryptSecret(v);
}

export const createProjectSecret = action(createProjectSecretSchema, async ({ input, user }) => {
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
export const updateProjectSecret = action(updateProjectSecretSchema, async ({ input }) => {
  const conn = await db();
  const [existing] = await conn
    .select({ projectId: projectSecrets.projectId })
    .from(projectSecrets)
    .where(eq(projectSecrets.id, input.id))
    .limit(1);
  if (!existing) throw new Error("Secret introuvable.");

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

  revalidatePath(`/projets/${existing.projectId}`);
  return { id: input.id };
});

export const deleteProjectSecret = action(deleteProjectSecretSchema, async ({ input }) => {
  const conn = await db();
  const [row] = await conn
    .select({ projectId: projectSecrets.projectId })
    .from(projectSecrets)
    .where(eq(projectSecrets.id, input.id))
    .limit(1);

  await conn.delete(projectSecrets).where(eq(projectSecrets.id, input.id));
  if (row?.projectId) revalidatePath(`/projets/${row.projectId}`);
  return { id: input.id };
});

/**
 * Déchiffre et renvoie la valeur en clair. Auth garantie par `action()`.
 * Aucun ciphertext n'est envoyé au client : c'est le seul chemin.
 */
export const revealProjectSecret = action(revealProjectSecretSchema, async ({ input }) => {
  const conn = await db();
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
