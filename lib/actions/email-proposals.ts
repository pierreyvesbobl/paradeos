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
import { type AssigneeRef, setTaskAssignees } from "@/lib/db/queries/task-assignees";
import { db } from "@/lib/db/server";
import { applyTagToThread } from "@/lib/gmail/tags";
import { getValidAccessToken } from "@/lib/google/account";
import { createGmailDraft, getMessage, getHeader } from "@/lib/google/gmail-api";
import { hasGmailComposeScope, hasRequiredGmailScopes } from "@/lib/google/oauth";
import { and, eq, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

/**
 * Extrait la liste d'assignés d'un payload de proposition task. Supporte :
 *   - le format multi (`assignees: [{ kind, id }]`) — nouveau, produit
 *     par le panneau d'édition inline sur `/emails/[threadId]`.
 *   - le format mono legacy (`assigneeId` | `assigneeContactId`) — produit
 *     par l'extraction LLM initiale.
 */
function readAssigneesFromPayload(payload: Record<string, unknown>): AssigneeRef[] {
  const raw = payload.assignees;
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (a): a is { kind: "user" | "contact"; id: string } =>
          !!a &&
          typeof a === "object" &&
          (a as Record<string, unknown>).kind !== undefined &&
          typeof (a as Record<string, unknown>).id === "string",
      )
      .map((a) => ({ kind: a.kind, id: a.id }));
  }
  const assigneeId = (payload.assigneeId as string | null | undefined) ?? null;
  const assigneeContactId = (payload.assigneeContactId as string | null | undefined) ?? null;
  if (assigneeContactId) return [{ kind: "contact", id: assigneeContactId }];
  if (assigneeId) return [{ kind: "user", id: assigneeId }];
  return [];
}

