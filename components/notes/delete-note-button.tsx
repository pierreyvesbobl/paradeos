"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { deleteNote } from "@/lib/actions/notes";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function DeleteNoteButton({ noteId, label }: { noteId: string; label?: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const preview = label?.trim()
    ? `« ${label.trim().slice(0, 80)}${label.length > 80 ? "…" : ""} »`
    : "cette note";

  function confirmDelete() {
    startTransition(async () => {
      const res = await deleteNote({ id: noteId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOpen(false);
      toast.success("Note supprimée.");
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="size-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
        aria-label="Supprimer la note"
        title="Supprimer"
        disabled={pending}
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Supprimer ${preview} ?`}
        description="Cette action est irréversible."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={confirmDelete}
        pending={pending}
      />
    </>
  );
}
