"use client";

import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { AttachmentRow } from "@/lib/db/queries/notes";
import { formatDateTime } from "@/lib/format";
import type { NoteKind, NoteSubjectType } from "@/lib/schemas/notes";
import { noteKindLabels } from "@/lib/schemas/notes";
import { cn } from "@/lib/utils";
import { MessageCircle, Paperclip, Phone, StickyNote, Users } from "lucide-react";
import { useState } from "react";
import { DeleteNoteButton } from "./delete-note-button";
import { NoteDialog } from "./note-dialog";
import { TiptapNoteEditor } from "./tiptap-note-editor";

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

type Props = {
  note: Note;
  attachments: AttachmentRow[];
  /** Sujet à rééditer via le dialog metadata (peut être null sur /notes pour les sujets non éditables). */
  subjectType: NoteSubjectType | null;
  subjectId: string | null;
  /** Pill optionnelle pour montrer le sujet (utilisé par la page /notes). */
  subjectPill?: React.ReactNode;
};

/**
 * Strip basique de markdown pour le preview 2-lignes du card. Pas de
 * rendu riche : on veut juste un aperçu lisible.
 */
function previewText(content: string): string {
  return content
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~]/g, "")
    .replace(/\n+/g, " ")
    .trim();
}

function localInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${day}T${h}:${min}`;
}

export function NoteCard({ note, attachments, subjectType, subjectId, subjectPill }: Props) {
  const [open, setOpen] = useState(false);
  const Icon = KIND_ICON[note.kind];
  const colorClass = KIND_COLOR[note.kind];
  const stripped = previewText(note.content);
  const fallbackTitle = stripped.split(" ").slice(0, 12).join(" ") || "(sans contenu)";
  const displayTitle = note.title?.trim() || fallbackTitle;
  const attachmentCount = attachments.length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group block w-full rounded-lg border bg-card p-4 text-left transition-all hover:border-foreground/20 hover:shadow-sm"
        >
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span
              className={cn("inline-flex items-center gap-1 text-xs", colorClass)}
              title={noteKindLabels[note.kind]}
            >
              <Icon className="size-3.5" />
              <span className="font-medium">{noteKindLabels[note.kind]}</span>
            </span>
            {subjectPill}
            <span className="ml-auto text-muted-foreground text-xs tabular-nums">
              {formatDateTime(note.occurredAt)}
            </span>
          </div>

          <h3 className="mb-1 line-clamp-1 font-semibold text-sm leading-snug">{displayTitle}</h3>

          {stripped && stripped !== displayTitle ? (
            <p className="line-clamp-2 text-muted-foreground text-sm">{stripped}</p>
          ) : null}

          <div className="mt-2 flex items-center gap-3 text-muted-foreground text-xs">
            {note.authorName ? <span>{note.authorName}</span> : null}
            {attachmentCount > 0 ? (
              <span className="inline-flex items-center gap-1">
                <Paperclip className="size-3" />
                {attachmentCount}
              </span>
            ) : null}
          </div>
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-4">
        <DialogTitle className="flex shrink-0 flex-wrap items-center gap-2 pr-6">
          <span className={cn("inline-flex items-center gap-1.5 text-sm", colorClass)}>
            <Icon className="size-4" />
            {noteKindLabels[note.kind]}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
            · {formatDateTime(note.occurredAt)}
          </span>
          {note.authorName ? (
            <span className="text-muted-foreground text-xs">· {note.authorName}</span>
          ) : null}
          <span className="ml-auto flex items-center gap-1">
            <NoteDialog
              subjectType={subjectType ?? undefined}
              subjectId={subjectId ?? undefined}
              initial={{
                id: note.id,
                title: note.title ?? "",
                content: note.content,
                kind: note.kind,
                occurredAt: localInput(note.occurredAt),
              }}
              trigger={
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-muted-foreground text-xs hover:bg-muted"
                  aria-label="Modifier titre / type / date"
                  title="Modifier titre / type / date"
                >
                  Métadonnées
                </button>
              }
            />
            <DeleteNoteButton noteId={note.id} label={note.title ?? note.content.slice(0, 60)} />
          </span>
        </DialogTitle>

        <div className="-mx-6 min-h-0 flex-1 space-y-3 overflow-y-auto px-6">
          {note.title ? <h2 className="font-semibold text-lg leading-snug">{note.title}</h2> : null}

          <TiptapNoteEditor
            note={{
              id: note.id,
              title: note.title,
              content: note.content,
              kind: note.kind,
              occurredAt: note.occurredAt,
              subjectType,
              subjectId,
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
