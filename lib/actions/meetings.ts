"use server";

import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { tasks } from "@/db/schema/tasks";
import { users } from "@/db/schema/users";
import { action } from "@/lib/actions/action";
import { db } from "@/lib/db/server";
import {
  type Match,
  extractMeeting,
  fuzzyMatchContact,
  fuzzyMatchEntity,
  fuzzyMatchOpportunity,
  fuzzyMatchProject,
  fuzzyMatchUser,
} from "@/lib/meetings/extract";
import {
  createMeetingSchema,
  decideProposalSchema,
  deleteMeetingSchema,
  extractMeetingSchema,
  revertProposalSchema,
  updateAcceptedProposalSchema,
  updateMeetingSummarySchema,
} from "@/lib/schemas/meetings";
import { eq, ilike } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export const createMeeting = action(createMeetingSchema, async ({ input, user }) => {
  const conn = await db();
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : null;
  const [row] = await conn
    .insert(meetings)
    .values({
      title: input.title,
      transcript: input.transcript,
      occurredAt,
      sourceLabel: input.sourceLabel ?? null,
      createdBy: user.id,
    })
    .returning({ id: meetings.id });
  revalidatePath("/meetings");
  return { id: row?.id };
});

/**
 * Lance l'extraction LLM sur le transcript du meeting et persiste les
 * propositions. Idempotent côté UX : on ne supprime pas les propositions
 * déjà décidées (`accepted`/`rejected`), on ré-injecte uniquement les
 * `pending` non encore présents.
 *
 * Pour la première itération on remplace tout : si le user re-extrait,
 * il signifie qu'il veut repartir de zéro.
 */
