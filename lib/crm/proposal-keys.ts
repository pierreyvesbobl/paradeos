import { compactNameKey, normalizeEmail, personCompactKey } from "@/lib/crm/name-key";

export type ProposalKind = "entity" | "contact" | "project" | "task";

/**
 * Clés de comparaison, alignées sur celles de /inbox (`lib/db/queries/inbox.ts`)
 * pour qu'une proposition écartée ici soit bien celle que l'inbox aurait
 * regroupée.
 */
export const proposalDedupeKey = {
  entity: (name: string | null | undefined) => compactNameKey(name),
  project: (name: string | null | undefined) => compactNameKey(name),
  /** L'email primme : c'est l'identité forte d'une personne. */
  contact: (payload: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
  }) => normalizeEmail(payload.email) || personCompactKey(payload.firstName, payload.lastName),
  task: (title: string | null | undefined, projectId: string | null) =>
    `${compactNameKey(title)}:${projectId ?? ""}`,
};

/** Clé d'un payload de proposition stocké. */
export function payloadKey(kind: ProposalKind, payload: unknown): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  if (kind === "entity") return proposalDedupeKey.entity(str(p.name));
  if (kind === "project") return proposalDedupeKey.project(str(p.name));
  if (kind === "contact") {
    return proposalDedupeKey.contact({
      firstName: str(p.firstName),
      lastName: str(p.lastName),
      email: str(p.email),
    });
  }
  return proposalDedupeKey.task(str(p.title), str(p.projectId));
}
