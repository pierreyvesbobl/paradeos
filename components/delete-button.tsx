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
import { Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  /** Action serveur qui supprime l'objet et redirige (FormData → id). */
  action: (formData: FormData) => Promise<void> | never;
  id: string;
  label: string;
  /** Phrase de confirmation, ex. "Supprimer le contact \"Jean Dupont\" ?" */
  confirmTitle: string;
  confirmDescription?: string;
};

export function DeleteButton({ action, id, label, confirmTitle, confirmDescription }: Props) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("id", id);
        await action(fd);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Erreur inconnue.";
        // Ignore les redirections Next ("NEXT_REDIRECT") qui sont normales ici.
        if (!message.includes("NEXT_REDIRECT")) {
          toast.error(message);
        }
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
          <Trash2 className="size-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirmTitle}</DialogTitle>
          {confirmDescription ? <DialogDescription>{confirmDescription}</DialogDescription> : null}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending ? "Suppression…" : "Supprimer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