export const extractMeetingProposals = action(extractMeetingSchema, async ({ input }) => {
  const conn = await db();
  const [meeting] = await conn
    .select()
    .from(meetings)
    .where(eq(meetings.id, input.meetingId))
    .limit(1);
  if (!meeting) throw new Error("Meeting introuvable.");

  const result = await extractMeeting(meeting.transcript);

  await conn.delete(meetingProposals).where(eq(meetingProposals.meetingId, meeting.id));

  const proposalsRows: {
    meetingId: string;
    kind: "task" | "project" | "opportunity" | "contact" | "entity";
    payload: unknown;
    matchedId: string | null;
    matchConfidence: string | null;
  }[] = [];

  for (const e of result.proposedEntities) {
    const match = await fuzzyMatchEntity(e.name);
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "entity",
      payload: e,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  for (const c of result.proposedContacts) {
    const match = await fuzzyMatchContact(c.firstName, c.lastName);
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "contact",
      payload: c,
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  for (const p of result.proposedProjects) {
    const match = await fuzzyMatchProject(p.name);
    // Cross-kind : ce projet ressemble-t-il à une opportunité existante ?
    // Si oui, on le signale dans le payload pour que l'UI propose la
    // conversion plutôt qu'un doublon.
    const oppMatch = await fuzzyMatchOpportunity(p.name);
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "project",
      payload: {
        ...p,
        relatedOpportunityId: oppMatch?.id ?? null,
        relatedOpportunityTitle: oppMatch?.name ?? null,
        relatedOpportunityConfidence: oppMatch ? oppMatch.confidence : null,
      },
      matchedId: match?.id ?? null,
      matchConfidence: match ? match.confidence.toFixed(3) : null,
    });
  }
  for (const o of result.proposedOpportunities) {
    const oppMatch = await fuzzyMatchOpportunity(o.title);
    // Cross-kind : cette opportunité correspond-elle à un projet déjà
    // démarré ? Si oui, on évite le doublon.
    const projMatch = await fuzzyMatchProject(o.title);
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "opportunity",
      payload: {
        ...o,
        relatedProjectId: projMatch?.id ?? null,
        relatedProjectName: projMatch?.name ?? null,
        relatedProjectConfidence: projMatch ? projMatch.confidence : null,
      },
      matchedId: oppMatch?.id ?? null,
      matchConfidence: oppMatch ? oppMatch.confidence.toFixed(3) : null,
    });
  }
  for (const t of result.proposedTasks) {
    // Pré-résolution des FKs via fuzzy match (pg_trgm). Le LLM phrase
    // souvent les noms autrement que la base — on accepte des écarts
    // raisonnables pour pré-cocher le bon projet / la bonne assignée.
    const projectMatch = t.projectName ? await fuzzyMatchProject(t.projectName) : null;
    const assigneeMatch = t.assigneeName ? await fuzzyMatchUser(t.assigneeName) : null;
    proposalsRows.push({
      meetingId: meeting.id,
      kind: "task",
      payload: {
        ...t,
        projectId: projectMatch?.id ?? null,
        assigneeId: assigneeMatch?.id ?? null,
      },
      matchedId: null,
      matchConfidence: null,
    });
  }

  if (proposalsRows.length > 0) {
    await conn.insert(meetingProposals).values(proposalsRows);
  }

  await conn
    .update(meetings)
    .set({
      summary: result.summary,
      occurredAt: meeting.occurredAt ?? (result.occurredAt ? new Date(result.occurredAt) : null),
      status: "extracted",
    })
    .where(eq(meetings.id, meeting.id));

  revalidatePath(`/meetings/${meeting.id}`);
  revalidatePath("/meetings");
  return { count: proposalsRows.length };
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
    .set({
      status: "accepted",
      decidedBy: user.id,
      decidedAt: new Date(),
      createdEntityId,
    })
    .where(eq(meetingProposals.id, proposal.id));

  revalidatePath(`/meetings/${proposal.meetingId}`);
  revalidatePath("/contacts");
  revalidatePath("/entites");
  revalidatePath("/projets");
  revalidatePath("/opportunites");
  revalidatePath("/taches");
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
  revalidatePath("/contacts");
  revalidatePath("/entites");
  revalidatePath("/projets");
  revalidatePath("/opportunites");
  revalidatePath("/taches");
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
  if (proposal.status === "pending") return { ok: true as const };

  await conn
    .update(meetingProposals)
    .set({
      status: "pending",
      decidedBy: null,
      decidedAt: null,
      // On garde createdEntityId pour traçabilité, mais on ne ré-utilise
      // pas le lien à la prochaine acceptation (un nouvel accept créera
      // ou matchera à nouveau).
    })
    .where(eq(meetingProposals.id, proposal.id));

  revalidatePath(`/meetings/${proposal.meetingId}`);
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
      const [row] = await conn
        .insert(entities)
        .values({
          name: String(payload.name ?? "Sans nom"),
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
      // Si entityName fourni → tente de le lier à une entité existante.
      let entityId: string | null = null;
      const entityName = payload.entityName as string | null | undefined;
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
          firstName: String(payload.firstName ?? ""),
          lastName: String(payload.lastName ?? ""),
          email: (payload.email as string | null) ?? null,
          jobTitle: (payload.jobTitle as string | null) ?? null,
          entityId,
          createdBy: userId,
          ownerId: userId,
        })
        .returning({ id: contacts.id });
      return row?.id ?? "";
    }
    case "project": {
      let entityId: string | null = null;
      const entityName = payload.entityName as string | null | undefined;
      if (entityName) {
        const [matched] = await conn
          .select({ id: entities.id })
          .from(entities)
          .where(ilike(entities.name, entityName))
          .limit(1);
        entityId = matched?.id ?? null;
      }
      const [row] = await conn
        .insert(projects)
        .values({
          name: String(payload.name ?? "Sans nom"),
          kind: (payload.kind as "client" | "product" | "transverse") ?? "transverse",
          status: "planning",
          entityId,
          createdBy: userId,
          ownerId: userId,
        })
        .returning({ id: projects.id });
      return row?.id ?? "";
    }
    case "opportunity": {
      let entityId: string | null = null;
      const entityName = payload.entityName as string | null | undefined;
      if (entityName) {
        const [matched] = await conn
          .select({ id: entities.id })
          .from(entities)
          .where(ilike(entities.name, entityName))
          .limit(1);
        entityId = matched?.id ?? null;
      }
      const valueAmount = payload.valueAmount as number | null | undefined;
      const [row] = await conn
        .insert(opportunities)
        .values({
          title: String(payload.title ?? "Sans titre"),
          status: "not_started",
          entityId,
          valueAmount: valueAmount != null ? valueAmount.toString() : null,
          createdBy: userId,
          ownerId: userId,
        })
        .returning({ id: opportunities.id });
      return row?.id ?? "";
    }
    case "task": {
      // Priorité aux IDs explicites (depuis l'éditeur). Fallback sur
      // les noms (ancien comportement) si l'humain n'a pas sélectionné.
      let projectId: string | null = (payload.projectId as string | null | undefined) ?? null;
      if (!projectId) {
        const projectName = payload.projectName as string | null | undefined;
        if (projectName) {
          const [matched] = await conn
            .select({ id: projects.id })
            .from(projects)
            .where(ilike(projects.name, projectName))
            .limit(1);
          projectId = matched?.id ?? null;
        }
      }
      let assigneeId: string | null = (payload.assigneeId as string | null | undefined) ?? null;
      if (!assigneeId) {
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
      const [row] = await conn
        .insert(tasks)
        .values({
          title: String(payload.title ?? "Sans titre"),
          status: "todo",
          priority,
          projectId,
          assigneeId,
          dueDate: dueDate ?? null,
          createdBy: userId,
        })
        .returning({ id: tasks.id });
      return row?.id ?? "";
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
      let entityId: string | null = null;
      const entityName = payload.entityName as string | null | undefined;
      if (entityName) {
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
      let entityId: string | null = null;
      const entityName = payload.entityName as string | null | undefined;
      if (entityName) {
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
      let entityId: string | null = null;
      const entityName = payload.entityName as string | null | undefined;
      if (entityName) {
        const [matched] = await conn
          .select({ id: entities.id })
          .from(entities)
          .where(ilike(entities.name, entityName))
          .limit(1);
        entityId = matched?.id ?? null;
      }
      const valueAmount = payload.valueAmount as number | null | undefined;
      await conn
        .update(opportunities)
        .set({
          title: String(payload.title ?? "Sans titre"),
          entityId,
          valueAmount: valueAmount != null ? valueAmount.toString() : null,
        })
        .where(eq(opportunities.id, recordId));
      return;
    }
    case "task": {
      let projectId: string | null = (payload.projectId as string | null | undefined) ?? null;
      if (!projectId) {
        const projectName = payload.projectName as string | null | undefined;
        if (projectName) {
          const [matched] = await conn
            .select({ id: projects.id })
            .from(projects)
            .where(ilike(projects.name, projectName))
            .limit(1);
          projectId = matched?.id ?? null;
        }
      }
      let assigneeId: string | null = (payload.assigneeId as string | null | undefined) ?? null;
      if (!assigneeId) {
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
      await conn
        .update(tasks)
        .set({
          title: String(payload.title ?? "Sans titre"),
          priority,
          projectId,
          assigneeId,
          dueDate: dueDate ?? null,
        })
        .where(eq(tasks.id, recordId));
      return;
    }
  }
}
