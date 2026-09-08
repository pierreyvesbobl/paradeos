"use client";

import type { InboxExtractionKind, InboxSource } from "@/lib/db/queries/inbox";
import {
  Buildings,
  CheckSquare,
  EnvelopeOpen,
  Link as LinkIcon,
  LinkedinLogo,
  Microphone,
  type Icon as PhosphorIcon,
  Receipt,
  Star,
  UserPlus,
} from "@phosphor-icons/react";

/**
 * Vocabulaire visuel partagé entre « À traiter » et « Historique » :
 * une extraction doit se reconnaître à l'identique dans les deux vues.
 */

export type KindDef = {
  key: InboxExtractionKind;
  label: string;
  actionLabel: string;
  /** Formulation au passé, pour l'historique (« Tâche créée »). */
  doneLabel: string;
  icon: PhosphorIcon;
  bg: string;
  textColor: string;
};

export const KINDS: KindDef[] = [
  {
    key: "task",
    label: "Tâches",
    actionLabel: "Nouvelle tâche",
    doneLabel: "Tâche créée",
    icon: CheckSquare,
    bg: "var(--ds-tint-blue-bg)",
    textColor: "var(--ds-tint-blue-text)",
  },
  {
    key: "contact",
    label: "Contacts",
    actionLabel: "Nouveau contact",
    doneLabel: "Contact créé",
    icon: UserPlus,
    bg: "var(--ds-tint-mauve-bg)",
    textColor: "var(--ds-tint-mauve-text)",
  },
  {
    key: "contact_match",
    label: "Rapprochements",
    actionLabel: "Rapprocher la relation",
    doneLabel: "Relation rapprochée",
    icon: UserPlus,
    bg: "var(--ds-tint-pink-bg)",
    textColor: "var(--ds-tint-pink-text)",
  },
  {
    key: "entity",
    label: "Entités",
    actionLabel: "Nouvelle entité",
    doneLabel: "Entité créée",
    icon: Buildings,
    bg: "var(--ds-tint-brown-bg)",
    textColor: "var(--ds-tint-brown-text)",
  },
  {
    key: "project",
    label: "Projets",
    actionLabel: "Nouveau projet",
    doneLabel: "Projet créé",
    icon: Star,
    bg: "var(--ds-tint-green-bg)",
    textColor: "var(--ds-tint-green-text)",
  },
  {
    key: "opportunity",
    label: "Opportunités",
    actionLabel: "Nouvelle opportunité",
    doneLabel: "Opportunité créée",
    icon: Star,
    bg: "var(--ds-tint-green-bg)",
    textColor: "var(--ds-tint-green-text)",
  },
  {
    key: "project_link",
    label: "Rattachements projet",
    actionLabel: "Rattacher au projet",
    doneLabel: "Rattaché au projet",
    icon: LinkIcon,
    bg: "var(--ds-tint-mauve-bg)",
    textColor: "var(--ds-tint-mauve-text)",
  },
  {
    key: "entity_link",
    label: "Rattachements entité",
    actionLabel: "Rattacher à l'entité",
    doneLabel: "Rattaché à l'entité",
    icon: LinkIcon,
    bg: "var(--ds-tint-mauve-bg)",
    textColor: "var(--ds-tint-mauve-text)",
  },
  {
    key: "project_contact_link",
    label: "Contacts projet",
    actionLabel: "Ajouter comme contact projet",
    doneLabel: "Ajouté aux contacts projet",
    icon: LinkIcon,
    bg: "var(--ds-tint-mauve-bg)",
    textColor: "var(--ds-tint-mauve-text)",
  },
  {
    key: "invoice_filing",
    label: "Factures fournisseurs",
    actionLabel: "Relancer le classement",
    doneLabel: "Facture classée",
    icon: Receipt,
    bg: "var(--ds-tint-yellow-bg)",
    textColor: "var(--ds-tint-yellow-text)",
  },
  {
    key: "quote_reconciliation",
    label: "Devis à rapprocher",
    actionLabel: "Rattacher au projet",
    doneLabel: "Devis rattaché",
    icon: Receipt,
    bg: "var(--ds-tint-yellow-bg)",
    textColor: "var(--ds-tint-yellow-text)",
  },
  {
    key: "invoice_reconciliation",
    label: "Factures clients à rapprocher",
    actionLabel: "Rattacher / créer jalon",
    doneLabel: "Facture rapprochée",
    icon: Receipt,
    bg: "var(--ds-tint-yellow-bg)",
    textColor: "var(--ds-tint-yellow-text)",
  },
];

export const KIND_BY_KEY: Record<InboxExtractionKind, KindDef> = KINDS.reduce(
  (acc, k) => {
    acc[k.key] = k;
    return acc;
  },
  {} as Record<InboxExtractionKind, KindDef>,
);

export const SOURCE_ICON: Record<InboxSource, PhosphorIcon> = {
  email: EnvelopeOpen,
  meeting: Microphone,
  filing: Receipt,
  reconciliation: Receipt,
  linkedin: LinkedinLogo,
};

export const SOURCE_LABEL: Record<InboxSource, string> = {
  email: "Email",
  meeting: "Meeting",
  filing: "Facture fournisseur",
  linkedin: "LinkedIn",
  reconciliation: "Dougs",
};

export const PRIORITY_STYLE: Record<
  string,
  { label: string; bg: string; text: string; dot: string }
> = {
  urgent: {
    label: "Urgent",
    bg: "var(--ds-tint-red-bg)",
    text: "var(--ds-tint-red-text)",
    dot: "var(--ds-tint-red-dot)",
  },
  high: {
    label: "Haute",
    bg: "var(--ds-tint-orange-bg)",
    text: "var(--ds-tint-orange-text)",
    dot: "var(--ds-tint-orange-dot)",
  },
  haute: {
    label: "Haute",
    bg: "var(--ds-tint-orange-bg)",
    text: "var(--ds-tint-orange-text)",
    dot: "var(--ds-tint-orange-dot)",
  },
  normal: {
    label: "Normale",
    bg: "var(--ds-tint-gray-bg)",
    text: "var(--ds-tint-gray-text)",
    dot: "var(--ds-tint-gray-dot)",
  },
  low: {
    label: "Basse",
    bg: "var(--ds-tint-gray-bg)",
    text: "var(--ds-tint-gray-text)",
    dot: "var(--ds-tint-gray-dot)",
  },
};

export function formatDueDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

const PROJECT_TINTS: string[] = [
  "var(--ds-tint-orange-dot)",
  "var(--ds-tint-blue-dot)",
  "var(--ds-tint-green-dot)",
  "var(--ds-tint-mauve-dot)",
  "var(--ds-tint-pink-dot)",
  "var(--ds-tint-yellow-dot)",
  "var(--ds-tint-brown-dot)",
  "var(--ds-tint-red-dot)",
];

export function projectTint(id: string, color: string | null | undefined): string {
  if (color && /^#[0-9a-fA-F]{6}$/.test(color)) return color;
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PROJECT_TINTS[h % PROJECT_TINTS.length] ?? "var(--ds-tint-blue-dot)";
}

export function MetaChip({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-ds-surface px-1.5 py-0 text-[10px] text-ds-text-muted">
      {icon}
      <span className="truncate">{label}</span>
    </span>
  );
}
