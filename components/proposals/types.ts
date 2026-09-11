import type { ActionResult } from "@/lib/actions/action";

/**
 * Union des kinds des deux sources (email + meeting). Un kind absent de
 * `kindOrder` dans l'adapter n'est jamais affiché par le panneau — c'est
 * ainsi que `draft_reply` (traité à part côté email) ou les rattachements
 * historiques (`entity_link`, `project_contact_link`) restent hors écran.
 */
export type ProposalKind =
  | "task"
  | "project"
  | "opportunity"
  | "contact"
  | "entity"
  | "project_link"
  | "entity_link"
  | "project_contact_link"
  | "draft_reply";

export type ProposalStatus = "pending" | "accepted" | "rejected";

/**
 * Forme structurelle commune à `EmailProposal` et `MeetingProposal`. Les
 * deux types Drizzle y sont assignables ; le panneau ne renvoie jamais une
 * proposition au parent, il n'a donc pas besoin d'être générique.
 */
export type Proposal = {
  id: string;
  kind: ProposalKind;
  payload: unknown;
  matchedId: string | null;
  matchConfidence: string | null;
  status: ProposalStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  /** Noms résolus côté serveur du record matché (renseignés par la source email). */
  matchedProjectName?: string | null;
  matchedContactName?: string | null;
  matchedEntityName?: string | null;
};

export type ProjectOption = { id: string; name: string };
export type UserOption = { id: string; fullName: string | null; avatarUrl?: string | null };
export type NamedOption = { id: string; name: string };
export type TitledOption = { id: string; title: string };
export type ContactOption = { id: string; fullName: string; entityName?: string | null };

/** Référentiels proposés dans l'éditeur (liaison à un existant, FK). */
export type LinkOptions = {
  projects: ProjectOption[];
  users: UserOption[];
  entities: NamedOption[];
  contacts: ContactOption[];
  /** Tâches liables à une proposition de tâche. Absent = pas de picker. */
  existingTasks?: TitledOption[];
};

export type ProposalSource = "email" | "meeting";

/** Action possible sur une ligne « Déjà en base » (pending + matched). */
export type MatchedRowAction = "apply" | "detach" | "none";

/**
 * Tout ce qui distingue une source de propositions d'une autre. Le
 * panneau et ses sous-composants ne connaissent la source qu'à travers
 * cet objet — jamais par des `if (source === …)`.
 */
export type ProposalSourceAdapter = {
  /** Kinds affichés, dans l'ordre des sections. */
  kindOrder: ProposalKind[];
  actions: {
    accept: (
      proposalId: string,
      payloadOverride?: Record<string, unknown>,
    ) => Promise<ActionResult<unknown>>;
    reject: (proposalId: string) => Promise<ActionResult<unknown>>;
    revert: (proposalId: string) => Promise<ActionResult<unknown>>;
    /**
     * « Mauvaise fiche » : remet en attente ET efface le match auto.
     * Optionnel — les sources sans `matchedRowAction: "detach"` n'en ont
     * pas besoin ; à défaut, `revert` est utilisé.
     */
    detach?: (proposalId: string) => Promise<ActionResult<unknown>>;
    update: (
      proposalId: string,
      payload: Record<string, unknown>,
    ) => Promise<ActionResult<unknown>>;
  };
  /**
   * Format d'assignés que l'action `accept` sait lire pour une tâche :
   * `multi` = tableau `assignees[]` (task_assignees), `single` = colonnes
   * legacy `assigneeId` / `assigneeContactId`.
   */
  taskAssigneeField: "multi" | "single";
  /** Action proposée sur une ligne « Déjà en base », selon la proposition. */
  matchedRowAction: (proposal: Proposal) => MatchedRowAction;
  labels: {
    /** Message quand il n'y a aucune proposition ; `null` = ne rien rendre. */
    emptyState: string | null;
    bulkAccept: string;
    acceptedTitle: string;
    rejectedTitle: string;
    alreadyInDbHint: string;
    acceptToast: (kind: ProposalKind) => string;
  };
};
