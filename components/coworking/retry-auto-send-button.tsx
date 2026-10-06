"use client";

import { ArrowClockwise } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { retryCoworkingAutoSend } from "@/lib/actions/coworking";

/** Messages des raisons de non-envoi, côté UI. */
const REASON_LABELS: Record<string, string> = {
  disabled: "L'envoi automatique est désactivé globalement.",
  not_opted_in: "Ce contrat n'a pas activé l'envoi automatique.",
  g_and_o: "Facture G&O : ce n'est pas Parade qui émet.",
  no_recipient: "Pas d'adresse mail pour le coworker.",
  zero_amount: "Montant nul.",
  already_sent: "Déjà envoyée ou déjà finalisée chez Dougs.",
  blockers: "Dougs refuse encore de finaliser.",
  dry_run: "Mode à blanc.",
};

/**
 * Relance l'envoi d'une facture après correction d'un blocage. Confirmation
 * obligatoire : contrairement au cron, c'est un clic volontaire qui finalise
 * une facture de façon irréversible.
 */
export function RetryAutoSendButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  function retry() {
    startTransition(async () => {
      const res = await retryCoworkingAutoSend({ id: invoiceId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if (res.data.sent) {
        toast.success(`Facture ${res.data.reference} émise et envoyée.`);
      } else {
        const blockers = res.data.blockers.map((b) => b.message).join(" · ");
        toast.warning(blockers || REASON_LABELS[res.data.reason] || "Facture non envoyée.");
      }
      router.refresh();
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" disabled={pending} onClick={() => setConfirmOpen(true)}>
        <ArrowClockwise className="mr-1.5 size-4" />
        Relancer l'envoi
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Relancer l'envoi ?"
        description="Si Dougs accepte de finaliser, la facture est émise avec son numéro définitif et partie par mail au coworker. C'est irréversible."
        confirmLabel="Relancer"
        onConfirm={() => {
          setConfirmOpen(false);
          retry();
        }}
      />
    </>
  );
}
