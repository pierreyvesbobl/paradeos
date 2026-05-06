"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  attachToNote,
  deleteAttachment,
  getDownloadUrl,
  signedUploadUrl,
} from "@/lib/actions/note-attachments";
import { Paperclip, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Attachment = {
  id: string;
  fileName: string;
  storagePath: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

type Props = {
  noteId: string;
  attachments: Attachment[];
};

const MAX_BYTES = 50 * 1024 * 1024;

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentUploader({ noteId, attachments }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const pendingDeleteAttachment = pendingDeleteId
    ? attachments.find((a) => a.id === pendingDeleteId)
    : null;

  async function onUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_BYTES) {
          toast.error(`${file.name} dépasse 50 MB.`);
          continue;
        }

        const urlResult = await signedUploadUrl({ noteId, fileName: file.name });
        if (!urlResult.ok) {
          toast.error(urlResult.message);
          continue;
        }
        const { signedUrl, path } = urlResult.data;

        const uploadRes = await fetch(signedUrl, {
          method: "PUT",
          body: file,
          headers: { "content-type": file.type || "application/octet-stream" },
        });
        if (!uploadRes.ok) {
          toast.error(`Upload de ${file.name} échoué (${uploadRes.status}).`);
          continue;
        }

        const attachResult = await attachToNote({
          noteId,
          storagePath: path,
          fileName: file.name,
          mimeType: file.type || undefined,
          sizeBytes: file.size,
        });
        if (!attachResult.ok) {
          toast.error(attachResult.message);
        }
      }
      toast.success("Pièces jointes ajoutées.");
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  function confirmDelete() {
    const id = pendingDeleteId;
    if (!id) return;
    startTransition(async () => {
      const result = await deleteAttachment({ id });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setPendingDeleteId(null);
      toast.success("Pièce jointe supprimée.");
      router.refresh();
    });
  }

  async function onDownload(storagePath: string) {
    const result = await getDownloadUrl({ storagePath });
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    window.open(result.data.url, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="space-y-2">
      {attachments.length > 0 ? (
        <ul className="space-y-1.5">
          {attachments.map((a) => (
            <li
              key={a.id}
              className="flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5 text-xs"
            >
              <Paperclip className="size-3 shrink-0 text-muted-foreground" />
              <button
                type="button"
                onClick={() => onDownload(a.storagePath)}
                className="flex-1 truncate text-left hover:underline"
              >
                {a.fileName}
              </button>
              <span className="shrink-0 text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 shrink-0"
                onClick={() => setPendingDeleteId(a.id)}
                disabled={pending}
                aria-label="Supprimer"
              >
                <Trash2 className="size-3" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <label className="inline-flex">
        <input
          type="file"
          multiple
          className="hidden"
          onChange={(e) => onUpload(e.target.files)}
          disabled={uploading || pending}
        />
        <span className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-2 text-xs hover:bg-muted">
          <Paperclip className="size-3" />
          {uploading ? "Upload…" : "+ Ajouter une pièce jointe"}
        </span>
      </label>
      <ConfirmDialog
        open={pendingDeleteId !== null}
        onOpenChange={(o) => {
          if (!o) setPendingDeleteId(null);
        }}
        title="Supprimer cette pièce jointe ?"
        description={
          pendingDeleteAttachment ? `« ${pendingDeleteAttachment.fileName} »` : undefined
        }
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={confirmDelete}
        pending={pending}
      />
    </div>
  );
}
