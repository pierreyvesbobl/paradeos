import { compactNameKey, normalizeEmail, personCompactKey } from "@/lib/crm/name-key";
import { MATCH_THRESHOLD, pickBestMatch } from "@/lib/crm/pick";

export type ProposalKind = "entity" | "contact" | "project" | "task" | "task_completion";

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
  /** Une clôture vise une tâche précise : la clé est son id. */
  task_completion: (taskId: string | null | undefined) => taskId ?? "",
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
  if (kind === "task_completion") return proposalDedupeKey.task_completion(str(p.taskId));
  return proposalDedupeKey.task(str(p.title), str(p.projectId));
}

/** Ligne de proposition déjà tranchée (`accepted` / `rejected`) d'une source. */
export type DecidedProposalRow = {
  kind: string;
  payload: unknown;
  matchedId: string | null;
  status: string;
  createdEntityId: string | null;
};

/**
 * Clé de n'importe quelle proposition, y compris les kinds propres aux
 * mails. Les liaisons se comparent sur la cible proposée ; un brouillon de
 * réponse ou une catégorie est unique par source, la clé est le kind seul.
 */
export function anyProposalKey(kind: string, payload: unknown, matchedId: string | null): string {
  const p = (payload ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  switch (kind) {
    case "entity":
    case "contact":
    case "project":
    case "task":
    case "task_completion":
      return `${kind}:${payloadKey(kind, payload)}`;
    case "project_link":
      return `${kind}:${matchedId ?? str(p.suggestedProjectId) ?? ""}`;
    case "entity_link":
      return `${kind}:${matchedId ?? str(p.suggestedEntityId) ?? ""}`;
    case "project_contact_link":
      return `${kind}:${str(p.contactId) ?? ""}:${str(p.projectId) ?? ""}`;
    default:
      return kind;
  }
}

/**
 * Ce qu'une source a déjà tranché. La ré-extraction d'une réunion ou d'un
 * mail garde ces lignes : une proposition refusée ne revient pas dans
 * l'inbox, une proposition acceptée n'est pas re-proposée — et si c'était
 * une tâche, la tâche créée reçoit ce que la nouvelle passe en dit.
 */
export class DecidedProposals {
  private readonly byKey = new Map<string, DecidedProposal>();
  /** Titres des tâches tranchées, pour le rapprochement flou. */
  private readonly taskTitles: { id: string; name: string }[] = [];
  private readonly taskById = new Map<string, DecidedProposal>();
  /** Tâches créées par acceptation d'une proposition de cette source. */
  readonly acceptedTaskIds = new Set<string>();

  constructor(rows: DecidedProposalRow[]) {
    for (const r of rows) {
      if (r.status === "pending") continue;
      const key = anyProposalKey(r.kind, r.payload, r.matchedId);
      const decided = { status: r.status, createdEntityId: r.createdEntityId };
      if (!this.byKey.has(key)) this.byKey.set(key, decided);
      if (r.kind === "task") {
        const title = (r.payload as { title?: unknown } | null)?.title;
        if (typeof title === "string" && title.trim()) {
          const id = String(this.taskTitles.length);
          this.taskTitles.push({ id, name: title });
          this.taskById.set(id, decided);
        }
        if (r.status === "accepted" && r.createdEntityId) {
          this.acceptedTaskIds.add(r.createdEntityId);
        }
      }
    }
  }

  get size(): number {
    return this.byKey.size;
  }

  /**
   * La ligne tranchée équivalente, s'il y en a une. Pour une tâche, la
   * clé exacte ne suffit pas : d'une passe à l'autre le modèle reformule
   * le titre (« produits vendus en matching EAN » devient « produits en
   * matching EAN »), et un refus reformulé n'est pas un nouveau besoin. On
   * compare donc aussi les titres avec le même seuil que les tâches
   * ouvertes.
   */
  find(kind: string, payload: unknown, matchedId: string | null): DecidedProposal | null {
    const exact = this.byKey.get(anyProposalKey(kind, payload, matchedId));
    if (exact || kind !== "task") return exact ?? null;
    const title = (payload as { title?: unknown } | null)?.title;
    if (typeof title !== "string") return null;
    const match = pickBestMatch(this.taskTitles, title, MATCH_THRESHOLD.task);
    return match ? (this.taskById.get(match.id) ?? null) : null;
  }
}

export type DecidedProposal = { status: string; createdEntityId: string | null };
