"use client";

import { Calendar, CheckCircle2, Trash2, UserPlus, X } from "lucide-react";

type Props = {
  count: number;
  pending: boolean;
  onClear: () => void;
  onComplete: () => void;
  onDelete: () => void;
  // Assign + due-date popovers seront branchés en P4 quand le multi-assigné
  // sera réel. Pour l'instant on les affiche désactivés pour matcher le
  // design tout en signalant qu'ils ne sont pas câblés.
  onAssign?: () => void;
  onSetDueDate?: () => void;
};

/**
 * Barre flottante centrée bas d'écran qui apparaît dès qu'au moins une
 * ligne est sélectionnée. Fond sombre warm-gray (`--ds-text`), actions
 * brèves, "Supprimer" en rouge clair pour la dangerosité, croix de fermeture
 * à droite. Cf. design "Tâches consolidé" frame 2.
 */
export function FloatingActionBar({
  count,
  pending,
  onClear,
  onComplete,
  onDelete,
  onAssign,
  onSetDueDate,
}: Props) {
  if (count === 0) return null;
  return (
    <div
      className="-translate-x-1/2 fixed bottom-6 left-1/2 z-50 flex items-center gap-1.5 rounded-[10px] px-2.5 py-2 pl-3.5 text-sm shadow-popover"
      style={{ background: "var(--ds-text)" }}
      role="toolbar"
      aria-label="Actions sur la sélection"
    >
      <span className="font-medium text-white">
        {count} sélectionnée{count > 1 ? "s" : ""}
      </span>
      <span className="mx-1 h-[18px] w-px bg-white/20" />
      <BarButton onClick={onComplete} disabled={pending}>
        <CheckCircle2 className="size-[15px]" />
        Terminer
      </BarButton>
      <BarButton onClick={onAssign} disabled={!onAssign || pending}>
        <UserPlus className="size-[15px]" />
        Assigner
      </BarButton>
      <BarButton onClick={onSetDueDate} disabled={!onSetDueDate || pending}>
        <Calendar className="size-[15px]" />
        Échéance
      </BarButton>
      <BarButton onClick={onDelete} disabled={pending} tone="danger">
        <Trash2 className="size-[15px]" />
        Supprimer
      </BarButton>
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

function BarButton({
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
