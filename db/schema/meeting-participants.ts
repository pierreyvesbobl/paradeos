import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { contacts } from "./contacts";
import { meetings } from "./meetings";
import { users } from "./users";

/**
 * Origine d'un participant :
 *  - `manual`     : ajouté à la main depuis la fiche réunion
 *  - `extraction` : déduit du transcript par le LLM (`attendees`)
 */
export const meetingParticipantSource = pgEnum("meeting_participant_source", [
  "manual",
  "extraction",
]);

/**
 * Personnes présentes à une réunion. Trois formes, mutuellement
 * exclusives (contrainte `meeting_participants_target_chk` côté SQL) :
 *
 *  - `userId`      : membre de l'équipe Paradeos
 *  - `contactId`   : personne côté client / partenaire / fournisseur
 *  - `displayName` : nom brut, quand le transcript cite quelqu'un qui n'a
 *    pas encore de fiche. Sert de mémo : l'utilisateur remplace le jeton
 *    par un vrai contact quand il le crée.
 *
 * Les participants sont réinjectés dans le prompt d'extraction : savoir
 * qui était dans la pièce lève l'ambiguïté des prénoms seuls et des « je
 * m'en occupe » (cf. `lib/meetings/participants.ts`).
 */
export const meetingParticipants = pgTable(
  "meeting_participants",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    meetingId: uuid("meeting_id")
      .notNull()
      .references(() => meetings.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
    /** Renseigné seulement si ni `userId` ni `contactId`. */
    displayName: text("display_name"),
    /** Rôle tel qu'énoncé dans la réunion (« CTO côté client »…). */
    role: text("role"),
    source: meetingParticipantSource("source").notNull().default("manual"),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().default(sql`now()`),
  },
  (t) => ({
    meetingIdx: index("meeting_participants_meeting_idx").on(t.meetingId),
    contactIdx: index("meeting_participants_contact_idx").on(t.contactId),
    userIdx: index("meeting_participants_user_idx").on(t.userId),
    // Uniques partiels : un même user / contact ne peut figurer qu'une
    // fois par réunion, sans bloquer les lignes en nom libre.
    userUnique: uniqueIndex("meeting_participants_user_unique")
      .on(t.meetingId, t.userId)
      .where(sql`user_id is not null`),
    contactUnique: uniqueIndex("meeting_participants_contact_unique")
      .on(t.meetingId, t.contactId)
      .where(sql`contact_id is not null`),
    nameUnique: uniqueIndex("meeting_participants_name_unique")
      .on(t.meetingId, sql`lower(display_name)`)
      .where(sql`display_name is not null`),
  }),
);

export type MeetingParticipant = typeof meetingParticipants.$inferSelect;
export type NewMeetingParticipant = typeof meetingParticipants.$inferInsert;
