import "server-only";

import { contacts } from "@/db/schema/contacts";
import { meetingParticipants } from "@/db/schema/meeting-participants";
import { getMeetingParticipants } from "@/lib/db/queries/meeting-participants";
import { db } from "@/lib/db/server";
import { sanitizeNameInput } from "@/lib/format";
import { type ParticipantContext, fuzzyMatchContact, fuzzyMatchUser } from "@/lib/meetings/extract";
import { sql } from "drizzle-orm";

/** Ce que le LLM sait d'une personne citée dans le transcript. */
export type ExtractedAttendee = { name: string; email: string | null; role: string | null };

/**
 * Participants d'une réunion mis en forme pour le prompt d'extraction.
 * `internal` = membre Paradeos, `external` = contact CRM, `unknown` =
 * nom brut pas encore rattaché à une fiche.
 */
export async function getParticipantContext(meetingId: string): Promise<ParticipantContext[]> {
  const conn = await db();
  const rows = await getMeetingParticipants(conn, meetingId);
  return rows.map((r) => ({
    name: r.name,
    kind: r.kind === "user" ? "internal" : r.kind === "contact" ? "external" : "unknown",
    role: r.role,
    entityName: r.kind === "user" ? null : r.entityName,
  }));
}

/**
 * Enregistre les personnes citées par le LLM comme participants, en les
 * rattachant quand c'est possible : email exact d'un contact, puis fuzzy
 * match sur les membres de l'équipe, puis sur les contacts. Sans match,
 * le nom est gardé brut — visible côté UI, remplaçable en un clic par
 * une vraie fiche.
 *
 * Purement additif : une ré-extraction n'efface jamais un participant
 * ajouté à la main (ni un ajout d'une extraction précédente qui aurait
 * été corrigé depuis). Retirer quelqu'un reste une action humaine.
 */
export async function syncParticipantsFromAttendees(
  meetingId: string,
  attendees: ExtractedAttendee[],
): Promise<{ added: number }> {
  if (attendees.length === 0) return { added: 0 };

  const conn = await db();
  const existing = await getMeetingParticipants(conn, meetingId);
  const linkedUserIds = new Set(existing.filter((p) => p.kind === "user").map((p) => p.refId));
  const linkedContactIds = new Set(
    existing.filter((p) => p.kind === "contact").map((p) => p.refId),
  );
  const seenNames = new Set(existing.map((p) => p.name.trim().toLowerCase()));

  let added = 0;
  for (const raw of attendees) {
    const name = sanitizeNameInput(raw.name).trim();
    if (name.length < 2) continue;
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;

    const role = raw.role && raw.role.trim().length > 0 ? raw.role.trim() : null;
    const target = await resolveAttendee(name, raw.email);

    if (target.kind === "user") {
      if (linkedUserIds.has(target.id)) continue;
      linkedUserIds.add(target.id);
    } else if (target.kind === "contact") {
      if (linkedContactIds.has(target.id)) continue;
      linkedContactIds.add(target.id);
    }
    seenNames.add(key);

    const [row] = await conn
      .insert(meetingParticipants)
      .values({
        meetingId,
        userId: target.kind === "user" ? target.id : null,
        contactId: target.kind === "contact" ? target.id : null,
        displayName: target.kind === "name" ? name : null,
        role,
        source: "extraction",
      })
      .onConflictDoNothing()
      .returning({ id: meetingParticipants.id });
    if (row) added++;
  }

  return { added };
}

type AttendeeTarget = { kind: "user" | "contact"; id: string } | { kind: "name" };

/**
 * Seuils : l'email exact prime, puis l'équipe (liste courte, un prénom
 * suffit à trancher), puis les contacts. 0.5 côté users — en dessous, un
 * homonyme client se ferait passer pour un collègue.
 */
async function resolveAttendee(name: string, email: string | null): Promise<AttendeeTarget> {
  const conn = await db();

  if (email?.includes("@")) {
    const [row] = await conn
      .select({ id: contacts.id })
      .from(contacts)
      .where(sql`lower(${contacts.email}) = lower(${email.trim()})`)
      .limit(1);
    if (row) return { kind: "contact", id: row.id };
  }

  const userMatch = await fuzzyMatchUser(name, 0.5);
  if (userMatch) return { kind: "user", id: userMatch.id };

  const parts = name.split(/\s+/);
  const firstName = parts[0] ?? name;
  const lastName = parts.slice(1).join(" ") || parts[0] || "";
  const contactMatch = await fuzzyMatchContact(firstName, lastName);
  if (contactMatch) return { kind: "contact", id: contactMatch.id };

  return { kind: "name" };
}
