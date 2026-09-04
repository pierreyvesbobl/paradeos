"use server";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { emailProposals, gmailMessages } from "@/db/schema/gmail";
import { googleAccounts } from "@/db/schema/google-accounts";
import { projectContacts } from "@/db/schema/project-contacts";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { findContactByEmail } from "@/lib/db/queries/contacts";
import { type AssigneeRef, setTaskAssignees } from "@/lib/db/queries/task-assignees";
import { db } from "@/lib/db/server";
import {
  clearThreadLinkDecisions,
  dismissThreadLinksOfKind,
  ensureCrmLabel,
  linkThread,
} from "@/lib/gmail/links";
import { getValidAccessToken } from "@/lib/google/account";
import { createGmailDraft, getHeader, getMessage } from "@/lib/google/gmail-api";
import { hasGmailComposeScope, hasRequiredGmailScopes } from "@/lib/google/oauth";
import { eq, ilike, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { sanitizeNameInput } from "@/lib/format";
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
 *   - task                 : crée une tâche
 *   - project_link         : lie le thread au projet retenu
 *   - entity_link          : lie le thread à l'entité retenue
 *   - project_contact_link : rattache le contact au projet
 *   - contact/entity/project : crée (ou relie) le record CRM
 *   - draft_reply          : crée le brouillon Gmail
 *
 * Les liaisons posées ici sont scellées : ce sont des décisions
 * humaines, l'auto-link ne doit plus les contredire. Le label Gmail
 * suit automatiquement.
 */
export const acceptEmailProposal = action(
  z.object({
    proposalId: z.string().uuid(),
    /**
     * Édition user du payload avant acceptation. Merge sur `proposal.payload`.
     * Clé spéciale `_linkExistingId` : quand présente, on lie la proposition
     * au record existant dont c'est l'id (au lieu de créer un nouveau record).
     * Utile pour contact/entity/project/task ; ignorée pour draft_reply
     * qui n'a pas de record à relier.
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
    } else if (proposal.kind === "project_link") {
      // L'user peut avoir changé le projet suggéré via combobox — la
      // sélection courante arrive via `_linkExistingId`. Sinon on retombe
      // sur le `matchedId` initial (suggéré par le LLM ou côté serveur).
      const projectId = linkExistingId ?? proposal.matchedId;
      if (!projectId) throw new Error("Projet à lier manquant.");
      const [project] = await conn
        .select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!project) throw new Error("Projet introuvable.");
      const label = await ensureCrmLabel({
        userId: targetUserId,
        kind: "project",
        targetId: project.id,
        displayName: project.name,
      });
      // Décision humaine → liaison scellée : l'auto-link n'ajoutera plus
      // un autre projet sur ce thread. Le push Gmail est best-effort et
      // ne bloque pas la validation.
      try {
        await linkThread({
          userId: targetUserId,
          threadIdLocal: msg.threadId,
          labelId: label.id,
          source: "manual",
          decidedBy: user.id,
          seal: true,
        });
      } catch {
        // La liaison est posée en base — push différé.
      }
      createdEntityId = label.id;
    } else if (proposal.kind === "entity_link") {
      // Choix parmi les entités candidates (matchées par domaine). L'user
      // peut avoir sélectionné une entité précise via `_linkExistingId`.
      const entityId = linkExistingId ?? proposal.matchedId;
      if (!entityId) throw new Error("Entité à lier manquante.");
      const [entity] = await conn
        .select({ id: entities.id, name: entities.name })
        .from(entities)
        .where(eq(entities.id, entityId))
        .limit(1);
      if (!entity) throw new Error("Entité introuvable.");
      const label = await ensureCrmLabel({
        userId: targetUserId,
        kind: "entity",
        targetId: entity.id,
        displayName: entity.name,
      });
      try {
        await linkThread({
          userId: targetUserId,
          threadIdLocal: msg.threadId,
          labelId: label.id,
          source: "manual",
          decidedBy: user.id,
          seal: true,
        });
      } catch {
        // La liaison est posée en base — push différé.
      }
      createdEntityId = label.id;
    } else if (proposal.kind === "project_contact_link") {
      // Rattache le contact au projet dans project_contacts. Rend le
      // contact réutilisable pour le tagging auto des mails futurs sur
      // ce projet.
      const contactId = (payload.contactId as string | null) ?? proposal.matchedId;
      const projectId = payload.projectId as string | null;
      if (!contactId || !projectId) {
        throw new Error("Contact ou projet manquant pour le rattachement.");
      }
      await conn.insert(projectContacts).values({ contactId, projectId }).onConflictDoNothing();
      createdEntityId = contactId;
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
        const firstName = sanitizeNameInput(payload.firstName);
        const lastName = sanitizeNameInput(payload.lastName);
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
    revalidatePath("/inbox");
    return { ok: true as const, kind: proposal.kind, createdEntityId };
  },
);

/**
 * Rejette une proposition. Pour les propositions de rattachement, le
 * refus a une conséquence réelle : la liaison correspondante est
 * invalidée et le label Gmail retiré. Le refus porte sur la question
 * posée, pas seulement sur le candidat affiché — rejeter « à quel projet
 * rattacher ce mail ? » vaut « aucun de ceux-là », y compris le lien que
 * l'auto-link avait déjà posé. La ligne invalidée reste en base : c'est
 * elle qui empêche le prochain sync de reposer la question.
 */
export const rejectEmailProposal = action(
  z.object({ proposalId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    const [proposal] = await conn
      .select()
      .from(emailProposals)
      .where(eq(emailProposals.id, input.proposalId))
      .limit(1);
    if (!proposal) throw new Error("Proposition introuvable.");

    await conn
      .update(emailProposals)
      .set({ status: "rejected", decidedBy: user.id, decidedAt: new Date() })
      .where(eq(emailProposals.id, input.proposalId));

    if (proposal.kind === "project_link" || proposal.kind === "entity_link") {
      const [msg] = await conn
        .select({ threadId: gmailMessages.threadId })
        .from(gmailMessages)
        .where(eq(gmailMessages.id, proposal.messageId))
        .limit(1);
      if (msg) {
        const targetUserId = (await getGmailUserId()) ?? user.id;
        const kind = proposal.kind === "project_link" ? "project" : "entity";
        try {
          await dismissThreadLinksOfKind({
            userId: targetUserId,
            threadIdLocal: msg.threadId,
            kind,
            decidedBy: user.id,
            // Scelle aussi les candidats jamais liés : sans ça, un
            // candidat écarté pourrait être posé au sync suivant.
            extraLabelIds: await labelIdsForCandidates(
              targetUserId,
              kind,
              candidateIdsFromPayload(proposal.payload, proposal.matchedId),
            ),
          });
        } catch {
          // Best-effort : le rejet est enregistré même si Gmail refuse.
        }
        revalidatePath(`/emails/${msg.threadId}`);
      }
    }

    revalidatePath("/emails");
    revalidatePath("/emails/propositions");
    revalidatePath("/inbox");
    return { ok: true as const };
  },
);

/** Ids des records candidats portés par une proposition de rattachement. */
function candidateIdsFromPayload(payload: unknown, matchedId: string | null): string[] {
  const ids = new Set<string>();
  if (matchedId) ids.add(matchedId);
  const candidates = (payload as Record<string, unknown> | null)?.candidates;
  if (Array.isArray(candidates)) {
    for (const c of candidates) {
      const id = (c as Record<string, unknown> | null)?.id;
      if (typeof id === "string" && id.length > 0) ids.add(id);
    }
  }
  return [...ids];
}

/** Get-or-create des libellés Paradeos de ces records CRM. */
async function labelIdsForCandidates(
  userId: string,
  kind: "project" | "entity",
  recordIds: string[],
): Promise<string[]> {
  if (recordIds.length === 0) return [];
  const conn = await db();
  const rows =
    kind === "project"
      ? await conn
          .select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, recordIds))
      : await conn
          .select({ id: entities.id, name: entities.name })
          .from(entities)
          .where(inArray(entities.id, recordIds));
  const out: string[] = [];
  for (const r of rows) {
    const label = await ensureCrmLabel({
      userId,
      kind,
      targetId: r.id,
      displayName: r.name,
    });
    out.push(label.id);
  }
  return out;
}

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
      const firstName = sanitizeNameInput(merged.firstName);
      const lastName = sanitizeNameInput(merged.lastName);
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
    revalidatePath("/inbox");
    return { ok: true as const };
  },
);

/**
 * Remet une proposition décidée en `pending`. Ne supprime PAS les
 * records créés côté CRM (contact, entité, projet…) — l'utilisateur les
 * supprime manuellement s'il le veut. Pour draft_reply, le brouillon
 * Gmail est laissé en place (Gmail garde son propre historique).
 *
 * Pour les rattachements, en revanche, la décision EST la liaison : la
 * remettre en attente efface donc la liaison et son label Gmail, dans un
 * sens comme dans l'autre (validation annulée, refus annulé). L'auto-link
 * reprend la main au sync suivant.
 */
export const revertEmailProposal = action(
  z.object({ proposalId: z.string().uuid() }),
  async ({ input, user }) => {
    const conn = await db();
    const [proposal] = await conn
      .select()
      .from(emailProposals)
      .where(eq(emailProposals.id, input.proposalId))
      .limit(1);
    if (!proposal) throw new Error("Proposition introuvable.");

    await conn
      .update(emailProposals)
      .set({ status: "pending", decidedAt: null, decidedBy: null })
      .where(eq(emailProposals.id, input.proposalId));

    if (proposal.kind === "project_link" || proposal.kind === "entity_link") {
      const [msg] = await conn
        .select({ threadId: gmailMessages.threadId })
        .from(gmailMessages)
        .where(eq(gmailMessages.id, proposal.messageId))
        .limit(1);
      if (msg) {
        const targetUserId = (await getGmailUserId()) ?? user.id;
        try {
          await clearThreadLinkDecisions({
            userId: targetUserId,
            threadIdLocal: msg.threadId,
            kind: proposal.kind === "project_link" ? "project" : "entity",
          });
        } catch {
          // Best-effort : la proposition est repassée en attente.
        }
        revalidatePath(`/emails/${msg.threadId}`);
      }
    }

    revalidatePath("/emails");
    revalidatePath("/emails/propositions");
    revalidatePath("/inbox");
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
