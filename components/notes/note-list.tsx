import { Button } from "@/components/ui/button";
import type { buildMarkdownResolver } from "@/lib/db/queries/mention-resolver";
import type { AttachmentRow } from "@/lib/db/queries/notes";
import { formatDateTime } from "@/lib/format";
import type { NoteKind, NoteSubjectType } from "@/lib/schemas/notes";
import { noteKindLabels } from "@/lib/schemas/notes";
import { MessageCircle, Phone, StickyNote, Users } from "lucide-react";
import { AttachmentUploader } from "./attachment-uploader";
import { DeleteNoteButton } from "./delete-note-button";
import { InlineNoteEditor } from "./inline-note-editor";
import { NoteDialog } from "./note-dialog";

const KIND_ICON: Record<NoteKind, React.ComponentType<{ className?: string }>> = {
  memo: StickyNote,
  call: Phone,
  meeting: Users,
  message: MessageCircle,
};

const KIND_COLOR: Record<NoteKind, string> = {
  memo: "text-muted-foreground",
  call: "text-blue-600 dark:text-blue-400",
  meeting: "text-violet-600 dark:text-violet-400",
  message: "text-amber-600 dark:text-amber-400",
};

type Note = {
  id: string;
  title: string | null;
  content: string;
  kind: NoteKind;
  occurredAt: Date;
  authorName: string | null;
};

type Resolver = Awaited<ReturnType<typeof buildMarkdownResolver>>;

type Props = {
  subjectType: NoteSubjectType;
  subjectId: string;
  notes: Note[];
  resolver: Resolver;
  /** Pièces jointes par noteId. */
  attachmentsByNote: Record<string, AttachmentRow[]>;
};

function localInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function NoteList({ subjectType, subjectId, notes, resolver, attachmentsByNote }: Props) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-6">
      <div className="flex items-center justify-between">
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
      </div>

      {notes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          Aucune note pour l'instant. Garde une trace des échanges, des décisions ou des
          observations utiles. Tu peux mentionner des collaborateurs avec @prenom et lier des
          projets/contacts/etc. avec #project:nom-du-projet.
        </p>
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => {
            const Icon = KIND_ICON[note.kind];
            const colorClass = KIND_COLOR[note.kind];
            return (
              <li key={note.id} className="group rounded-md border bg-background p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Icon className={`size-4 ${colorClass}`} />
                    <span className={`font-medium text-xs uppercase tracking-wide ${colorClass}`}>
                      {noteKindLabels[note.kind]}
                    </span>
                    {note.title ? <span className="font-medium text-sm">{note.title}</span> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-xs">
                      {formatDateTime(note.occurredAt)}
                    </span>
                    <NoteDialog
                      subjectType={subjectType}
                      subjectId={subjectId}
                      initial={{
                        id: note.id,
                        title: note.title ?? "",
                        content: note.content,
                        kind: note.kind,
                        occurredAt: localInput(note.occurredAt),
                      }}
                      trigger={
                        <Button
                          size="icon"
                          variant="ghost"
                          className="size-7 opacity-0 transition-opacity group-hover:opacity-100"
                          aria-label="Métadonnées"
                          title="Modifier titre / type / date"
                        >
                          <span className="text-muted-foreground text-xs">…</span>
                        </Button>
                      }
                    />
                    <DeleteNoteButton
                      noteId={note.id}
                      label={note.title ?? note.content.slice(0, 60)}
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <InlineNoteEditor
                    note={{
                      id: note.id,
                      title: note.title,
                      content: note.content,
                      kind: note.kind,
                      occurredAt: note.occurredAt,
                      subjectType,
                      subjectId,
                    }}
                    resolver={resolver}
                  />
                </div>
                <div className="mt-3">
                  <AttachmentUploader
                    noteId={note.id}
                    attachments={attachmentsByNote[note.id] ?? []}
                  />
                </div>
                {note.authorName ? (
                  <p className="mt-2 text-muted-foreground text-xs">— {note.authorName}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
