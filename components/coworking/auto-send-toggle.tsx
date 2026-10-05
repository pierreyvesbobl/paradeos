"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { setCoworkingContractAutoSend } from "@/lib/actions/coworking";
import { CheckCircle, Circle, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  contractId: string;
  autoSend: boolean;
  /** Réglage global `COWORKING_AUTOSEND_ENABLED`. */
  globalEnabled: boolean;
  /** Adresse du coworker : sans elle, rien ne peut partir. */
  recipientEmail: string | null;
  /** Les contrats facturés par G&O ne sont pas émis par Parade. */
  billedByGandO?: boolean;
};

/**
 * Opt-in de l'envoi automatique pour un contrat.
 *
 * Le bouton reste cliquable même quand l'interrupteur global est fermé : on
 * veut pouvoir préparer les contrats avant d'ouvrir le robinet. En revanche
 * l'absence d'adresse mail bloque vraiment, parce qu'aucun envoi n'est
 * possible — autant le dire ici plutôt qu'au passage du cron.
 */
export function AutoSendToggle({
  contractId,
  autoSend,
  globalEnabled,
  recipientEmail,
  billedByGandO = false,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const blocker = billedByGandO
    ? "Contrat facturé par G&O : Parade n'émet pas cette facture."
    : !recipientEmail
      ? "Le coworker n'a pas d'adresse mail — ajoute-la sur sa fiche contact."
      : null;

  function apply(next: boolean) {
    startTransition(async () => {
      const res = await setCoworkingContractAutoSend({ id: contractId, autoSend: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        next ? "Envoi automatique activé pour ce contrat." : "Envoi automatique coupé.",
      );
      router.refresh();
    });
  }

  return (
    <div className="rounded-md border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-medium text-sm">
            {autoSend ? (
              <CheckCircle className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            ) : (
              <Circle className="size-4 shrink-0 text-muted-foreground" />
            )}
            Envoi automatique
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {autoSend
              ? "Les factures de ce contrat sont finalisées chez Dougs et envoyées au coworker par le cron mensuel."
              : "Les factures de ce contrat restent en brouillon : tu les pousses et les envoies à la main."}
          </p>

          {blocker ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-amber-700 text-xs dark:text-amber-400">
              <Warning className="mt-0.5 size-3.5 shrink-0" />
              {blocker}
            </p>
          ) : null}

          {autoSend && !globalEnabled && !blocker ? (
            <p className="mt-1.5 flex items-start gap-1.5 text-amber-700 text-xs dark:text-amber-400">
              <Warning className="mt-0.5 size-3.5 shrink-0" />
              <span>
                L'interrupteur global est fermé, donc rien ne partira.{" "}
                <Link href="/settings/integrations?tab=compta" className="underline">
                  L'ouvrir
                </Link>
              </span>
            </p>
          ) : null}

          {recipientEmail && autoSend ? (
            <p className="mt-1.5 text-muted-foreground text-xs">
              Destinataire : <span className="font-mono">{recipientEmail}</span>
            </p>
          ) : null}
        </div>

        {autoSend ? (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={pending}
            onClick={() => apply(false)}
          >
            Couper
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            disabled={pending || Boolean(blocker)}
            onClick={() => setConfirmOpen(true)}
          >
            Activer
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Activer l'envoi automatique ?"
        description={`Les prochaines factures de ce contrat seront finalisées chez Dougs puis envoyées à ${recipientEmail ?? "le coworker"}, sans validation manuelle. La finalisation est irréversible : seul un avoir peut annuler une facture émise.`}
        confirmLabel="Activer"
        onConfirm={() => {
          setConfirmOpen(false);
          apply(true);
        }}
      />
    </div>
  );
}
