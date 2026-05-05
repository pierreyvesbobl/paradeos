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
import { convertOpportunityToProject } from "@/lib/actions/opportunities";
import { ArrowRightCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Props = { opportunityId: string; suggestedName: string };

export function ConvertButton({ opportunityId, suggestedName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggestedName);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await convertOpportunityToProject({
        id: opportunityId,
        projectName: name.trim() || undefined,
      });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(
        result.data.alreadyLinked ? "Projet déjà lié — redirection." : "Projet client créé.",
      );
      setOpen(false);
      router.push(`/projets/${result.data.projectId}`);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <ArrowRightCircle className="size-4" />
          Convertir en projet
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Créer un projet client</DialogTitle>
          <DialogDescription>
            L'opportunité sera liée au projet créé. L'entité, l'owner et la date de closing seront
            repris automatiquement.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="projectName">Nom du projet</Label>
          <Input
            id="projectName"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={pending}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
            Annuler
          </Button>
          <Button onClick={onConfirm} disabled={pending || !name.trim()}>
            {pending ? "Création…" : "Créer le projet"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
