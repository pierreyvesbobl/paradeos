import {
  acceptEmailProposal,
  rejectEmailProposal,
  revertEmailProposal,
  updateAcceptedEmailProposal,
} from "@/lib/actions/email-proposals";
import { decideProposal, revertProposal, updateAcceptedProposal } from "@/lib/actions/meetings";
import type { ProposalKind, ProposalSource, ProposalSourceAdapter } from "./types";

/**
 * Les deux sources de propositions, décrites par un adapter. Le panneau
 * reçoit le nom de la source (une string, sérialisable depuis une page
 * serveur) et résout l'adapter ici, côté client.
 */

const EMAIL_SUCCESS: Record<ProposalKind, string> = {
  task: "Tâche créée.",
  project: "Projet créé.",
  opportunity: "Opportunité créée.",
  contact: "Contact créé.",
  entity: "Entité créée.",
  project_link: "Thread rattaché au projet.",
  entity_link: "Entité rattachée.",
  project_contact_link: "Contact rattaché au projet.",
  draft_reply: "Brouillon poussé dans Gmail.",
};

const emailSource: ProposalSourceAdapter = {
  // Actions humaines en premier (task, project, contact, entity), puis les
  // rattachements (project_link). Le draft_reply est traité à part, au-dessus
  // du panneau, par `EmailProposalsPanel`.
  kindOrder: ["task", "project", "contact", "entity", "project_link"],
  actions: {
    accept: (proposalId, payloadOverride) =>
      acceptEmailProposal({ proposalId, payloadOverride: payloadOverride ?? null }),
    reject: (proposalId) => rejectEmailProposal({ proposalId }),
    revert: (proposalId) => revertEmailProposal({ proposalId }),
    update: (proposalId, payload) => updateAcceptedEmailProposal({ proposalId, payload }),
  },
  taskAssigneeField: "multi",
  // Pour un project_link pending matched, « valider » = poser le
  // rattachement ; les autres kinds matchés n'ont rien à valider.
  matchedRowAction: (p) => (p.kind === "project_link" ? "apply" : "none"),
  labels: {
    // Le wrapper email affiche déjà une carte d'état d'extraction.
    emptyState: null,
    bulkAccept: "Tout valider",
    acceptedTitle: "Validé · créé/appliqué",
    rejectedTitle: "Invalidé",
    alreadyInDbHint:
      "Reconnus dans la base et liés à ce fil. Rien à valider — intervenez si le match est faux.",
    acceptToast: (kind) => EMAIL_SUCCESS[kind],
  },
};

const meetingSource: ProposalSourceAdapter = {
  kindOrder: ["task", "opportunity", "project", "contact", "entity"],
  actions: {
    accept: (proposalId, payloadOverride) =>
      decideProposal({ proposalId, action: "accept", payloadOverride }),
    reject: (proposalId) => decideProposal({ proposalId, action: "reject" }),
    revert: (proposalId) => revertProposal({ proposalId }),
    update: (proposalId, payload) => updateAcceptedProposal({ proposalId, payload }),
  },
  // `decideProposal` ne lit que les colonnes mono legacy pour les tâches.
  taskAssigneeField: "single",
  // « Mauvaise fiche » : détache le match, la proposition revient dans « À valider ».
  matchedRowAction: () => "detach",
  labels: {
    emptyState:
      'Aucune proposition. Lance "Ré-extraire" pour générer le résumé et les propositions.',
    bulkAccept: "Tout créer",
    acceptedTitle: "Validé · créé dans la base",
    rejectedTitle: "Invalidé · non créé",
    alreadyInDbHint:
      "Reconnus dans la base et liés à cette réunion. Rien à valider — intervenez seulement si la correspondance est fausse.",
    acceptToast: () => "Accepté.",
  },
};

export const PROPOSAL_SOURCES: Record<ProposalSource, ProposalSourceAdapter> = {
  email: emailSource,
  meeting: meetingSource,
};
