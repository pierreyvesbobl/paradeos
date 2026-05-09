"use client";

import { Image as TiptapImage } from "@tiptap/extension-image";
import { Link } from "@tiptap/extension-link";
import { Placeholder } from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImagePlus,
  Italic,
  List,
  ListOrdered,
  Quote,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Markdown as MarkdownExtension } from "tiptap-markdown";

import { attachToNote, signedUploadUrl } from "@/lib/actions/note-attachments";
import { updateNote } from "@/lib/actions/notes";
import type { NoteKind, NoteSubjectType } from "@/lib/schemas/notes";
import { cn } from "@/lib/utils";

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
};

/** `attachment://path` → URL servable par <img> via la route auth. */
function attachmentToWebUrl(md: string): string {
  return md.replace(/attachment:\/\/([^\s)\]]+)/g, (_, p: string) => {
    return `/api/note-attachments/${p.split("/").map(encodeURIComponent).join("/")}`;
  });
}

/** Réciproque : on stocke le markdown avec `attachment://` côté DB. */
function webUrlToAttachment(md: string): string {
  return md.replace(/\/api\/note-attachments\/([^\s)\]]+)/g, (_, encoded: string) => {
    const decoded = encoded.split("/").map(decodeURIComponent).join("/");
    return `attachment://${decoded}`;
  });
}

export function TiptapNoteEditor({ note }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [uploading, setUploading] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef(note.content);

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

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      TiptapImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({
        placeholder:
          "Écris ici. # titre · * liste · > citation · ``` code · Cmd+V pour coller une image",
      }),
      Link.configure({ openOnClick: false, autolink: true }),
      MarkdownExtension.configure({ html: false, breaks: true }),
    ],
    content: attachmentToWebUrl(note.content),
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[200px] py-2",
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        void handleFiles(files);
        return true;
      },
      handleDrop: (_view, event) => {
        const files = Array.from((event as DragEvent).dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        event.preventDefault();
        void handleFiles(files);
        return true;
      },
    },
    onUpdate: () => scheduleSave(),
  });

  async function handleFiles(files: File[]) {
    if (!editor) return;
    setUploading(true);
    try {
      for (const file of files) {
        const path = await uploadFile(file);
        if (!path) continue;
        const url = `/api/note-attachments/${path.split("/").map(encodeURIComponent).join("/")}`;
        if (file.type.startsWith("image/")) {
          editor.chain().focus().setImage({ src: url, alt: file.name }).run();
        } else {
          editor
            .chain()
            .focus()
            .insertContent({
              type: "paragraph",
              content: [
                {
                  type: "text",
                  text: file.name,
                  marks: [{ type: "link", attrs: { href: url } }],
                },
              ],
            })
            .run();
        }
      }
    } finally {
      setUploading(false);
    }
  }

  function scheduleSave() {
    if (!editor) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setStatus("idle");
    saveTimer.current = setTimeout(() => {
      void doSave();
    }, 1500);
  }

  async function doSave() {
    if (!editor) return;
    const raw = (
      editor.storage as unknown as { markdown: { getMarkdown(): string } }
    ).markdown.getMarkdown();
    const md = webUrlToAttachment(raw);
    if (md === lastSavedRef.current) {
      setStatus("saved");
      return;
    }
    setStatus("saving");
    const res = await updateNote({
      id: note.id,
      title: note.title ?? undefined,
      content: md,
      kind: note.kind,
      subjectType: note.subjectType ?? undefined,
      subjectId: note.subjectId ?? undefined,
      occurredAt: note.occurredAt.toISOString(),
    });
    if (!res.ok) {
      setStatus("error");
      toast.error(res.message);
      return;
    }
    lastSavedRef.current = md;
    setStatus("saved");
    router.refresh();
  }

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  if (!editor) return null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-0.5 border-b pb-2">
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive("heading", { level: 1 })}
          title="Titre 1"
        >
          <Heading1 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive("heading", { level: 2 })}
          title="Titre 2"
        >
          <Heading2 className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive("heading", { level: 3 })}
          title="Titre 3"
        >
          <Heading3 className="size-4" />
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive("bold")}
          title="Gras (Cmd+B)"
        >
          <Bold className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive("italic")}
          title="Italique (Cmd+I)"
        >
          <Italic className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          active={editor.isActive("code")}
          title="Code inline"
        >
          <Code className="size-4" />
        </ToolbarButton>
        <Divider />
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive("bulletList")}
          title="Liste à puces"
        >
          <List className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive("orderedList")}
          title="Liste numérotée"
        >
          <ListOrdered className="size-4" />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          active={editor.isActive("blockquote")}
          title="Citation"
        >
          <Quote className="size-4" />
        </ToolbarButton>
        <Divider />
        <label className="inline-flex h-7 cursor-pointer items-center justify-center rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground">
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length > 0) void handleFiles(files);
              e.currentTarget.value = "";
            }}
          />
          <ImagePlus className="size-4" />
        </label>
        <span className="ml-auto text-muted-foreground text-xs">
          {uploading
            ? "Upload…"
            : status === "saving"
              ? "Sauvegarde…"
              : status === "saved"
                ? "Sauvegardé"
                : status === "error"
                  ? "Erreur"
                  : ""}
        </span>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolbarButton({
  active,
  children,
  onClick,
  title,
}: {
  active?: boolean;
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex h-7 items-center justify-center rounded-md px-2 text-muted-foreground hover:bg-muted hover:text-foreground",
        active && "bg-muted text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="mx-1 h-4 w-px bg-border" />;
}
