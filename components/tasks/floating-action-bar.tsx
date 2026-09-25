"use client";

import { SelectionBar, SelectionBarButton } from "@/components/ui/selection-bar";
import { CalendarBlank, CheckCircle, Trash, UserPlus } from "@phosphor-icons/react";

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

/** Actions groupées des tâches, posées sur la barre de sélection partagée. */
export function FloatingActionBar({
  count,
  pending,
  onClear,
  onComplete,
  onDelete,
  onAssign,
  onSetDueDate,
}: Props) {
  return (
    <SelectionBar
      count={count}
      label={(n) => `${n} sélectionnée${n > 1 ? "s" : ""}`}
      onClear={onClear}
    >
      <SelectionBarButton onClick={onComplete} disabled={pending}>
        <CheckCircle className="size-[15px]" />
        Terminer
      </SelectionBarButton>
      <SelectionBarButton onClick={onAssign} disabled={!onAssign || pending}>
        <UserPlus className="size-[15px]" />
        Assigner
      </SelectionBarButton>
      <SelectionBarButton onClick={onSetDueDate} disabled={!onSetDueDate || pending}>
        <CalendarBlank className="size-[15px]" />
        Échéance
      </SelectionBarButton>
      <SelectionBarButton onClick={onDelete} disabled={pending} tone="danger">
        <Trash className="size-[15px]" />
        Supprimer
      </SelectionBarButton>
    </SelectionBar>
  );
}
