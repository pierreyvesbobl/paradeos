"use client";

import { X } from "@phosphor-icons/react";

type Props = {
  count: number;
  /** Nom de l'objet sélectionné, au féminin ou masculin selon la liste. */
  label: (count: number) => string;
  onClear: () => void;
  children: React.ReactNode;
  ariaLabel?: string;
};

/**
 * Barre flottante centrée bas d'écran qui apparaît dès qu'au moins un
 * élément est sélectionné. Fond sombre warm-gray (`--ds-text`), actions
 * brèves, croix de fermeture à droite. Cf. design « Tâches consolidé »
 * frame 2 — partagée par les tâches et les notes pour que la sélection
 * ait la même tête partout.
 */
export function SelectionBar({ count, label, onClear, children, ariaLabel }: Props) {
  if (count === 0) return null;
  return (
    <div
      className="-translate-x-1/2 fixed bottom-6 left-1/2 z-50 flex items-center gap-1.5 rounded-[10px] px-2.5 py-2 pl-3.5 text-sm shadow-popover"
      style={{ background: "var(--ds-text)" }}
      role="toolbar"
      aria-label={ariaLabel ?? "Actions sur la sélection"}
    >
      <span className="font-medium text-white">{label(count)}</span>
      <span className="mx-1 h-[18px] w-px bg-white/20" />
      {children}
      <span className="mx-1 h-[18px] w-px bg-white/20" />
      <button
        type="button"
        onClick={onClear}
        aria-label="Effacer la sélection"
        className="inline-flex size-[26px] items-center justify-center rounded-md text-white/70 transition-colors hover:bg-white/10 hover:text-white"
      >
        <X className="size-[14px]" />
      </button>
    </div>
  );
}

export function SelectionBarButton({
  children,
  onClick,
  disabled,
  tone,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "default" | "danger";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ color: tone === "danger" ? "#F1A8A2" : "#fff" }}
    >
      {children}
    </button>
  );
}
