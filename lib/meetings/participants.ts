import "server-only";

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { contacts } from "@/db/schema/contacts";
import { googleAccounts } from "@/db/schema/google-accounts";
import { meetingParticipants } from "@/db/schema/meeting-participants";
import { users } from "@/db/schema/users";
import { contactHasEmail } from "@/lib/crm/contact-emails";
import { fuzzyMatchContact, fuzzyMatchUser } from "@/lib/crm/match";
import { getMeetingParticipants } from "@/lib/db/queries/meeting-participants";
import { db } from "@/lib/db/server";
import { sanitizeNameInput } from "@/lib/format";
import type { ParticipantContext } from "@/lib/meetings/extract";

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
 *
 * `source` distingue ce que le modèle a déduit de ce qu'un humain a
 * déclaré — une liste écrite en tête d'un mail de réunion, par exemple,
 * vaut mieux qu'une déduction et doit le rester à l'affichage.
 */
export async function syncParticipantsFromAttendees(
  meetingId: string,
  attendees: ExtractedAttendee[],
  source: "manual" | "extraction" = "extraction",
): Promise<{ added: number }> {
  if (attendees.length === 0) return { added: 0 };

  const conn = await db();
  const existing = await getMeetingParticipants(conn, meetingId);
  const linkedUserIds = new Set(existing.filter((p) => p.kind === "user").map((p) => p.refId));
  const linkedContactIds = new Set(
    existing.filter((p) => p.kind === "contact").map((p) => p.refId),
  );
  const seenNames = new Set(existing.map((p) => p.name.trim().toLowerCase()));
  const existingByName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));

  let added = 0;
  for (const raw of attendees) {
    const name = sanitizeNameInput(raw.name).trim();
    if (name.length < 2) continue;
    const key = name.toLowerCase();

    const role = raw.role && raw.role.trim().length > 0 ? raw.role.trim() : null;
    const target = await resolveAttendee(name, raw.email);

    if (seenNames.has(key)) {
      // Un membre de l'équipe déjà présent sous une fiche contact
      // homonyme (ou en nom brut) reprend sa vraie identité : la ligne
      // est requalifiée, pas doublée.
      const prior = existingByName.get(key);
      if (
        target.kind === "user" &&
        prior &&
        prior.kind !== "user" &&
        !linkedUserIds.has(target.id)
      ) {
        await conn
          .update(meetingParticipants)
          .set({ userId: target.id, contactId: null, displayName: null })
          .where(eq(meetingParticipants.id, prior.id));
        linkedUserIds.add(target.id);
      }
      continue;
    }

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
        source,
      })
      .onConflictDoNothing()
      .returning({ id: meetingParticipants.id });
    if (row) added++;
  }

  return { added };
}

type AttendeeTarget = { kind: "user" | "contact"; id: string } | { kind: "name" };

/**
 * Ordre : l'équipe d'abord, par le mail de son compte Google puis par son
 * nom quand il est net ; ensuite l'email exact d'un contact ; puis
 * l'équipe au seuil large (liste courte, un prénom suffit) ; enfin les
 * contacts. Un membre de l'équipe peut avoir une fiche contact homonyme
 * (il est aussi coworker, ou importé d'un carnet) : la fiche ne doit
 * jamais lui voler sa place dans une réunion. 0.5 côté users en dernier
 * recours — en dessous, un homonyme client se ferait passer pour un
 * collègue.
 */
async function resolveAttendee(name: string, email: string | null): Promise<AttendeeTarget> {
  const conn = await db();

  if (email?.includes("@")) {
    const teamUser = await findTeamUserByEmail(email);
    if (teamUser) return { kind: "user", id: teamUser };
  }

  const certainUser = await fuzzyMatchUser(name, 0.9);
  if (certainUser) return { kind: "user", id: certainUser.id };

  if (email?.includes("@")) {
    const [row] = await conn
      .select({ id: contacts.id })
      .from(contacts)
      .where(contactHasEmail(email))
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

/**
 * Membre de l'équipe dont le compte Google porte cette adresse. `users`
 * n'a pas de colonne email : l'adresse connue est celle du compte
 * connecté (`google_accounts`), qui est aussi celle qui apparaît dans les
 * transcripts Meet et les invitations.
 */
export async function findTeamUserByEmail(email: string): Promise<string | null> {
  const conn = await db();
  const [row] = await conn
    .select({ id: users.id })
    .from(googleAccounts)
    .innerJoin(users, eq(users.id, googleAccounts.userId))
    .where(sql`lower(${googleAccounts.email}) = lower(${email.trim()})`)
    .limit(1);
  return row?.id ?? null;
}

/**
 * Retire d'une réunion la fiche contact homonyme d'un membre de l'équipe
 * qui vient d'y être ajouté : la personne est là une fois, sous son
 * compte. Renvoie le nombre de lignes retirées.
 */
export async function dropHomonymContactParticipant(
  meetingId: string,
  userFullName: string,
): Promise<number> {
  const conn = await db();
  const rows = await conn
    .delete(meetingParticipants)
    .where(
      and(
        eq(meetingParticipants.meetingId, meetingId),
        isNotNull(meetingParticipants.contactId),
        sql`${meetingParticipants.contactId} in (
          select ${contacts.id} from ${contacts}
          where lower(trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, ''))) = lower(trim(${userFullName}))
        )`,
      ),
    )
    .returning({ id: meetingParticipants.id });
  return rows.length;
}

/**
 * Vrai si un membre de l'équipe homonyme de ce contact est déjà participant
 * de la réunion : ajouter la fiche contact ferait apparaître la même
 * personne deux fois.
 */
export async function hasHomonymTeamParticipant(
  meetingId: string,
  contactId: string,
): Promise<boolean> {
  const conn = await db();
  const [row] = await conn
    .select({ id: meetingParticipants.id })
    .from(meetingParticipants)
    .innerJoin(users, eq(users.id, meetingParticipants.userId))
    .innerJoin(contacts, eq(contacts.id, contactId))
    .where(
      and(
        eq(meetingParticipants.meetingId, meetingId),
        sql`lower(trim(${users.fullName})) = lower(trim(coalesce(${contacts.firstName}, '') || ' ' || coalesce(${contacts.lastName}, '')))`,
      ),
    )
    .limit(1);
  return Boolean(row);
}
