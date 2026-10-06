import { and, asc, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../../db/client";
import { meetingParticipants } from "../../db/schema/meeting-participants";
import { meetingProposals, meetings } from "../../db/schema/meetings";
import { projects } from "../../db/schema/projects";
import { getMeetingParticipants } from "../../lib/db/queries/meeting-participants";
import type { UserContext } from "../context";
import { db } from "../db";
import { DEFAULT_LIMIT } from "./shared";

export const listMeetingsSchema = z.object({
  projectId: z.string().uuid().optional(),
  since: z.string().optional(),
  limit: z.number().int().positive().max(100).optional(),
});

export async function listMeetings(args: z.infer<typeof listMeetingsSchema>) {
  const conn = db();
  const conds = [];
  if (args.projectId) conds.push(eq(meetings.projectId, args.projectId));
  if (args.since) conds.push(gte(meetings.occurredAt, new Date(args.since)));

  return conn
    .select({
      id: meetings.id,
      title: meetings.title,
      occurredAt: meetings.occurredAt,
      summary: meetings.summary,
      status: meetings.status,
      projectId: meetings.projectId,
      projectName: projects.name,
      sourceLabel: meetings.sourceLabel,
    })
    .from(meetings)
    .leftJoin(projects, eq(projects.id, meetings.projectId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(meetings.occurredAt))
    .limit(args.limit ?? DEFAULT_LIMIT);
}

export const getMeetingSchema = z.object({ id: z.string().uuid() });

export async function getMeeting(args: z.infer<typeof getMeetingSchema>) {
  const conn = db();
  const [meeting] = await conn.select().from(meetings).where(eq(meetings.id, args.id)).limit(1);
  if (!meeting) return null;

  const [proposals, participants] = await Promise.all([
    conn
      .select()
      .from(meetingProposals)
      .where(eq(meetingProposals.meetingId, meeting.id))
      .orderBy(asc(meetingProposals.createdAt)),
    getMeetingParticipants(conn, meeting.id),
  ]);

  return { meeting, participants, proposals };
}

/**
 * Retourne uniquement le transcript brut d'un meeting + métadonnées de
 * transcription (status, provider, erreur). Utile quand l'agent veut
 * relire le contenu de la réunion sans tirer aussi les propositions LLM
 * (souvent verbeuses) renvoyées par `get_meeting`.
 */
export const getMeetingTranscriptSchema = z.object({ id: z.string().uuid() });

export async function getMeetingTranscript(args: z.infer<typeof getMeetingTranscriptSchema>) {
  const conn = db();
  const [row] = await conn
    .select({
      id: meetings.id,
      title: meetings.title,
      occurredAt: meetings.occurredAt,
      sourceLabel: meetings.sourceLabel,
      transcript: meetings.transcript,
      transcriptionStatus: meetings.transcriptionStatus,
      transcriptionError: meetings.transcriptionError,
      transcriptionProvider: meetings.transcriptionProvider,
      audioFileName: meetings.audioFileName,
    })
    .from(meetings)
    .where(eq(meetings.id, args.id))
    .limit(1);
  return row ?? null;
}

// ---------- WRITE : import d'un transcript ----------

/**
 * Une personne présente, dans l'une des trois formes acceptées par
 * `meeting_participants` (cf. contrainte `meeting_participants_target_chk`).
 * Objet à plat plutôt qu'une union : les clients MCP rendent mal un
 * `anyOf` et finissent par n'envoyer aucun participant.
 */
const meetingParticipantInputSchema = z
  .object({
    userId: z.string().uuid().optional(),
    contactId: z.string().uuid().optional(),
    /** Nom brut, quand la personne n'a pas (encore) de fiche. */
    displayName: z.string().min(1).max(120).optional(),
    role: z.string().max(120).optional(),
  })
  .refine(
    (p) => [p.userId, p.contactId, p.displayName].filter(Boolean).length === 1,
    "Chaque participant porte exactement un de : userId, contactId, displayName.",
  );

/** Même plafond que le formulaire d'import côté UI. */
const TRANSCRIPT_MAX = 500_000;

export const createMeetingSchema = z.object({
  title: z.string().min(1).max(200),
  transcript: z.string().min(20).max(TRANSCRIPT_MAX),
  /** Date (YYYY-MM-DD) ou datetime ISO 8601. À défaut : maintenant. */
  occurredAt: z.string().optional(),
  /** Provenance lisible du transcript. Défaut : "MCP". */
  sourceLabel: z.string().max(200).optional(),
  projectId: z.string().uuid().optional(),
  participants: z.array(meetingParticipantInputSchema).max(50).optional(),
});

/**
 * Crée une réunion à partir d'un transcript texte — l'équivalent MCP de
 * l'onglet « Coller le texte » de /meetings/nouveau.
 *
 * L'extraction LLM n'est pas lancée ici : elle vit côté Next (SDK ai +
 * réglages modèle), hors du périmètre de ce module, et coûte plusieurs
 * dizaines de secondes. Le tool `extract_meeting` (transport HTTP) la
 * déclenche dans un second appel.
 */
export async function createMeeting(args: z.infer<typeof createMeetingSchema>, ctx: UserContext) {
  const occurredAt = parseOccurredAt(args.occurredAt);
  const conn = db();

  const row = await conn.transaction(async (tx) => {
    const [m] = await tx
      .insert(meetings)
      .values({
        title: args.title,
        transcript: args.transcript,
        occurredAt,
        sourceLabel: args.sourceLabel ?? "MCP",
        projectId: args.projectId ?? null,
        createdBy: ctx.userId,
      })
      .returning({ id: meetings.id, title: meetings.title });
    if (!m) return null;
    // Les participants partent en base dans la foulée : l'extraction les
    // lit pour lever l'ambiguïté des prénoms seuls dans le transcript.
    await insertMeetingParticipants(tx, m.id, args.participants ?? [], ctx.userId);
    return m;
  });
  if (!row) throw new Error("Création de la réunion échouée.");

  return {
    id: row.id,
    title: row.title,
    status: "ingested" as const,
    transcriptLength: args.transcript.length,
    participants: args.participants?.length ?? 0,
    nextStep:
      "Résumé et propositions ne sont pas encore générés : appelle `extract_meeting` avec cet id.",
  };
}

export const setMeetingTranscriptSchema = z.object({
  id: z.string().uuid(),
  transcript: z.string().min(1).max(TRANSCRIPT_MAX),
  /** `replace` (défaut) écrase, `append` ajoute à la suite. */
  mode: z.enum(["replace", "append"]).optional(),
  /**
   * Requis pour écraser un transcript déjà rempli : c'est une perte de
   * données, l'utilisateur doit l'avoir demandé explicitement.
   */
  confirmed: z.boolean().optional(),
});

/**
 * Pose ou complète le transcript d'une réunion existante : fiche créée
 * sans texte (import audio en échec, réunion ouverte à la main), ou
 * seconde partie de réunion à ajouter.
 */
export async function setMeetingTranscript(args: z.infer<typeof setMeetingTranscriptSchema>) {
  const conn = db();
  const [meeting] = await conn
    .select({ id: meetings.id, title: meetings.title, transcript: meetings.transcript })
    .from(meetings)
    .where(eq(meetings.id, args.id))
    .limit(1);
  if (!meeting) throw new Error("Meeting introuvable.");

  const existing = meeting.transcript ?? "";
  const mode = args.mode ?? "replace";
  if (mode === "replace" && existing.trim().length > 0 && args.confirmed !== true) {
    throw new Error(
      `« ${meeting.title} » a déjà un transcript (${existing.length} caractères). L'écraser demande confirmed=true — demande à l'utilisateur, ou passe mode='append'.`,
    );
  }

  const transcript =
    mode === "append" && existing.length > 0
      ? `${existing}\n\n${args.transcript}`
      : args.transcript;
  if (transcript.length > TRANSCRIPT_MAX) {
    throw new Error(`Transcript trop long après ajout (${transcript.length} > ${TRANSCRIPT_MAX}).`);
  }

  await conn
    .update(meetings)
    .set({ transcript, updatedAt: new Date() })
    .where(eq(meetings.id, args.id));

  return {
    id: args.id,
    mode,
    transcriptLength: transcript.length,
    nextStep: "Appelle `extract_meeting` pour (re)générer résumé et propositions.",
  };
}

/** Date de réunion : `YYYY-MM-DD`, datetime ISO, ou maintenant à défaut. */
function parseOccurredAt(raw: string | undefined): Date {
  if (!raw) return new Date();
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`occurredAt invalide : "${raw}". Attendu YYYY-MM-DD ou datetime ISO 8601.`);
  }
  return d;
}

/**
 * Insère les participants déclarés. `onConflictDoNothing` couvre les
 * index uniques partiels (un même user / contact / nom une seule fois par
 * réunion) : un doublon dans l'appel ne fait pas échouer l'import.
 */
async function insertMeetingParticipants(
  tx: Pick<Database, "insert">,
  meetingId: string,
  participants: z.infer<typeof meetingParticipantInputSchema>[],
  addedBy: string,
) {
  if (participants.length === 0) return;
  await tx
    .insert(meetingParticipants)
    .values(
      participants.map((p) => ({
        meetingId,
        userId: p.userId ?? null,
        contactId: p.contactId ?? null,
        displayName: p.displayName ?? null,
        role: p.role ?? null,
        source: "manual" as const,
        addedBy,
      })),
    )
    .onConflictDoNothing();
}