async function resolveEntityByName(name: string | null | undefined): Promise<string | null> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  const conn = await db();
  const [matched] = await conn
    .select({ id: entities.id })
    .from(entities)
    .where(ilike(entities.name, trimmed))
    .limit(1);
  return matched?.id ?? null;
}

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
  z.object({
    proposalId: z.string().uuid(),
    /**
     * Édition user du payload avant acceptation. Merge sur `proposal.payload`.
     * Clé spéciale `_linkExistingId` : quand présente, on lie la proposition
     * au record existant dont c'est l'id (au lieu de créer un nouveau record).
     * Utile pour contact/entity/project/task ; ignorée pour draft_reply /
     * category_tag / project_link qui utilisent déjà `matchedId`.
     */
    payloadOverride: z.record(z.string(), z.unknown()).nullish(),
  }),
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
      .select({
        threadId: gmailMessages.threadId,
        userId: gmailMessages.userId,
        gmailMessageId: gmailMessages.gmailMessageId,
      })
      .from(gmailMessages)
      .where(eq(gmailMessages.id, proposal.messageId))
      .limit(1);
    if (!msg) throw new Error("Message introuvable.");

    // Merge payload initial + override user. `_linkExistingId` est extrait
    // à part et n'est pas persisté en base — c'est un marqueur transitoire
    // qui signifie « lie ce match au lieu de créer ».
    const rawMerged = {
      ...(proposal.payload as Record<string, unknown>),
      ...(input.payloadOverride ?? {}),
    };
    const linkExistingId =
      typeof rawMerged._linkExistingId === "string" && rawMerged._linkExistingId.length > 0
        ? rawMerged._linkExistingId
        : null;
    const { _linkExistingId: _omit, ...payload } = rawMerged;
    void _omit;

    const targetUserId = (await getGmailUserId()) ?? user.id;
    let createdEntityId: string | null = null;

    if (proposal.kind === "task") {
      if (linkExistingId) {
        createdEntityId = linkExistingId;
      } else {
        const title = String(payload.title ?? "").trim();
        if (!title) throw new Error("Titre de tâche vide.");
        const projectId = (payload.projectId as string | null) ?? null;
        const dueDateRaw = payload.dueDate as string | null;
        const dueDate = dueDateRaw ? new Date(dueDateRaw) : null;
        const priorityIn = payload.priority as "low" | "normal" | "high" | null | undefined;
        const priority: "low" | "medium" | "high" | "urgent" =
          priorityIn === "high" ? "high" : priorityIn === "low" ? "low" : "medium";
        const assignees = readAssigneesFromPayload(payload);
        createdEntityId = await conn.transaction(async (tx) => {
          const [inserted] = await tx
            .insert(tasks)
            .values({
              title,
              projectId,
              dueDate:
                dueDate && !Number.isNaN(dueDate.getTime())
                  ? dueDate.toISOString().slice(0, 10)
                  : null,
              priority,
              assigneeId: null,
              assigneeContactId: null,
              createdBy: user.id,
            })
            .returning({ id: tasks.id });
          if (!inserted) throw new Error("Échec création tâche.");
          await setTaskAssignees(tx, inserted.id, assignees, user.id);
          return inserted.id;
        });
      }
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
      if (linkExistingId) {
        createdEntityId = linkExistingId;
      } else {
        const name = String(payload.name ?? "").trim();
        if (!name) throw new Error("Nom d'entité vide.");
        // Find-or-create case-insensitive : dédoublonnage défensif si le
        // user tape un nom déjà existant.
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
      }
    } else if (proposal.kind === "contact") {
      if (linkExistingId) {
        createdEntityId = linkExistingId;
      } else {
        const firstName = String(payload.firstName ?? "").trim();
        const lastName = String(payload.lastName ?? "").trim();
        if (!firstName && !lastName) throw new Error("Nom du contact vide.");
        const email = (payload.email as string | null | undefined)?.trim() || null;

        // Match par email d'abord (preuve d'identité forte).
        let foundId: string | null = null;
        if (email) {
          const exact = await findContactByEmail(email);
          if (exact) foundId = exact.id;
        }

        if (foundId) {
          createdEntityId = foundId;
        } else {
          const entityId =
            (payload.entityId as string | null | undefined) ??
            (await resolveEntityByName((payload.entityName as string | null | undefined) ?? null));
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
      }
    } else if (proposal.kind === "draft_reply") {
      // Vérifie le scope avant de partir en API : erreur claire côté UI
      // au lieu d'un 403 opaque de Gmail.
      const [account] = await conn
        .select({ scopes: googleAccounts.scopes })
        .from(googleAccounts)
        .where(eq(googleAccounts.userId, targetUserId))
        .limit(1);
      if (!account || !hasGmailComposeScope(account.scopes)) {
        throw new Error(
          "Scope Gmail 'compose' manquant. Reconnecte Gmail depuis /settings/integrations pour activer les brouillons.",
        );
      }
      const accessToken = await getValidAccessToken(targetUserId);
      if (!accessToken) throw new Error("Compte Google non connecté.");

      const subject = String(payload.subject ?? "").trim();
      const body = String(payload.body ?? "").trim();
      if (!subject || !body) throw new Error("Sujet ou corps du brouillon vide.");

      // On récupère le message d'origine pour deux choses : (1) l'email
      // du destinataire de la réponse (= expéditeur du message d'origine,
      // avec fallback sur Reply-To), (2) le header Message-ID pour un
      // threading propre côté clients tiers.
      const sourceMessage = await getMessage(accessToken, msg.gmailMessageId, "metadata");
      const replyTo =
        getHeader(sourceMessage.payload, "Reply-To") ?? getHeader(sourceMessage.payload, "From");
      const inReplyToHeader = getHeader(sourceMessage.payload, "Message-ID");
      if (!replyTo) throw new Error("Impossible de déterminer le destinataire de la réponse.");

      // Extraction juste l'adresse email si le header est "Name <email>".
      const emailMatch = replyTo.match(/<([^>]+)>/);
      const toEmail = (emailMatch?.[1] ?? replyTo).trim();

      const draft = await createGmailDraft(accessToken, {
        to: toEmail,
        subject: subject.startsWith("Re:") ? subject : `Re: ${subject}`,
        body,
        gmailThreadId: (payload.gmailThreadId as string | null) ?? null,
        inReplyToHeader,
      });
      createdEntityId = draft.id;
    } else if (proposal.kind === "project") {
      if (linkExistingId) {
        createdEntityId = linkExistingId;
      } else {
        const name = String(payload.name ?? "").trim();
        if (!name) throw new Error("Nom du projet vide.");

        // Find-or-create : dédoublonnage défensif si le user tape un nom
        // qui matche déjà.
        const [existing] = await conn
          .select({ id: projects.id })
          .from(projects)
          .where(ilike(projects.name, name))
          .limit(1);
        if (existing) {
          createdEntityId = existing.id;
        } else {
          const entityId =
            (payload.entityId as string | null | undefined) ??
            (await resolveEntityByName((payload.entityName as string | null | undefined) ?? null));
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

/**
 * Met à jour le record lié à une proposition déjà acceptée. Permet de
 * corriger après coup (mauvais titre, mauvaise entité rattachée, etc.)
 * sans passer par un revert + re-accept (qui créerait un doublon).
 *
 * `payload` remplace/complète les champs existants ; l'update sur le
 * record CRM sous-jacent reste minimaliste (title/priority pour task,
 * name/kind pour entity, etc.) — voir applyUpdateForKind.
 */
export const updateAcceptedEmailProposal = action(
  z.object({
    proposalId: z.string().uuid(),
    payload: z.record(z.string(), z.unknown()),
  }),
  async ({ input }) => {
    const conn = await db();
    const [proposal] = await conn
      .select()
      .from(emailProposals)
      .where(eq(emailProposals.id, input.proposalId))
      .limit(1);
    if (!proposal) throw new Error("Proposition introuvable.");
    if (proposal.status !== "accepted") {
      throw new Error("Seules les propositions acceptées peuvent être éditées ici.");
    }
    if (!proposal.createdEntityId) {
      throw new Error("Aucun record lié à mettre à jour.");
    }

    const { _linkExistingId: _omitOld, ...prev } = proposal.payload as Record<string, unknown>;
    const { _linkExistingId: _omitNew, ...next } = input.payload;
    void _omitOld;
    void _omitNew;
    const merged = { ...prev, ...next };

    // Update le record côté CRM selon le kind. Chaque kind a un set de
    // champs éditables restreint (celui qu'on affiche dans l'éditeur du
    // panneau UI).
    if (proposal.kind === "task") {
      const title = String(merged.title ?? "").trim();
      const priorityIn = merged.priority as "low" | "normal" | "high" | null | undefined;
      const priority: "low" | "medium" | "high" | "urgent" =
        priorityIn === "high" ? "high" : priorityIn === "low" ? "low" : "medium";
      const dueDateRaw = merged.dueDate as string | null | undefined;
      const dueDate = dueDateRaw ? new Date(dueDateRaw) : null;
      const assignees = readAssigneesFromPayload(merged);
      const taskId = proposal.createdEntityId;
      await conn.transaction(async (tx) => {
        await tx
          .update(tasks)
          .set({
            ...(title ? { title } : {}),
            priority,
            projectId: (merged.projectId as string | null | undefined) ?? null,
            // Legacy cols kept NULL — source of truth = task_assignees.
            assigneeId: null,
            assigneeContactId: null,
            dueDate:
              dueDate && !Number.isNaN(dueDate.getTime())
                ? dueDate.toISOString().slice(0, 10)
                : null,
          })
          .where(eq(tasks.id, taskId));
        await setTaskAssignees(tx, taskId, assignees, proposal.decidedBy);
      });
    } else if (proposal.kind === "entity") {
      const name = String(merged.name ?? "").trim();
      const kind =
        (merged.kind as "client" | "prospect" | "partner" | "supplier" | "other" | undefined) ??
        undefined;
      await conn
        .update(entities)
        .set({
          ...(name ? { name } : {}),
          ...(kind ? { kind } : {}),
        })
        .where(eq(entities.id, proposal.createdEntityId));
    } else if (proposal.kind === "contact") {
      const firstName = String(merged.firstName ?? "").trim();
      const lastName = String(merged.lastName ?? "").trim();
      const email = (merged.email as string | null | undefined)?.trim() || null;
      const entityId =
        (merged.entityId as string | null | undefined) ??
        (await resolveEntityByName((merged.entityName as string | null | undefined) ?? null));
      await conn
        .update(contacts)
        .set({
          ...(firstName ? { firstName } : {}),
          ...(lastName ? { lastName } : {}),
          email,
          jobTitle: (merged.jobTitle as string | null | undefined) ?? null,
          entityId,
        })
        .where(eq(contacts.id, proposal.createdEntityId));
    } else if (proposal.kind === "project") {
      const name = String(merged.name ?? "").trim();
      const entityId =
        (merged.entityId as string | null | undefined) ??
        (await resolveEntityByName((merged.entityName as string | null | undefined) ?? null));
      const valueAmount = merged.valueAmount as number | null | undefined;
      await conn
        .update(projects)
        .set({
          ...(name ? { name } : {}),
          entityId,
          valueAmount: valueAmount != null ? valueAmount.toString() : null,
        })
        .where(eq(projects.id, proposal.createdEntityId));
    }

    await conn
      .update(emailProposals)
      .set({ payload: merged })
      .where(eq(emailProposals.id, proposal.id));

    const [msg] = await conn
      .select({ threadId: gmailMessages.threadId })
      .from(gmailMessages)
      .where(eq(gmailMessages.id, proposal.messageId))
      .limit(1);
    if (msg) revalidatePath(`/emails/${msg.threadId}`);
    revalidatePath("/emails/propositions");
    revalidatePath("/taches");
    revalidatePath("/contacts");
    revalidatePath("/entites");
    revalidatePath("/projets");
    return { ok: true as const };
  },
);

/**
 * Remet une proposition décidée en `pending`. Ne supprime PAS les
 * records créés côté CRM (contact, entité, projet…) — l'utilisateur les
 * supprime manuellement s'il le veut. Pour draft_reply, le brouillon
 * Gmail est laissé en place (Gmail garde son propre historique).
 */
export const revertEmailProposal = action(
  z.object({ proposalId: z.string().uuid() }),
  async ({ input }) => {
    const conn = await db();
    await conn
      .update(emailProposals)
      .set({ status: "pending", decidedAt: null, decidedBy: null })
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
