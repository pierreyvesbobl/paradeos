"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createAndLinkDriveFolder } from "@/lib/actions/drive-folders";
import type { DriveFileSubjectType } from "@/lib/schemas/drive-files";
import { FolderPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export function DriveFolderCreateDialog({
  subjectType,
  subjectId,
  defaultName,
}: {
  subjectType: DriveFileSubjectType;
  subjectId: string;
  defaultName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [pending, startTransition] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    startTransition(async () => {
      const res = await createAndLinkDriveFolder({ subjectType, subjectId, name: trimmed });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Dossier « ${res.data.folderName} » créé dans Drive.`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="gap-1.5">
          <FolderPlus className="size-3.5" />
          Créer un dossier
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>Créer un dossier Drive</DialogTitle>
            <DialogDescription>
              Le dossier sera créé à la racine de ton My Drive et lié à ce projet.
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 space-y-1.5">
            <Label htmlFor="drive-folder-name" className="text-xs">
              Nom du dossier
            </Label>
            <Input
              id="drive-folder-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={pending}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Annuler
            </Button>
            <Button type="submit" disabled={pending || !name.trim()}>
              {pending ? "…" : "Créer"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
