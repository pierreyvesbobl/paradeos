"use client";

import { cn } from "@/lib/utils";
import {
  Briefcase,
  Buildings,
  CalendarDots,
  Circle,
  type Icon as PhosphorIcon,
  Receipt,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, forwardRef } from "react";
import { TINT_CLASSES, initialsFrom, tintFor } from "./tint";

export type LinkKind = "person" | "entity" | "projet" | "facture" | "echeance" | "tag";

export type LinkItem = {
  id: string;
  name: string;
  kind: LinkKind;
  /** Sous-titre pour la peek card / suggestions (role, entité, email…). */
  role?: string | null;
};

const OBJECT_ICON: Record<Exclude<LinkKind, "person">, PhosphorIcon> = {
  entity: Buildings,
  projet: Briefcase,
  facture: Receipt,
  echeance: CalendarDots,
  tag: Circle,
};

/**
 * Glyphe d'en-tête du chip : avatar à initiales pour les personnes, icône
 * Phosphor duotone tintée pour les objets. Tint déterministe du nom.
 */
function LeadingGlyph({ item, size = 20 }: { item: LinkItem; size?: number }) {
  const tint = TINT_CLASSES[tintFor(item.name || item.id)];
  if (item.kind === "person") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
          tint.bg,
          tint.text,
        )}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.45) }}
        aria-hidden="true"
      >
        {initialsFrom(item.name)}
      </span>
    );
  }
  const Icon = OBJECT_ICON[item.kind];
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center", tint.dot)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon weight="duotone" size={Math.round(size * 0.75)} />
    </span>
  );
}

/**
 * Jeton compact d'un record lié. Sans gestion d'overlay (peek / drawer) —
 * c'est l'appelant qui câble `onClick` (ouvre la fiche / le drawer) et
 * `onRemove` (retire la liaison). Le × n'apparait qu'au hover.
 */
export const LinkChip = forwardRef<
  HTMLButtonElement,
  {
    item: LinkItem;
    onClick?: () => void;
    onRemove?: () => void;
    onPointerEnter?: () => void;
    onPointerLeave?: () => void;
    disabled?: boolean;
    className?: string;
  }
>(function LinkChip(
  { item, onClick, onRemove, onPointerEnter, onPointerLeave, disabled, className },
  ref,
) {
  return (
    <span
      className={cn(
        "group inline-flex max-w-[230px] items-center gap-[7px] rounded-md bg-ds-surface py-[4px] pr-[5px] pl-[5px] text-[14px] text-ds-text leading-[1.35] shadow-[0_0_0_1px_var(--ds-border)] transition-colors hover:bg-ds-hover active:bg-ds-press",
        className,
      )}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={`Ouvrir la fiche — ${item.name}`}
        className="inline-flex min-w-0 items-center gap-[7px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
      >
        <LeadingGlyph item={item} />
        <span className="truncate">{item.name}</span>
      </button>
      {onRemove ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          disabled={disabled}
          aria-label={`Retirer ${item.name}`}
          className="inline-flex size-[17px] shrink-0 items-center justify-center rounded text-ds-text-tertiary opacity-0 transition-opacity duration-150 hover:bg-background hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 group-hover:opacity-100"
        >
          <X weight="bold" size={10} />
        </button>
      ) : null}
    </span>
  );
});

/** Avatar/Icône autonome aux mêmes specs — utile dans peek / drawer. */
export function LinkGlyph({ item, size = 44 }: { item: LinkItem; size?: number }) {
  const tint = TINT_CLASSES[tintFor(item.name || item.id)];
  if (item.kind === "person") {
    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
          tint.bg,
          tint.text,
        )}
        style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
        aria-hidden="true"
      >
        {initialsFrom(item.name)}
      </span>
    );
  }
  const Icon = OBJECT_ICON[item.kind];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-xl",
        tint.bg,
        tint.dot,
      )}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <Icon weight="duotone" size={Math.round(size * 0.55)} />
    </span>
  );
}

export function pickGlyph(item: LinkItem): ReactNode {
  return <LeadingGlyph item={item} />;
}
