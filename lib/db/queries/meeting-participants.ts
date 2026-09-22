import { asc, eq, sql } from "drizzle-orm";
import type { Database } from "../../../db/client";

/** Connexion top-level ou transaction — même API `select`. */
type DbOrTx = Pick<Database, "select">;
import { contacts } from "../../../db/schema/contacts";
import { entities } from "../../../db/schema/entities";
import { meetingParticipants } from "../../../db/schema/meeting-participants";
import { users } from "../../../db/schema/users";
import { formatPersonName } from "../../format";

export type MeetingParticipantRow = {
  /** Id de la ligne de liaison — c'est lui qu'on retire, pas l'id du record. */
  id: string;
  kind: "user" | "contact" | "name";
  /** Id du user / contact lié, null pour un participant en nom libre. */
  refId: string | null;
  name: string;
  /** Rôle énoncé en réunion, à défaut le poste de la fiche contact. */
  role: string | null;
  email: string | null;
  entityName: string | null;
  avatarUrl: string | null;
  source: "manual" | "extraction";
};

/**
 * Participants d'une réunion : équipe d'abord, puis contacts, puis noms
 * bruts, chaque groupe par ordre alphabétique. Une seule requête — les
 * trois formes de participant vivent dans la même table.
 *
 * Prend la connexion en argument pour servir aussi bien les pages Next
 * que le serveur MCP (cf. `fetchAssigneesForTasks`).
 */
export async function getMeetingParticipants(
  conn: DbOrTx,
  meetingId: string,
): Promise<MeetingParticipantRow[]> {
  const rows = await conn
    .select({
      id: meetingParticipants.id,
      userId: meetingParticipants.userId,
      contactId: meetingParticipants.contactId,
      displayName: meetingParticipants.displayName,
      role: meetingParticipants.role,
      source: meetingParticipants.source,
      userName: users.fullName,
      avatarUrl: users.avatarUrl,
      contactFirstName: contacts.firstName,
      contactLastName: contacts.lastName,
      contactEmail: contacts.email,
      contactJobTitle: contacts.jobTitle,
      entityName: entities.name,
    })
    .from(meetingParticipants)
    .leftJoin(users, eq(users.id, meetingParticipants.userId))
    .leftJoin(contacts, eq(contacts.id, meetingParticipants.contactId))
    .leftJoin(entities, eq(entities.id, contacts.entityId))
    .where(eq(meetingParticipants.meetingId, meetingId))
    .orderBy(
      // L'équipe en tête : c'est la lecture naturelle d'un compte-rendu
      // interne (« nous », puis « eux »).
      sql`case when ${meetingParticipants.userId} is not null then 0
               when ${meetingParticipants.contactId} is not null then 1
               else 2 end`,
      asc(
        sql`lower(coalesce(${users.fullName}, ${contacts.lastName}, ${meetingParticipants.displayName}))`,
      ),
    );

  return rows.map((r) => {
    if (r.userId) {
      return {
        id: r.id,
        kind: "user" as const,
        refId: r.userId,
        name: r.userName ?? "(sans nom)",
        role: r.role,
        email: null,
        entityName: "Paradeos",
        avatarUrl: r.avatarUrl,
        source: r.source,
      };
    }
    if (r.contactId) {
      return {
        id: r.id,
        kind: "contact" as const,
        refId: r.contactId,
        name: formatPersonName(r.contactFirstName, r.contactLastName, "(sans nom)"),
        role: r.role ?? r.contactJobTitle,
        email: r.contactEmail,
        entityName: r.entityName,
        avatarUrl: null,
        source: r.source,
      };
    }
    return {
      id: r.id,
      kind: "name" as const,
      refId: null,
      name: r.displayName ?? "(sans nom)",
      role: r.role,
      email: null,
      entityName: null,
      avatarUrl: null,
      source: r.source,
    };
  });
}
