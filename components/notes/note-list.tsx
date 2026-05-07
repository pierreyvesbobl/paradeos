import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import type { buildMarkdownResolver } from "@/lib/db/queries/mention-resolver";
import type { AttachmentRow } from "@/lib/db/queries/notes";
import { formatDateTime } from "@/lib/format";
import type { NoteKind, NoteSubjectType } from "@/lib/schemas/notes";
import { noteKindLabels } from "@/lib/schemas/notes";
import { cn } from "@/lib/utils";
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
    <section className="space-y-3 rounded-lg border bg-card p-6">
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
        <ul className="-mx-2 divide-y">
          {notes.map((note) => {
            const Icon = KIND_ICON[note.kind];
            const colorClass = KIND_COLOR[note.kind];
            return (
              <li key={note.id} className="group space-y-2.5 px-2 py-4 first:pt-2 last:pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={cn("inline-flex items-center gap-1 text-xs", colorClass)}
                    title={noteKindLabels[note.kind]}
                  >
                    <Icon className="size-3.5" />
                    <span className="font-medium">{noteKindLabels[note.kind]}</span>
                  </span>
                  {note.authorName ? (
                    <span className="text-muted-foreground text-xs">· {note.authorName}</span>
                  ) : null}
                  <span className="ml-auto text-muted-foreground text-xs tabular-nums">
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
                        aria-label="Modifier titre / type / date"
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

                {note.title ? (
                  <h3 className="font-semibold text-base leading-snug">{note.title}</h3>
                ) : null}

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

                <AttachmentUploader
                  noteId={note.id}
                  attachments={attachmentsByNote[note.id] ?? []}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
