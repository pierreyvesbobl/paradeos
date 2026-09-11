"use client";

import { Label } from "@/components/ui/label";
import {
  ArrowBendUpLeft,
  ArrowCounterClockwise,
  Briefcase,
  Buildings,
  Check,
  ListChecks,
  PlusCircle,
  User,
  X,
} from "@phosphor-icons/react";
import type { ProposalKind } from "./types";

// Petites briques présentationnelles partagées par le panneau, ses lignes
// et l'éditeur. Aucune logique métier ici.

export function KindIcon({ kind }: { kind: ProposalKind }) {
  const props = {
    size: 16,
    weight: "duotone" as const,
    className: "flex-none text-[var(--ds-primary-500)]",
  };
  switch (kind) {
    case "task":
      return <ListChecks {...props} />;
    case "project":
    case "project_link":
    case "opportunity":
      return <Briefcase {...props} />;
    case "contact":
    case "project_contact_link":
      return <User {...props} />;
    case "entity":
    case "entity_link":
      return <Buildings {...props} />;
    case "draft_reply":
      return <ArrowBendUpLeft {...props} />;
  }
}

const KIND_NEW_LABEL: Partial<Record<ProposalKind, string>> = {
  task: "Nouvelle tâche",
  project: "Nouveau projet",
  opportunity: "Nouvelle opportunité",
  contact: "Nouveau contact",
  entity: "Nouvelle entité",
};

export function NewBadge({ kind }: { kind: ProposalKind }) {
  const label = KIND_NEW_LABEL[kind];
  if (!label) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
      style={{
        background: "var(--ds-tint-green-bg)",
        color: "var(--ds-tint-green-text)",
      }}
    >
      <PlusCircle size={11} weight="bold" />
      {label}
    </span>
  );
}

export function MatchBadge({ confidence }: { confidence: number | null }) {
  const pct = confidence != null ? `${Math.round(confidence * 100)}%` : "—";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold text-[11px]"
      style={{
        background: "var(--ds-tint-blue-bg)",
        color: "var(--ds-tint-blue-text)",
      }}
    >
      Match existant · {pct}
    </span>
  );
}

export function Tint({
  tint,
  label,
  icon,
}: {
  tint: "blue" | "yellow" | "green" | "red" | "gray" | "mauve";
  label: string;
  icon?: "reply";
}) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-medium text-[12px]"
      style={{
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
      }}
    >
      {icon === "reply" ? <ArrowBendUpLeft size={11} weight="bold" /> : null}
      {label}
    </span>
  );
}

export function CountPill({
  tint,
  label,
  dot,
  icon,
}: {
  tint: "yellow" | "green" | "red";
  label: string;
  dot?: boolean;
  icon?: "check" | "x";
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 font-semibold text-[12px]"
      style={{
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
      }}
    >
      {dot ? (
        <span
          className="inline-block size-1.5 rounded-full"
          style={{ background: `var(--ds-tint-${tint}-dot)` }}
        />
      ) : null}
      {icon === "check" ? <Check size={11} weight="bold" /> : null}
      {icon === "x" ? <X size={11} weight="bold" /> : null}
      {label}
    </span>
  );
}

/**
 * Bouton tinted dont le label apparaît au hover (animation max-width).
 * Cf. design v4 — icône seule par défaut, label glissé à côté quand on
 * survole. Évite que la rangée prenne 4 colonnes d'actions.
 */
export function HoverRevealButton({
  tint,
  label,
  icon,
  onClick,
  disabled,
  ring,
}: {
  tint: "red" | "green";
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  ring?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="group/hr inline-flex items-center rounded-md px-2.5 py-1.5 font-medium text-[13px] transition-colors disabled:opacity-50"
      style={{
        background: `var(--ds-tint-${tint}-bg)`,
        color: `var(--ds-tint-${tint}-text)`,
        boxShadow: ring ? `inset 0 0 0 1px var(--ds-tint-${tint}-dot)` : undefined,
      }}
    >
      {icon}
      <span className="ml-0 inline-block max-w-0 overflow-hidden whitespace-nowrap opacity-0 transition-[max-width,opacity,margin] duration-150 group-hover/hr:ml-1.5 group-hover/hr:max-w-[120px] group-hover/hr:opacity-100">
        {label}
      </span>
    </button>
  );
}

export function IconButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-[var(--ds-bg-hover)] hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Bouton « annuler la décision » des bandeaux validé / invalidé. */
export function RestoreButton({
  tint,
  title,
  onClick,
  disabled,
}: {
  tint: "green" | "red";
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className="inline-flex size-8 flex-none items-center justify-center rounded-md border bg-[var(--ds-bg-app)] transition-colors hover:bg-[var(--ds-bg-hover)] disabled:opacity-50"
      style={{
        borderColor: `var(--ds-tint-${tint}-dot)`,
        color: `var(--ds-tint-${tint}-text)`,
      }}
    >
      <ArrowCounterClockwise size={14} weight="bold" />
    </button>
  );
}

export function Field({
  label,
  htmlFor,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-1 ${className ?? ""}`}>
      <Label htmlFor={htmlFor} className="text-xs">
        {label}
      </Label>
      {children}
    </div>
  );
}
