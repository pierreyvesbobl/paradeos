import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { getUserRole } from "@/lib/auth/admin";
import { requireUser } from "@/lib/auth/server";
import type { AttachmentRow } from "@/lib/db/queries/notes";
import type { NoteKind, NoteSubjectType } from "@/lib/schemas/notes";
import { Note as NoteIcon } from "@phosphor-icons/react/dist/ssr";
import { NoteDialog } from "./note-dialog";
import { NotesGrid } from "./notes-grid";

type Note = {
  id: string;
  title: string | null;
  content: string;
  kind: NoteKind;
  occurredAt: Date;
  authorId: string;
  authorName: string | null;
};

type Props = {
  subjectType: NoteSubjectType;
  subjectId: string;
  notes: Note[];
  /** Pièces jointes par noteId. */
  attachmentsByNote: Record<string, AttachmentRow[]>;
};

export async function NoteList({ subjectType, subjectId, notes, attachmentsByNote }: Props) {
  // Une note est signée : seul son auteur (ou un admin) peut la supprimer.
  const user = await requireUser();
  const isAdmin = (await getUserRole(user.id)) === "admin";

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
          icon={NoteIcon}
          title="Aucune note pour l'instant."
          description="Garde une trace des échanges, décisions ou observations utiles. Mention @prénom pour notifier, #project:nom pour lier une ressource."
        />
      ) : (
        <NotesGrid
          columns={2}
          items={notes.map((note) => ({
            note,
            attachments: attachmentsByNote[note.id] ?? [],
            subjectType,
            subjectId,
            canDelete: isAdmin || note.authorId === user.id,
          }))}
        />
      )}
    </section>
  );
}
