import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import type { AttachmentRow } from "@/lib/db/queries/notes";
import type { NoteKind, NoteSubjectType } from "@/lib/schemas/notes";
import { StickyNote } from "lucide-react";
import { NoteCard } from "./note-card";
import { NoteDialog } from "./note-dialog";

type Note = {
  id: string;
  title: string | null;
  content: string;
  kind: NoteKind;
  occurredAt: Date;
  authorName: string | null;
};

type Props = {
  subjectType: NoteSubjectType;
  subjectId: string;
  notes: Note[];
  /** Pièces jointes par noteId. */
  attachmentsByNote: Record<string, AttachmentRow[]>;
};

export function NoteList({ subjectType, subjectId, notes, attachmentsByNote }: Props) {
  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h2 className="font-medium text-sm">Notes {notes.length > 0 ? `(${notes.length})` : ""}</h2>
        <NoteDialog
          subjectType={subjectType}
          subjectId={subjectId}
          trigger={
            <Button size="sm" variant="outline">
              + Ajouter
            </Button>
          }
        />
      </header>

      {notes.length === 0 ? (
        <EmptyState
          compact
          icon={StickyNote}
          title="Aucune note pour l'instant."
          description="Garde une trace des échanges, décisions ou observations utiles. Mention @prénom pour notifier, #project:nom pour lier une ressource."
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {notes.map((note) => (
            <li key={note.id}>
              <NoteCard
                note={note}
                attachments={attachmentsByNote[note.id] ?? []}
                subjectType={subjectType}
                subjectId={subjectId}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
