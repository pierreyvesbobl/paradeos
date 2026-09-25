"use client";

import { NoteCard } from "@/components/notes/note-card";
import { Checkbox } from "@/components/ui/checkbox";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SelectionBar, SelectionBarButton } from "@/components/ui/selection-bar";
import { bulkDeleteNotes } from "@/lib/actions/notes";
import type { AttachmentRow } from "@/lib/db/queries/notes";
import type { NoteKind, NoteSubjectType } from "@/lib/schemas/notes";
import { cn } from "@/lib/utils";
import { Trash } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

export type NotesGridItem = {
  note: {
    id: string;
    title: string | null;
    content: string;
    kind: NoteKind;
    occurredAt: Date;
    authorName: string | null;
  };
  attachments: AttachmentRow[];
  /** Sujet rééditable depuis le dialog (null sur /notes pour les sujets non gérés). */
  subjectType: NoteSubjectType | null;
  subjectId: string | null;
  /** Pill de sujet rendue côté serveur (page /notes uniquement). */
  subjectPill?: React.ReactNode;
  /** L'utilisateur courant est l'auteur, ou admin : la note est sélectionnable. */
  canDelete: boolean;
};

type Props = {
  items: NotesGridItem[];
  /** Nombre de colonnes au plus large. 2 sur une fiche, 3 sur /notes. */
  columns?: 2 | 3;
};

/**
 * Grille de notes avec sélection multiple et suppression groupée.
 *
 * La case à cocher vit à l'extérieur du card (coin haut-gauche) plutôt
 * qu'à l'intérieur : le card entier est un `DialogTrigger`, donc un
 * bouton — imbriquer un contrôle dedans donnerait du HTML invalide et
 * volerait le clic d'ouverture. Résultat : cocher sélectionne, cliquer
 * la carte ouvre toujours la note.
 */
export function NotesGrid({ items, columns = 3 }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Une note supprimée ailleurs (dialog, autre onglet) ne doit pas rester
  // dans la sélection : on n'en garde que ce qui est encore rendu.
  const selectableIds = useMemo(
    () => items.filter((i) => i.canDelete).map((i) => i.note.id),
    [items],
  );
  const selectedIds = useMemo(
    () => selectableIds.filter((id) => selected.has(id)),
    [selectableIds, selected],
  );

  const toggle = useCallback(
    (id: string, shift: boolean) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (shift && lastSelectedId && lastSelectedId !== id) {
          const a = selectableIds.indexOf(lastSelectedId);
          const b = selectableIds.indexOf(id);
          if (a >= 0 && b >= 0) {
            const [from, to] = a < b ? [a, b] : [b, a];
            for (let i = from; i <= to; i++) {
              const rowId = selectableIds[i];
              if (rowId) next.add(rowId);
            }
            return next;
          }
        }
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setLastSelectedId(id);
    },
    [lastSelectedId, selectableIds],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setLastSelectedId(null);
  }, []);

  function confirmDelete() {
    if (selectedIds.length === 0) return;
    startTransition(async () => {
      const res = await bulkDeleteNotes({ ids: selectedIds });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { deleted, skipped } = res.data;
      toast.success(
        skipped > 0
          ? `${deleted} note${deleted > 1 ? "s" : ""} supprimée${deleted > 1 ? "s" : ""} — ${skipped} ignorée${skipped > 1 ? "s" : ""} (autre auteur).`
          : `${deleted} note${deleted > 1 ? "s" : ""} supprimée${deleted > 1 ? "s" : ""}.`,
      );
      setConfirmOpen(false);
      clearSelection();
      router.refresh();
    });
  }

  const hasSelection = selectedIds.length > 0;

  return (
    <>
      <ul className={cn("grid gap-3 sm:grid-cols-2", columns === 3 && "lg:grid-cols-3")}>
        {items.map((item) => {
          const isSelected = selected.has(item.note.id);
          return (
            <li key={item.note.id} className="group/note relative">
              {item.canDelete ? (
                <span
                  className={cn(
                    "-left-2 -top-2 absolute z-10 rounded-[5px] border bg-background p-0.5 shadow-sm transition-opacity",
                    isSelected || hasSelection
                      ? "opacity-100"
                      : "opacity-0 focus-within:opacity-100 group-hover/note:opacity-100",
                  )}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => {
                      /* piloté par onClick, qui seul donne la touche Maj */
                    }}
                    onClick={(e) => toggle(item.note.id, e.shiftKey)}
                    aria-label={`Sélectionner ${item.note.title?.trim() || "cette note"}`}
                  />
                </span>
              ) : null}
              <div
                className={cn(
                  "rounded-lg",
                  isSelected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
                )}
              >
                <NoteCard
                  note={item.note}
                  attachments={item.attachments}
                  subjectType={item.subjectType}
                  subjectId={item.subjectId}
                  subjectPill={item.subjectPill}
                />
              </div>
            </li>
          );
        })}
      </ul>

      <SelectionBar
        count={selectedIds.length}
        label={(n) => `${n} note${n > 1 ? "s" : ""} sélectionnée${n > 1 ? "s" : ""}`}
        onClear={clearSelection}
        ariaLabel="Actions sur les notes sélectionnées"
      >
        <SelectionBarButton onClick={() => setConfirmOpen(true)} disabled={pending} tone="danger">
          <Trash className="size-[15px]" />
          Supprimer
        </SelectionBarButton>
      </SelectionBar>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Supprimer ${selectedIds.length} note${selectedIds.length > 1 ? "s" : ""} ?`}
        description="Les pièces jointes associées sont supprimées avec elles. Cette action est irréversible."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={confirmDelete}
        pending={pending}
      />
    </>
  );
}
