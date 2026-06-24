"use server";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { emailProposals, gmailMessages, gmailTags, gmailThreadTags } from "@/db/schema/gmail";
import { googleAccounts } from "@/db/schema/google-accounts";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { findContactByEmail } from "@/lib/db/queries/contacts";
import { db } from "@/lib/db/server";
import { applyTagToThread } from "@/lib/gmail/tags";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { and, eq, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

async function getGmailUserId(): Promise<string | null> {
  const conn = await db();
  const rows = await conn
    .select({ id: users.id, scopes: googleAccounts.scopes })
    .from(users)
    .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .where(eq(users.role, "admin"));
  for (const r of rows) {
    if (hasRequiredGmailScopes(r.scopes)) return r.id;
  }
  return null;
}

/**
 * Accepte une proposition LLM. Dispatch selon `kind` :
 *   - task         : crée une tâche
 *   - category_tag : applique le tag catégorie au thread (crée la
 *                    catégorie en base + Gmail label si nouvelle)
 *   - project_link : lie le thread au projet matché (via tag projet)
 */
export const acceptEmailProposal = action(
  z.object({ proposalId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    const [proposal] = await conn
      .select()
      .from(emailProposals)
      .where(eq(emailProposals.id, input.proposalId))
      .limit(1);
    if (!proposal) throw new Error("Proposition introuvable.");
    if (proposal.status !== "pending") throw new Error("Proposition déjà traitée.");

    const [msg] = await conn
      .select({ threadId: gmailMessages.threadId, userId: gmailMessages.userId })
      .from(gmailMessages)
      .where(eq(gmailMessages.id, proposal.messageId))
      .limit(1);
    if (!msg) throw new Error("Message introuvable.");

    const payload = proposal.payload as Record<string, unknown>;
    const targetUserId = (await getGmailUserId()) ?? user.id;
    let createdEntityId: string | null = null;

    if (proposal.kind === "task") {
      const title = String(payload.title ?? "").trim();
      if (!title) throw new Error("Titre de tâche vide.");
      const projectId = (payload.projectId as string | null) ?? null;
      const dueDateRaw = payload.dueDate as string | null;
      const dueDate = dueDateRaw ? new Date(dueDateRaw) : null;
      const priorityIn = payload.priority as "low" | "normal" | "high" | null | undefined;
      // tasks.priority enum = low|medium|high|urgent ; le LLM produit
      // low|normal|high → mapping cohérent avec le pattern meetings.
      const priority: "low" | "medium" | "high" | "urgent" =
        priorityIn === "high" ? "high" : priorityIn === "low" ? "low" : "medium";
      const [inserted] = await conn
        .insert(tasks)
        .values({
          title,
          projectId,
          dueDate:
            dueDate && !Number.isNaN(dueDate.getTime()) ? dueDate.toISOString().slice(0, 10) : null,
          priority,
          createdBy: user.id,
        })
        .returning({ id: tasks.id });
      createdEntityId = inserted?.id ?? null;
    } else if (proposal.kind === "category_tag") {
      // matchedId est toujours set (cf. extract-and-save : on n'accepte
      // pas de catégorie non-existante). Garde-fou si une vieille
      // proposition pré-changement traîne.
      const tagId = proposal.matchedId;
      if (!tagId) {
        throw new Error(
          "Catégorie introuvable. Crée-la d'abord depuis /emails/tags avant de l'appliquer.",
        );
      }
      await applyTagToThread({
        userId: targetUserId,
        threadIdLocal: msg.threadId,
        tagId,
        source: "auto",
        createdBy: user.id,
      });
      createdEntityId = tagId;
    } else if (proposal.kind === "project_link") {
      // Le project_link s'applique en posant le tag projet correspondant
      // sur le thread. Le tag a déjà été créé (auto-tag lors d'un
      // précédent sync), sinon on l'ensure.
      const projectId = proposal.matchedId;
      if (!projectId) throw new Error("Projet matché manquant.");
      // Cherche le tag existant pour ce projet.
      const [existingTag] = await conn
        .select({ id: gmailTags.id })
        .from(gmailTags)
        .where(
          and(
            eq(gmailTags.userId, targetUserId),
            eq(gmailTags.kind, "project"),
            eq(gmailTags.targetId, projectId),
          ),
        )
        .limit(1);
      if (!existingTag) {
        throw new Error(
          "Tag projet pas encore créé. Lance 'Initialiser les tags CRM' depuis /emails/tags.",
        );
      }
      await applyTagToThread({
        userId: targetUserId,
        threadIdLocal: msg.threadId,
        tagId: existingTag.id,
        source: "auto",
        createdBy: user.id,
      });
      createdEntityId = existingTag.id;
    } else if (proposal.kind === "entity") {
      // Find-or-create insensible à la casse — évite les doublons quand
      // plusieurs emails proposent la même société (même règle que côté
      // meetings, cf. createForKind).
      const name = String(payload.name ?? "").trim();
      if (!name) throw new Error("Nom d'entité vide.");
      const [existing] = await conn
        .select({ id: entities.id })
        .from(entities)
        .where(ilike(entities.name, name))
        .limit(1);
      if (existing) {
        createdEntityId = existing.id;
      } else {
        const [row] = await conn
          .insert(entities)
          .values({
            name,
            kind:
              (payload.kind as "client" | "prospect" | "partner" | "supplier" | "other") ??
              "prospect",
            createdBy: user.id,
            ownerId: user.id,
          })
          .returning({ id: entities.id });
        createdEntityId = row?.id ?? null;
      }
    } else if (proposal.kind === "contact") {
      const firstName = String(payload.firstName ?? "").trim();
      const lastName = String(payload.lastName ?? "").trim();
      if (!firstName && !lastName) throw new Error("Nom du contact vide.");
      const email = (payload.email as string | null | undefined)?.trim() || null;

      // Match par email d'abord (preuve d'identité forte sur emails),
      // fuzzy nom seulement en fallback. Pas de fuzzy ici — `matchedId`
      // du LLM a déjà cette info ; on s'en sert juste pour link-existing.
      let foundId: string | null = null;
      if (email) {
        const exact = await findContactByEmail(email);
        if (exact) foundId = exact.id;
      }

      if (foundId) {
        createdEntityId = foundId;
      } else {
        // Résolution de l'entité par nom (find-only — pas de création
        // implicite d'entité ici, on laisse l'utilisateur valider la
        // proposition entité séparée s'il le souhaite).
        const entityName = (payload.entityName as string | null | undefined)?.trim() || null;
        let entityId: string | null = null;
        if (entityName) {
          const [matched] = await conn
            .select({ id: entities.id })
            .from(entities)
            .where(ilike(entities.name, entityName))
            .limit(1);
          entityId = matched?.id ?? null;
        }
        const [row] = await conn
          .insert(contacts)
          .values({
            firstName,
            lastName,
            email,
            jobTitle: (payload.jobTitle as string | null) ?? null,
            entityId,
            createdBy: user.id,
            ownerId: user.id,
          })
          .returning({ id: contacts.id });
        createdEntityId = row?.id ?? null;
      }
    } else if (proposal.kind === "project") {
      const name = String(payload.name ?? "").trim();
      if (!name) throw new Error("Nom du projet vide.");

      // Find-or-create. Le LLM est consigné de ne pas re-proposer les
      // projets connus, mais en défense en profondeur on dédoublonne.
      const [existing] = await conn
        .select({ id: projects.id })
        .from(projects)
        .where(ilike(projects.name, name))
        .limit(1);
      if (existing) {
        createdEntityId = existing.id;
      } else {
        const entityName = (payload.entityName as string | null | undefined)?.trim() || null;
        let entityId: string | null = null;
        if (entityName) {
          const [matched] = await conn
            .select({ id: entities.id })
            .from(entities)
            .where(ilike(entities.name, entityName))
            .limit(1);
          entityId = matched?.id ?? null;
        }
        const rawStatus = payload.status as string | null | undefined;
        const allowedStatuses = [
          "not_started",
          "to_follow_up",
          "awaiting_response",
          "won",
          "lost",
          "planning",
          "active",
          "on_hold",
          "completed",
          "archived",
        ] as const;
        const status: (typeof allowedStatuses)[number] =
          rawStatus && (allowedStatuses as readonly string[]).includes(rawStatus)
            ? (rawStatus as (typeof allowedStatuses)[number])
            : "not_started";
        const valueAmount = payload.valueAmount as number | null | undefined;
        const [row] = await conn
          .insert(projects)
          .values({
            name,
            kind: (payload.kind as "client" | "product" | "transverse") ?? "client",
            status,
            entityId,
            valueAmount: valueAmount != null ? valueAmount.toString() : null,
            createdBy: user.id,
            ownerId: user.id,
          })
          .returning({ id: projects.id });
        createdEntityId = row?.id ?? null;
      }
    }

    await conn
      .update(emailProposals)
      .set({
        status: "accepted",
        decidedBy: user.id,
        decidedAt: new Date(),
        createdEntityId,
      })
      .where(eq(emailProposals.id, proposal.id));

    revalidatePath("/emails/propositions");
    revalidatePath(`/emails/${msg.threadId}`);
    revalidatePath("/taches");
    revalidatePath("/contacts");
    revalidatePath("/entites");
    revalidatePath("/projets");
    return { ok: true as const, kind: proposal.kind, createdEntityId };
  },
);

export const rejectEmailProposal = action(
  z.object({ proposalId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    await conn
      .update(emailProposals)
      .set({ status: "rejected", decidedBy: user.id, decidedAt: new Date() })
      .where(eq(emailProposals.id, input.proposalId));
    revalidatePath("/emails/propositions");
    return { ok: true as const };
  },
);

/** Lance manuellement l'extraction sur un message spécifique. */
export const reExtractMessage = action(
  z.object({ messageId: z.string().uuid() }),
  async ({ input }) => {
    const { extractAndSaveEmailProposals } = await import("@/lib/gmail/extract-and-save");
    const r = await extractAndSaveEmailProposals(input.messageId);
    revalidatePath("/emails/propositions");
    return r;
  },
);

/** Force le passage d'un message à 'pending' pour qu'il soit re-extrait
 *  au prochain sync. Utile si on a ajusté les catégories existantes. */
export const requeueExtraction = action(
  z.object({ messageId: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(gmailMessages)
      .set({ extractionStatus: "pending" })
      .where(eq(gmailMessages.id, input.messageId));
    revalidatePath("/emails/propositions");
    return { ok: true as const };
  },
);

// Garde-fou imports inutilisés.
void gmailThreadTags;
