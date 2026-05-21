"use server";

import { emailProposals, gmailMessages, gmailTags, gmailThreadTags } from "@/db/schema/gmail";
import { googleAccounts } from "@/db/schema/google-accounts";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import { applyTagToThread, createCategoryTag } from "@/lib/gmail/tags";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { and, eq } from "drizzle-orm";
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
      const name = String(payload.name ?? "").trim();
      if (!name) throw new Error("Nom de catégorie vide.");
      let tagId = proposal.matchedId;
      if (!tagId) {
        // Crée la catégorie si elle n'existe pas encore (proposition LLM
        // d'une nouvelle catégorie).
        const tag = await createCategoryTag({ userId: targetUserId, name });
        tagId = tag.id;
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
