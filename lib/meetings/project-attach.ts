import "server-only";

import { and, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { entities } from "@/db/schema/entities";
import { meetingParticipants } from "@/db/schema/meeting-participants";
import { meetingProposals, meetings } from "@/db/schema/meetings";
import { projectContacts } from "@/db/schema/project-contacts";
import { projects } from "@/db/schema/projects";
import {
  decideMeetingProject,
  type NamedProject,
  type ProjectDecision,
  type ProjectSignal,
  participantSignals,
  SIGNAL_WEIGHT,
  taskSignals,
  titleSignals,
} from "./project-signals";

/** Un projet clos ne reçoit plus de réunion d'office. */
const CLOSED_PROJECT_STATUSES = ["lost", "completed", "archived"] as const;

/** Réunions réévaluées par passage du rattrapage ; l'évaluation ne coûte que des requêtes. */
const BACKFILL_PER_RUN = 40;
/** Une réunion évaluée sans succès est réévaluée au plus une fois par jour. */
const RECHECK_AFTER_MS = 24 * 3_600_000;

async function openProjects(conn: Database): Promise<NamedProject[]> {
  return conn
    .select({
      id: projects.id,
      name: projects.name,
      entityId: projects.entityId,
      entityName: entities.name,
    })
    .from(projects)
    .leftJoin(entities, eq(entities.id, projects.entityId))
    .where(notInArray(projects.status, [...CLOSED_PROJECT_STATUSES]));
}

/**
 * Indices d'une réunion : titre, projets des tâches proposées (toutes
 * propositions de la réunion), contacts des participants. `extra` ajoute
 * ce que l'extraction en cours sait et que la base n'a pas encore :
 * projets reconnus à coup sûr, projets des tâches de la passe.
 */
export async function gatherMeetingProjectSignals(
  conn: Database,
  meetingId: string,
  extra: { namedProjectIds?: string[]; taskProjectIds?: (string | null)[] } = {},
): Promise<ProjectSignal[]> {
  const [meeting] = await conn
    .select({ title: meetings.title })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  if (!meeting) return [];
  const open = await openProjects(conn);
  const openIds = new Set(open.map((p) => p.id));

  const [taskRows, participantRows] = await Promise.all([
    conn
      .select({ payload: meetingProposals.payload })
      .from(meetingProposals)
      .where(
        and(
          eq(meetingProposals.meetingId, meetingId),
          eq(meetingProposals.kind, "task"),
          sql`${meetingProposals.status} <> 'expired'`,
        ),
      ),
    conn
      .select({ contactId: meetingParticipants.contactId })
      .from(meetingParticipants)
      .where(
        and(eq(meetingParticipants.meetingId, meetingId), isNotNull(meetingParticipants.contactId)),
      ),
  ]);

  const taskProjectIds = [
    ...taskRows.map((r) => {
      const id = (r.payload as { projectId?: unknown } | null)?.projectId;
      return typeof id === "string" && openIds.has(id) ? id : null;
    }),
    ...(extra.taskProjectIds ?? []).map((id) => (id && openIds.has(id) ? id : null)),
  ];

  const contactIds = [
    ...new Set(participantRows.flatMap((r) => (r.contactId ? [r.contactId] : []))),
  ];
  let participantProjects: string[][] = [];
  if (contactIds.length > 0) {
    const links = await conn
      .select({ contactId: projectContacts.contactId, projectId: projectContacts.projectId })
      .from(projectContacts)
      .where(inArray(projectContacts.contactId, contactIds));
    const primary = await conn
      .select({ contactId: projects.contactId, projectId: projects.id })
      .from(projects)
      .where(inArray(projects.contactId, contactIds));
    const byContact = new Map<string, Set<string>>();
    for (const l of [...links, ...primary]) {
      if (!l.contactId || !openIds.has(l.projectId)) continue;
      const set = byContact.get(l.contactId) ?? new Set<string>();
      set.add(l.projectId);
      byContact.set(l.contactId, set);
    }
    participantProjects = [...byContact.values()].map((s) => [...s]);
  }

  return [
    ...(extra.namedProjectIds ?? [])
      .filter((id) => openIds.has(id))
      .map((projectId) => ({ projectId, kind: "named" as const, weight: SIGNAL_WEIGHT.named })),
    ...titleSignals(meeting.title, open),
    ...taskSignals(taskProjectIds),
    ...participantSignals(participantProjects),
  ];
}

/**
 * Rattache la réunion si les indices concordent. Ne touche jamais une
 * réunion déjà rattachée, ni une réunion qu'un rattachement automatique a
 * déjà visée : si elle est sans projet aujourd'hui, c'est que l'humain l'a
 * détachée, et on ne revient pas sur sa décision.
 */
export async function attachMeetingIfConfident(
  conn: Database,
  meetingId: string,
  extra?: { namedProjectIds?: string[]; taskProjectIds?: (string | null)[] },
  now: Date = new Date(),
): Promise<ProjectDecision | null> {
  const [m] = await conn
    .select({ projectId: meetings.projectId, autoAt: meetings.projectAutoAt })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1);
  if (!m || m.projectId || m.autoAt) return null;
  const decision = decideMeetingProject(await gatherMeetingProjectSignals(conn, meetingId, extra));
  await conn
    .update(meetings)
    .set(
      decision
        ? {
            projectId: decision.projectId,
            projectAutoAt: now,
            projectAutoReason: `${decision.reasons.join("+")} (${decision.score})`,
            projectAutoCheckedAt: now,
          }
        : { projectAutoCheckedAt: now },
    )
    .where(and(eq(meetings.id, meetingId), isNull(meetings.projectId)));
  return decision;
}

/** Rattrapage des réunions sans projet, au fil des relèves. */
export async function backfillMeetingProjects(
  conn: Database,
  opts: { limit?: number; now?: Date } = {},
): Promise<{ checked: number; attached: number }> {
  const now = opts.now ?? new Date();
  const recheckBefore = new Date(now.getTime() - RECHECK_AFTER_MS);
  const rows = await conn
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        isNull(meetings.projectId),
        isNull(meetings.projectAutoAt),
        eq(meetings.status, "extracted"),
        or(isNull(meetings.projectAutoCheckedAt), lt(meetings.projectAutoCheckedAt, recheckBefore)),
      ),
    )
    .orderBy(sql`${meetings.occurredAt} desc nulls last`)
    .limit(opts.limit ?? BACKFILL_PER_RUN);
  let attached = 0;
  for (const r of rows) {
    if (await attachMeetingIfConfident(conn, r.id, undefined, now)) attached++;
  }
  return { checked: rows.length, attached };
}
