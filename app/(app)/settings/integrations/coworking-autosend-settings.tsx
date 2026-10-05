"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { setCoworkingAutoSendEnabled } from "@/lib/actions/coworking";
import { Power } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  enabled: boolean;
  optedInCount: number;
};

export function CoworkingAutoSendSettings({ enabled, optedInCount }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function apply(next: boolean) {
    startTransition(async () => {
      const res = await setCoworkingAutoSendEnabled({ enabled: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(next ? "Envoi automatique activé." : "Envoi automatique désactivé.");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {enabled ? (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => apply(false)}>
          <Power className="mr-1.5 size-4" />
          Désactiver
        </Button>
      ) : (
        // L'activation passe par une confirmation : c'est le seul réglage de
        // l'app qui autorise l'envoi de documents comptables définitifs.
        <Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirmOpen(true)}>
          <Power className="mr-1.5 size-4" />
          Activer
        </Button>
      )}

      <Link href="/coworking?tab=contracts" className="text-muted-foreground text-xs underline">
        Gérer les contrats opt-in
      </Link>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Activer l'envoi automatique ?"
        description={
          optedInCount === 0
            ? "Aucun contrat n'a coché l'envoi automatique, donc rien ne partira tant que tu n'en auras pas activé au moins un. Tu peux activer l'interrupteur dès maintenant sans risque."
            : `${optedInCount} contrat${optedInCount > 1 ? "s" : ""} ${optedInCount > 1 ? "ont" : "a"} coché l'envoi automatique. Au prochain passage du cron, leurs factures seront finalisées chez Dougs et envoyées par mail aux coworkers. La finalisation est irréversible.`
        }
        confirmLabel="Activer"
        onConfirm={() => {
          setConfirmOpen(false);
          apply(true);
        }}
      />
    </div>
  );
}
