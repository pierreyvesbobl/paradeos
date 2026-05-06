"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { removeAvatar, uploadAvatar } from "@/lib/actions/avatar";
import { Camera, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  /** URL actuelle (ou null). */
  avatarUrl: string | null;
  /** Initiales pour le fallback. */
  initials: string;
};

export function AvatarUploader({ avatarUrl, initials }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [previewUrl, setPreviewUrl] = useState<string | null>(avatarUrl);
  const [confirmOpen, setConfirmOpen] = useState(false);

  function onFile(file: File | null) {
    if (!file) return;

    // Preview optimiste local en attendant l'upload server.
    const objectUrl = URL.createObjectURL(file);
    setPreviewUrl(objectUrl);

    const fd = new FormData();
    fd.set("file", file);

    startTransition(async () => {
      const result = await uploadAvatar(fd);
      URL.revokeObjectURL(objectUrl);
      if (!result.ok) {
        setPreviewUrl(avatarUrl);
        toast.error(result.message);
        return;
      }
      setPreviewUrl(result.url);
      toast.success("Photo mise à jour.");
      router.refresh();
    });
  }

  function confirmRemove() {
    startTransition(async () => {
      const result = await removeAvatar();
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setConfirmOpen(false);
      setPreviewUrl(null);
      toast.success("Photo retirée.");
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-4">
      <Avatar className="size-20 border">
        {previewUrl ? <AvatarImage src={previewUrl} alt="" /> : null}
        <AvatarFallback className="text-lg">{initials}</AvatarFallback>
      </Avatar>

      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <label>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => onFile(e.target.files?.[0] ?? null)}
              disabled={pending}
            />
            <span className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border bg-background px-3 text-sm hover:bg-muted">
              <Camera className="size-3.5" />
              {pending ? "Envoi…" : previewUrl ? "Changer" : "Ajouter une photo"}
            </span>
          </label>
          {previewUrl ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setConfirmOpen(true)}
              disabled={pending}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
              Retirer
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground text-xs">PNG, JPEG, WebP ou GIF · max 5 MB.</p>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Retirer ta photo de profil ?"
        confirmLabel="Retirer"
        variant="destructive"
        onConfirm={confirmRemove}
        pending={pending}
      />
    </div>
  );
}
