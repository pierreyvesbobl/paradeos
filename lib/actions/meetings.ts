"use server";

import { and, eq, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { meetingParticipants } from "@/db/schema/meeting-participants";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import {
  findExistingContactId,
  findExistingEntityId,
  findExistingOpenTaskId,
  findExistingProjectId,
} from "@/lib/crm/find-or-link";
import type { Match } from "@/lib/crm/match";
import { setTaskAssignees } from "@/lib/db/queries/task-assignees";
import { db } from "@/lib/db/server";
import { extractAndSaveProposals } from "@/lib/meetings/extract-and-save";
import {
  createMeetingSchema,
  decideProposalSchema,
  deleteMeetingSchema,
  extractMeetingSchema,
  revertProposalSchema,
  updateAcceptedProposalSchema,
  updateMeetingSubjectSchema,
  updateMeetingSummarySchema,
} from "@/lib/schemas/meetings";
export const createMeeting = action(createMeetingSchema, async ({ input, user }) => {
  const conn = await db();
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
  const transcript =
    input.transcript && input.transcript.trim().length > 0 ? input.transcript : null;
  const [row] = await conn
    .insert(meetings)
    .values({
      title: input.title,
      transcript,
      occurredAt,
      sourceLabel: input.sourceLabel ?? null,
      projectId: input.projectId ?? null,
      createdBy: user.id,
    })
    .returning({ id: meetings.id });

  // Les participants partent en base avant tout : le formulaire de
  // création enchaîne sur l'extraction, qui les lit pour son prompt.
  if (row && input.participants && input.participants.length > 0) {
    await conn
      .insert(meetingParticipants)
      .values(
        input.participants.map((p) => ({
          meetingId: row.id,
          userId: "userId" in p ? p.userId : null,
          contactId: "contactId" in p ? p.contactId : null,
          displayName: "displayName" in p ? p.displayName : null,
          source: "manual" as const,
          addedBy: user.id,
        })),
      )
      .onConflictDoNothing();
  }

  revalidatePath("/meetings");
  return { id: row?.id };
});

/**
 * Met à jour le rattachement d'un meeting à un projet (couvre les phases
 * commerciales et delivery). Passer `null` pour détacher.
 */
export const updateMeetingSubject = action(updateMeetingSubjectSchema, async ({ input }) => {
  const conn = await db();
  await conn
    .update(meetings)
    .set({
      projectId: input.projectId,
      updatedAt: new Date(),
    })
    .where(eq(meetings.id, input.meetingId));
  revalidatePath(`/meetings/${input.meetingId}`);
  revalidatePath("/meetings");
  return {};
});

/**
 * Lance l'extraction LLM sur le transcript du meeting et persiste les
 * propositions.
 *
 * Toute la logique vit dans `extractAndSaveProposals` : le cron Drive
 * appelle le même helper, et les deux chemins partagent donc le même
 * dédoublonnage. Ici on ne fait que le contrôle d'accès (via `action`) et
 * l'invalidation des caches Next.
 */
export const extractMeetingProposals = action(extractMeetingSchema, async ({ input }) => {
  const { count } = await extractAndSaveProposals(input.meetingId);

  revalidatePath(`/meetings/${input.meetingId}`);
  revalidatePath("/meetings");
  revalidatePath("/inbox");
  return { count };
});

export const updateMeetingSummary = action(updateMeetingSummarySchema, async ({ input }) => {
  const conn = await db();
  await conn
    .update(meetings)
    .set({ summary: input.summary })
    .where(eq(meetings.id, input.meetingId));
  revalidatePath(`/meetings/${input.meetingId}`);
  return { id: input.meetingId };
});

/**
 * Accepte ou rejette une proposition. Si `accept` :
 *   - et `matchedId` non null → on lie au record existant.
 *   - sinon → on crée le record (selon `kind`) avec le payload.
 */
export const decideProposal = action(decideProposalSchema, async ({ input, user }) => {
  const conn = await db();
  const [proposal] = await conn
    .select()
    .from(meetingProposals)
    .where(eq(meetingProposals.id, input.proposalId))
    .limit(1);
  if (!proposal) throw new Error("Proposition introuvable.");
  if (proposal.status !== "pending") {
    throw new Error("Proposition déjà décidée.");
  }

  if (input.action === "reject") {
    await conn
      .update(meetingProposals)
      .set({ status: "rejected", decidedBy: user.id, decidedAt: new Date() })
      .where(eq(meetingProposals.id, proposal.id));
    revalidatePath(`/meetings/${proposal.meetingId}`);
    revalidatePath("/inbox");
    return { ok: true as const };
  }

  // Réclamation atomique : on flippe pending→accepted *conditionnellement*
  // sur status='pending'. Si aucune ligne n'est touchée, c'est qu'un appel
  // concurrent (double-clic, retry réseau, « Tout accepter » relancé) a déjà
  // décidé cette proposition → on s'arrête avant de créer un doublon.
  const claimed = await conn
    .update(meetingProposals)
    .set({ status: "accepted", decidedBy: user.id, decidedAt: new Date() })
    .where(and(eq(meetingProposals.id, proposal.id), eq(meetingProposals.status, "pending")))
    .returning({ id: meetingProposals.id });
  if (claimed.length === 0) {
    return { ok: true as const };
  }

  // Accept : merge override sur payload puis crée/lie.
  const payload = {
    ...(proposal.payload as Record<string, unknown>),
    ...(input.payloadOverride ?? {}),
  };

  // Cas 1 — l'humain a explicitement choisi de lier à un record existant
  // via le picker UI (`_linkExistingId`). On l'utilise direct.
  const linkExistingId =
    typeof payload._linkExistingId === "string" && payload._linkExistingId.length > 0
      ? payload._linkExistingId
      : null;

  // Cas 2 — l'humain a édité d'autres champs (sans choisir de lien
  // explicite) → on ignore le match auto et on crée un nouveau record.
  // Cas 3 — pas d'override → on retombe sur le match auto si présent.
  const overrideKeys = input.payloadOverride
    ? Object.keys(input.payloadOverride).filter((k) => k !== "_linkExistingId")
    : [];
  const hasNonLinkOverride = overrideKeys.length > 0;

  let createdEntityId: string | null = linkExistingId
    ? linkExistingId
    : hasNonLinkOverride
      ? null
      : (proposal.matchedId ?? null);

  if (!createdEntityId) {
    // Nettoie le marqueur interne avant de pousser au créateur.
    const { _linkExistingId: _omit, ...createPayload } = payload;
    void _omit;
    createdEntityId = await createForKind(proposal.kind, createPayload, user.id);
  }

  await conn
    .update(meetingProposals)
    .set({ createdEntityId })
    .where(eq(meetingProposals.id, proposal.id));

  revalidatePath(`/meetings/${proposal.meetingId}`);
  revalidatePath("/crm/contacts");
  revalidatePath("/crm/entites");
  revalidatePath("/projets");
  revalidatePath("/projets");
  revalidatePath("/taches");
  revalidatePath("/inbox");
  return { ok: true as const, createdEntityId };
});

/**
 * Met à jour le record lié à une proposition déjà acceptée. Permet de
 * corriger après coup (mauvais titre, mauvais projet, etc.) sans avoir
 * à passer par un revert + re-accept (qui créerait un nouveau record).
 *
 * Met aussi à jour le `payload` de la proposition pour qu'il reflète
 * l'état courant.
 */
export const updateAcceptedProposal = action(updateAcceptedProposalSchema, async ({ input }) => {
  const conn = await db();
  const [proposal] = await conn
    .select()
    .from(meetingProposals)
    .where(eq(meetingProposals.id, input.proposalId))
    .limit(1);
  if (!proposal) throw new Error("Proposition introuvable.");
  if (proposal.status !== "accepted") {
    throw new Error("Seules les propositions acceptées peuvent être éditées ici.");
  }
  if (!proposal.createdEntityId) {
    throw new Error("Aucun record lié à mettre à jour.");
  }

  const { _linkExistingId: _omitOld, ...prevPayload } = proposal.payload as Record<string, unknown>;
  const { _linkExistingId: _omitNew, ...newPayload } = input.payload;
  void _omitOld;
  void _omitNew;
  const merged = { ...prevPayload, ...newPayload };

  await applyUpdateForKind(proposal.kind, proposal.createdEntityId, merged);

  await conn
    .update(meetingProposals)
    .set({ payload: merged })
    .where(eq(meetingProposals.id, proposal.id));

  revalidatePath(`/meetings/${proposal.meetingId}`);
  revalidatePath("/crm/contacts");
  revalidatePath("/crm/entites");
  revalidatePath("/projets");
  revalidatePath("/projets");
  revalidatePath("/taches");
  revalidatePath("/inbox");
  return { ok: true as const };
});

/**
 * Restaure une proposition décidée en `pending`. Ne supprime PAS le
 * record auto-créé (entité, contact, projet, opportunité, tâche) — pour
 * éviter les pertes de travail si la fiche a été enrichie depuis. Le
 * `createdEntityId` reste dans la trace, l'humain pourra ré-accepter
 * (ce qui re-créera un nouveau record) ou rejeter.
 */
export const revertProposal = action(revertProposalSchema, async ({ input }) => {
  const conn = await db();
  const [proposal] = await conn
    .select()
    .from(meetingProposals)
    .where(eq(meetingProposals.id, input.proposalId))
    .limit(1);
  if (!proposal) throw new Error("Proposition introuvable.");
  const clearMatch = input.clearMatch === true && proposal.matchedId !== null;
  if (proposal.status === "pending" && !clearMatch) return { ok: true as const };

  await conn
    .update(meetingProposals)
    .set({
      status: "pending",
      decidedBy: null,
      decidedAt: null,
      // On garde createdEntityId pour traçabilité, mais on ne ré-utilise
      // pas le lien à la prochaine acceptation (un nouvel accept créera
      // ou matchera à nouveau).
      // « Mauvaise fiche » : sans effacer matchedId, decideProposal
      // retomberait sur le même match auto et la ligne reviendrait dans
      // « Déjà en base » au rafraîchissement.
      ...(clearMatch ? { matchedId: null, matchConfidence: null } : {}),
    })
    .where(eq(meetingProposals.id, proposal.id));

  revalidatePath(`/meetings/${proposal.meetingId}`);
  revalidatePath("/inbox");
  return { ok: true as const };
});

export const deleteMeeting = action(deleteMeetingSchema, async ({ input }) => {
  const conn = await db();
  await conn.delete(meetings).where(eq(meetings.id, input.id));
  revalidatePath("/meetings");
  return { id: input.id };
});

export async function deleteMeetingAndRedirect(formData: FormData) {
  const id = formData.get("id");
  if (typeof id !== "string") throw new Error("id manquant");
  const result = await deleteMeeting({ id });
  if (!result.ok) throw new Error(result.message);
  redirect("/meetings");
}

// ----- helpers -----

async function createForKind(
  kind: "task" | "project" | "opportunity" | "contact" | "entity",
  payload: Record<string, unknown>,
  userId: string,
): Promise<string> {
  const conn = await db();

  switch (kind) {
    case "entity": {
      const entityName = String(payload.name ?? "Sans nom");
      // Find-or-create : si une entité équivalente existe déjà, on la
      // réutilise plutôt que d'en créer une 2e. Le matcher normalise le
      // nom (accents, ponctuation, forme juridique), donc « mkpdoctor »
      // retrouve « MKP Doctor » — ce qu'un `ilike` exact ne faisait pas.
      const existingId = await findExistingEntityId(entityName);
      if (existingId) return existingId;
      const [row] = await conn
        .insert(entities)
        .values({
          name: entityName,
          kind:
            (payload.kind as "client" | "prospect" | "partner" | "supplier" | "other") ??
            "prospect",
          createdBy: userId,
          ownerId: userId,
        })
        .returning({ id: entities.id });
      return row?.id ?? "";
    }
    case "contact": {
      const firstName = String(payload.firstName ?? "");
      const lastName = String(payload.lastName ?? "");
      const email = (payload.email as string | null) ?? null;
      // Find-or-link : la même personne revient d'un meeting à l'autre, et
      // le `matchedId` de la proposition date de l'extraction. On revérifie
      // (email puis nom normalisé) avant de créer un 2e contact.
      const existingContactId = await findExistingContactId({ firstName, lastName, email });
      if (existingContactId) return existingContactId;

      // Si entityName fourni → tente de le lier à une entité existante.
      let entityId: string | null = (payload.entityId as string | null | undefined) ?? null;
      const entityName = payload.entityName as string | null | undefined;
      if (!entityId && entityName) {
        entityId = await findExistingEntityId(entityName);
      }
      const [row] = await conn
        .insert(contacts)
        .values({
          firstName,
          lastName,
          email,
          jobTitle: (payload.jobTitle as string | null) ?? null,
          entityId,
          createdBy: userId,
          ownerId: userId,
        })
        .returning({ id: contacts.id });
      return row?.id ?? "";
    }
    case "project":
    case "opportunity": {
      // Avec la fusion opps → projects, les deux kinds créent un project.
      // Le payload peut porter `status` (depuis le LLM) — `not_started` etc
      // pour les phases commerciales, `active`/`planning` pour delivery.
      // Backward-compat : kind="opportunity" force status=not_started si absent.
      let entityId: string | null = (payload.entityId as string | null | undefined) ?? null;
      const entityName = payload.entityName as string | null | undefined;
      if (!entityId && entityName) {
        entityId = await findExistingEntityId(entityName);
      }
      const valueAmount = payload.valueAmount as number | null | undefined;
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
          : kind === "opportunity"
            ? "not_started"
            : "planning";
      // Le LLM propose `title` pour une opp et `name` pour un projet — on supporte les deux.
      const projectName = String(payload.name ?? payload.title ?? "Sans nom");
      // Find-or-link, scopé sur l'entité résolue : deux propositions nées
      // de deux réunions du même client ne doivent pas donner deux projets.
      const existingProjectId = await findExistingProjectId(projectName, entityId);
      if (existingProjectId) return existingProjectId;
      const [row] = await conn
        .insert(projects)
        .values({
          name: projectName,
          kind: (payload.kind as "client" | "product" | "transverse") ?? "transverse",
          status,
          entityId,
          valueAmount: valueAmount != null ? valueAmount.toString() : null,
          createdBy: userId,
          ownerId: userId,
        })
        .returning({ id: projects.id });
      return row?.id ?? "";
    }
    case "task": {
      // Priorité aux IDs explicites (depuis l'éditeur). Fallback sur
      // les noms (ancien comportement) si l'humain n'a pas sélectionné.
      let projectId: string | null = (payload.projectId as string | null | undefined) ?? null;
      if (!projectId) {
        const projectName = payload.projectName as string | null | undefined;
        if (projectName) projectId = await findExistingProjectId(projectName);
      }
      // Même action acceptée deux fois (deux réunions, deux mails d'un
      // fil) → on renvoie la tâche déjà ouverte au lieu d'en ouvrir une 2e.
      const taskTitle = String(payload.title ?? "Sans titre");
      const existingTaskId = await findExistingOpenTaskId(taskTitle, projectId);
      if (existingTaskId) return existingTaskId;
      // XOR-ish : si un contact externe est désigné, on ignore assigneeId.
      // Sinon on retombe sur user via assigneeId ou fuzzy-match nom.
      let assigneeContactId: string | null =
        (payload.assigneeContactId as string | null | undefined) ?? null;
      let assigneeId: string | null = assigneeContactId
        ? null
        : ((payload.assigneeId as string | null | undefined) ?? null);
      if (!assigneeId && !assigneeContactId) {
        const assigneeName = payload.assigneeName as string | null | undefined;
        const assigneeKind = payload.assigneeKind as "internal" | "external" | null | undefined;
        if (assigneeName) {
          if (assigneeKind === "external") {
            const first = assigneeName.split(" ")[0] ?? assigneeName;
            const [matched] = await conn
              .select({ id: contacts.id })
              .from(contacts)
              .where(ilike(contacts.firstName, `%${first}%`))
              .limit(1);
            assigneeContactId = matched?.id ?? null;
          } else {
            const [matched] = await conn
              .select({ id: users.id })
              .from(users)
              .where(ilike(users.fullName, `%${assigneeName}%`))
              .limit(1);
            assigneeId = matched?.id ?? null;
          }
        }
      }
      const dueDate = payload.dueDate as string | null | undefined;
      const priorityIn = payload.priority as "low" | "normal" | "high" | null | undefined;
      const priority: "low" | "medium" | "high" | "urgent" =
        priorityIn === "high" ? "high" : priorityIn === "low" ? "low" : "medium";
      const inserted = await conn.transaction(async (tx) => {
        const [row] = await tx
          .insert(tasks)
          .values({
            title: taskTitle,
            status: "todo",
            priority,
            projectId,
            // Colonnes legacy mises à NULL : la source de vérité est
            // task_assignees.
            assigneeId: null,
            assigneeContactId: null,
            dueDate: dueDate ?? null,
            createdBy: userId,
          })
          .returning({ id: tasks.id });
        if (!row) return null;
        const assignees: { kind: "user" | "contact"; id: string }[] = [];
        if (assigneeContactId) assignees.push({ kind: "contact", id: assigneeContactId });
        else if (assigneeId) assignees.push({ kind: "user", id: assigneeId });
        if (assignees.length > 0) {
          await setTaskAssignees(tx, row.id, assignees, userId);
        }
        return row;
      });
      return inserted?.id ?? "";
    }
  }
}

// Type pour matchedId — utilisé par le caller seulement.
export type _MatchTypeFix = Match;

/**
 * Met à jour le record lié (table déduite par `kind`) avec les
 * nouvelles valeurs du payload. Mêmes règles de fallback nom→id pour
 * les FKs (entityName, projectName, assigneeName).
 */
async function applyUpdateForKind(
  kind: "task" | "project" | "opportunity" | "contact" | "entity",
  recordId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const conn = await db();

  switch (kind) {
    case "entity": {
      await conn
        .update(entities)
        .set({
          name: String(payload.name ?? "Sans nom"),
          kind:
            (payload.kind as "client" | "prospect" | "partner" | "supplier" | "other") ??
            "prospect",
        })
        .where(eq(entities.id, recordId));
      return;
    }
    case "contact": {
      let entityId: string | null = (payload.entityId as string | null | undefined) ?? null;
      const entityName = payload.entityName as string | null | undefined;
      if (!entityId && entityName) {
        const [matched] = await conn
          .select({ id: entities.id })
          .from(entities)
          .where(ilike(entities.name, entityName))
          .limit(1);
        entityId = matched?.id ?? null;
      }
      await conn
        .update(contacts)
        .set({
          firstName: String(payload.firstName ?? ""),
          lastName: String(payload.lastName ?? ""),
          email: (payload.email as string | null) ?? null,
          jobTitle: (payload.jobTitle as string | null) ?? null,
          entityId,
        })
        .where(eq(contacts.id, recordId));
      return;
    }
    case "project": {
      let entityId: string | null = (payload.entityId as string | null | undefined) ?? null;
      const entityName = payload.entityName as string | null | undefined;
      if (!entityId && entityName) {
        const [matched] = await conn
          .select({ id: entities.id })
          .from(entities)
          .where(ilike(entities.name, entityName))
          .limit(1);
        entityId = matched?.id ?? null;
      }
      await conn
        .update(projects)
        .set({
          name: String(payload.name ?? "Sans nom"),
          kind: (payload.kind as "client" | "product" | "transverse") ?? "transverse",
          entityId,
        })
        .where(eq(projects.id, recordId));
      return;
    }
    case "opportunity": {
      // Backward-compat : un proposal kind=opportunity accepté pointe
      // maintenant sur un project (fusion). On met à jour le project lié.
      let entityId: string | null = (payload.entityId as string | null | undefined) ?? null;
      const entityName = payload.entityName as string | null | undefined;
      if (!entityId && entityName) {
        entityId = await findExistingEntityId(entityName);
      }
      const valueAmount = payload.valueAmount as number | null | undefined;
      await conn
        .update(projects)
        .set({
          name: String(payload.name ?? payload.title ?? "Sans nom"),
          entityId,
          valueAmount: valueAmount != null ? valueAmount.toString() : null,
        })
        .where(eq(projects.id, recordId));
      return;
    }
    case "task": {
      let projectId: string | null = (payload.projectId as string | null | undefined) ?? null;
      if (!projectId) {
        const projectName = payload.projectName as string | null | undefined;
        if (projectName) projectId = await findExistingProjectId(projectName);
      }
      const taskTitle = String(payload.title ?? "Sans titre");
      const assigneeContactId: string | null =
        (payload.assigneeContactId as string | null | undefined) ?? null;
      let assigneeId: string | null = assigneeContactId
        ? null
        : ((payload.assigneeId as string | null | undefined) ?? null);
      if (!assigneeId && !assigneeContactId) {
        const assigneeName = payload.assigneeName as string | null | undefined;
        if (assigneeName) {
          const [matched] = await conn
            .select({ id: users.id })
            .from(users)
            .where(ilike(users.fullName, `%${assigneeName}%`))
            .limit(1);
          assigneeId = matched?.id ?? null;
        }
      }
      const dueDate = payload.dueDate as string | null | undefined;
      const priorityIn = payload.priority as "low" | "normal" | "high" | null | undefined;
      const priority: "low" | "medium" | "high" | "urgent" =
        priorityIn === "high" ? "high" : priorityIn === "low" ? "low" : "medium";
      await conn.transaction(async (tx) => {
        await tx
          .update(tasks)
          .set({
            title: taskTitle,
            priority,
            projectId,
            assigneeId: null,
            assigneeContactId: null,
            dueDate: dueDate ?? null,
          })
          .where(eq(tasks.id, recordId));
        const assignees: { kind: "user" | "contact"; id: string }[] = [];
        if (assigneeContactId) assignees.push({ kind: "contact", id: assigneeContactId });
        else if (assigneeId) assignees.push({ kind: "user", id: assigneeId });
        await setTaskAssignees(tx, recordId, assignees, null);
      });
      return;
    }
  }
}
