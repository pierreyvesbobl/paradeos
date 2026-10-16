"use server";

import { asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { action } from "@/lib/actions/action";
import { completeBillingIdentity } from "@/lib/billing/billing-identity";
import { assertEntityIsNew } from "@/lib/crm/assert-new";
import { findExistingEntityId } from "@/lib/crm/find-or-link";
import { db } from "@/lib/db/server";
import {
  createEntitySchema,
  deleteEntitySchema,
  patchEntitySchema,
  quickCreateEntitySchema,
  updateEntitySchema,
} from "@/lib/schemas/entities";

/**
 * SIRET et numéro de TVA déduits du SIREN quand la saisie les omet : une
 * fiche avec SIREN seul produirait des factures incomplètes. Les valeurs
 * saisies restent prioritaires.
 */
async function withDerivedIdentity<
  T extends {
    siren?: string | null;
    siret?: string | null;
    vatNumber?: string | null;
    address?: { country?: string | null } | null;
  },
>(input: T): Promise<T & { siret: string | null; vatNumber: string | null }> {
  const { siret, vatNumber } = await completeBillingIdentity({
    siren: input.siren ?? null,
    siret: input.siret ?? null,
    vatNumber: input.vatNumber ?? null,
    country: input.address?.country ?? null,
  });
  return { ...input, siret, vatNumber };
}

export const createEntity = action(createEntitySchema, async ({ input: raw, user }) => {
  const conn = await db();
  // Refus si la fiche existe déjà : la saisie est intentionnelle, c'est à
  // l'humain de trancher (cf. `lib/crm/assert-new.ts`).
  await assertEntityIsNew(raw.name);
  const input = await withDerivedIdentity(raw);
  const [row] = await conn
    .insert(entities)
    .values({
      name: input.name,
      kind: input.kind,
      website: input.website ?? null,
      siren: input.siren ?? null,
      siret: input.siret ?? null,
      legalName: input.legalName ?? null,
      vatNumber: input.vatNumber ?? null,
      address: input.address ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      notes: input.notes ?? null,
      ownerId: input.ownerId ?? user.id,
      createdBy: user.id,
    })
    .returning({ id: entities.id });

  revalidatePath("/crm/entites");
  return { id: row?.id };
});

export const updateEntity = action(updateEntitySchema, async ({ input: raw }) => {
  const conn = await db();
  const input = await withDerivedIdentity(raw);
  await conn
    .update(entities)
    .set({
      name: input.name,
      kind: input.kind,
      website: input.website ?? null,
      siren: input.siren ?? null,
      siret: input.siret ?? null,
      legalName: input.legalName ?? null,
      vatNumber: input.vatNumber ?? null,
      address: input.address ?? null,
      deliveryAddress: input.deliveryAddress ?? null,
      notes: input.notes ?? null,
      ownerId: input.ownerId ?? null,
    })
    .where(eq(entities.id, input.id));

  revalidatePath("/crm/entites");
  revalidatePath(`/entites/${input.id}`);
  return { id: input.id };
});

/**
 * Création rapide depuis un picker FK (Notion-like). Crée une entité
 * avec juste un nom (kind=prospect par défaut), retourne id + nom.
 */
export const quickCreateEntity = action(quickCreateEntitySchema, async ({ input, user }) => {
  const conn = await db();
  // Find-or-create : le picker attend un id en retour, donc on réutilise la
  // fiche existante au lieu de refuser (contrairement au formulaire
  // complet). Le matcher normalise le nom, donc « mkpdoctor » retrouve
  // « MKP Doctor » — et un double-clic sur le picker n'insère plus deux fois.
  const existingId = await findExistingEntityId(input.name);
  if (existingId) {
    const [existing] = await conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .where(eq(entities.id, existingId))
      .limit(1);
    if (existing) return { id: existing.id, name: existing.name };
  }
  const [row] = await conn
    .insert(entities)
    .values({
      name: input.name,
      kind: "prospect",
      ownerId: user.id,
      createdBy: user.id,
    })
    .returning({ id: entities.id, name: entities.name });
  if (!row) throw new Error("Création échouée.");
  revalidatePath("/crm/entites");
  return { id: row.id, name: row.name };
});

export const patchEntity = action(patchEntitySchema, async ({ input }) => {
  const conn = await db();
  const { id, ...rest } = input;
  const updates = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== undefined),
  ) as Record<string, unknown>;
  if (Object.keys(updates).length === 0) return { id };
  // Un SIREN posé en ligne entraîne SIRET et TVA avec lui ; on relit la fiche
  // pour ne pas écraser ce qui y est déjà.
  if (typeof updates.siren === "string" && updates.siren) {
    const [current] = await conn
      .select({ siret: entities.siret, vatNumber: entities.vatNumber, address: entities.address })
      .from(entities)
      .where(eq(entities.id, id))
      .limit(1);
    const derived = await withDerivedIdentity({
      siren: updates.siren,
      siret: (updates.siret as string | null | undefined) ?? current?.siret ?? null,
      vatNumber: (updates.vatNumber as string | null | undefined) ?? current?.vatNumber ?? null,
      address:
        (updates.address as { country?: string | null } | null | undefined) ?? current?.address,
    });
    updates.siret = derived.siret;
    updates.vatNumber = derived.vatNumber;
  }
  await conn.update(entities).set(updates).where(eq(entities.id, id));
  revalidatePath("/crm/entites");
  revalidatePath(`/entites/${id}`);
  return { id };
});

const deleteEntity = action(deleteEntitySchema, async ({ input }) => {
  const conn = await db();
  await conn.delete(entities).where(eq(entities.id, input.id));
  revalidatePath("/crm/entites");
  return { id: input.id };
});

/**
 * Lecture compacte pour la modale d'aperçu — informations clé + contacts
 * rattachés (3 max pour rester compact). Charge à la demande à l'ouverture
 * du modal.
 */
export const getEntityPreview = action(
  z.object({ id: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    const [entity] = await conn
      .select({
        id: entities.id,
        name: entities.name,
        kind: entities.kind,
        website: entities.website,
        siren: entities.siren,
        vatNumber: entities.vatNumber,
        address: entities.address,
        notes: entities.notes,
      })
      .from(entities)
      .where(eq(entities.id, input.id))
      .limit(1);
    if (!entity) throw new Error("Entité introuvable.");

    const [{ count: contactsCount } = { count: 0 }] = await conn
      .select({ count: sql<number>`count(*)::int` })
      .from(contacts)
      .where(eq(contacts.entityId, input.id));

    const previewContacts = await conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        jobTitle: contacts.jobTitle,
      })
      .from(contacts)
      .where(eq(contacts.entityId, input.id))
      .orderBy(asc(contacts.lastName), asc(contacts.firstName))
      .limit(5);

    return { entity, contactsCount, previewContacts };
  },
  { allowViewer: true },
);

export async function deleteEntityAndRedirect(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("id manquant");
  const result = await deleteEntity({ id });
  if (!result.ok) throw new Error(result.message);
  redirect("/entites");
}
