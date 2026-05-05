"use client";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { attachToNote, signedUploadUrl } from "@/lib/actions/note-attachments";
import { updateNote } from "@/lib/actions/notes";
import type { buildMarkdownResolver } from "@/lib/db/queries/mention-resolver";
import type { NoteKind, NoteSubjectType } from "@/lib/schemas/notes";
import { ImagePlus } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type ClipboardEvent,
  type DragEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

type Resolver = Awaited<ReturnType<typeof buildMarkdownResolver>>;

type Props = {
  note: {
    id: string;
    title: string | null;
    content: string;
    kind: NoteKind;
    occurredAt: Date;
    subjectType: NoteSubjectType | null;
    subjectId: string | null;
  };
  resolver: Resolver;
};

export function InlineNoteEditor({ note, resolver }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(note.content);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Resync si la prop change (router.refresh après save).
  useEffect(() => {
    setContent(note.content);
  }, [note.content]);

  useEffect(() => {
    if (editing) textareaRef.current?.focus();
  }, [editing]);

  function insertAtCursor(snippet: string) {
    const ta = textareaRef.current;
    if (!ta) {
      setContent((c) => `${c}${snippet}`);
      return;
    }
    const start = ta.selectionStart ?? content.length;
    const end = ta.selectionEnd ?? content.length;
    const next = content.slice(0, start) + snippet + content.slice(end);
    setContent(next);
    // Replace cursor after the inserted snippet.
    requestAnimationFrame(() => {
      ta.focus();
      ta.selectionStart = ta.selectionEnd = start + snippet.length;
    });
  }

  async function uploadFile(file: File): Promise<string | null> {
    const urlRes = await signedUploadUrl({ noteId: note.id, fileName: file.name });
    if (!urlRes.ok) {
      toast.error(urlRes.message);
      return null;
    }
    const { signedUrl, path } = urlRes.data;
    const upload = await fetch(signedUrl, {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type || "application/octet-stream" },
    });
    if (!upload.ok) {
      toast.error(`Upload échoué (${upload.status}).`);
      return null;
    }
    const att = await attachToNote({
      noteId: note.id,
      storagePath: path,
      fileName: file.name,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    });
    if (!att.ok) {
      toast.error(att.message);
      return null;
    }
    return path;
  }

  async function handleFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (const file of files) {
        const isImage = file.type.startsWith("image/");
        const path = await uploadFile(file);
        if (!path) continue;
        const alt = file.name.replace(/\.[^.]+$/, "");
        const snippet = isImage
          ? `![${alt}](attachment://${path})`
          : `[${file.name}](attachment://${path})`;
        insertAtCursor(`${snippet}\n`);
      }
    } finally {
      setUploading(false);
    }
  }

  function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData.items;
    const files: File[] = [];
    for (const item of items) {
      if (item.kind === "file") {
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      void handleFiles(files);
    }
  }

  function onDrop(e: DragEvent<HTMLTextAreaElement>) {
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    void handleFiles(Array.from(e.dataTransfer.files));
  }

  function save() {
    startTransition(async () => {
      const res = await updateNote({
        id: note.id,
        title: note.title ?? undefined,
        content,
        kind: note.kind,
        subjectType: note.subjectType ?? undefined,
        subjectId: note.subjectId ?? undefined,
        occurredAt: note.occurredAt.toISOString(),
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setEditing(false);
      toast.success("Note enregistrée.");
      router.refresh();
    });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="-mx-1.5 block w-full rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/40"
        title="Cliquer pour éditer"
      >
        {content.trim().length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Cliquer pour ajouter du contenu (texte, images collées, captures…).
          </p>
        ) : (
          <Markdown content={content} resolver={resolver} />
        )}
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <textarea
        ref={textareaRef}
        rows={Math.min(20, Math.max(6, content.split("\n").length + 1))}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onPaste={onPaste}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (
            (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ||
            (e.key === "s" && (e.metaKey || e.ctrlKey))
          ) {
            e.preventDefault();
            save();
          }
          if (e.key === "Escape") {
            setContent(note.content);
            setEditing(false);
          }
        }}
        disabled={pending || uploading}
        placeholder="Écris ici. Tu peux coller (Cmd+V) ou déposer une image / capture."
        className="block w-full resize-y rounded-md border bg-background p-3 font-mono text-xs leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <div className="flex items-center justify-between gap-2">
        <label className="inline-flex items-center gap-1.5 text-muted-foreground text-xs">
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            disabled={uploading || pending}
            onChange={(e) => (e.target.files ? void handleFiles(Array.from(e.target.files)) : null)}
          />
          <span className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border bg-background px-2 hover:bg-muted">
            <ImagePlus className="size-3.5" />
            {uploading ? "Upload…" : "Insérer une image"}
          </span>
          <span className="text-[10px]">⌘V pour coller · drag & drop OK</span>
        </label>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending || uploading}
            onClick={() => {
              setContent(note.content);
              setEditing(false);
            }}
          >
            Annuler
          </Button>
          <Button type="button" size="sm" disabled={pending || uploading} onClick={save}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
