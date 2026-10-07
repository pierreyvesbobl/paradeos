"use client";

import { CheckCircle, Circle, Warning } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  setCoworkingContractAutoSend,
  setCoworkingContractBilledBy,
} from "@/lib/actions/coworking";

type Props = {
  contractId: string;
  autoSend: boolean;
  /** Réglage global `COWORKING_AUTOSEND_ENABLED`. */
  globalEnabled: boolean;
  /** Adresse du coworker : sans elle, rien ne peut partir. */
  recipientEmail: string | null;
  /** Les contrats encaissés par G&O ne sont pas émis par Parade. */
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
            Envoi groupé
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            {autoSend
              ? "Ce contrat figure dans l'envoi groupé de la page Coworking : ses factures y sont finalisées chez Dougs puis envoyées au coworker."
              : "Ce contrat est exclu de l'envoi groupé : tu pousses et envoies ses factures une par une."}
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
                Le coupe-circuit global est fermé, donc l'envoi groupé reste indisponible.{" "}
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

      <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
        <div className="min-w-0">
          <p className="font-medium text-sm">Qui encaisse</p>
          <p className="mt-0.5 text-muted-foreground text-xs">
            {billedByGandO
              ? "G&O encaisse : Parade n'émet pas ces factures, et elles ne partent jamais d'ici."
              : "Parade encaisse et émet les factures de ce contrat."}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              const res = await setCoworkingContractBilledBy({
                id: contractId,
                billedBy: billedByGandO ? "parade" : "g_and_o",
              });
              if (!res.ok) {
                toast.error(res.message);
                return;
              }
              toast.success(
                res.data.billedBy === "g_and_o" ? "Encaissé par G&O." : "Encaissé par Parade.",
              );
              router.refresh();
            });
          }}
        >
          {billedByGandO ? "Basculer sur Parade" : "Basculer sur G&O"}
        </Button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Inclure ce contrat dans l'envoi groupé ?"
        description={`Ses factures dues apparaîtront dans la liste « Factures à envoyer » de la page Coworking. Au déclenchement, elles seront finalisées chez Dougs puis envoyées à ${recipientEmail ?? "le coworker"}. La finalisation est irréversible : seul un avoir peut annuler une facture émise.`}
        confirmLabel="Activer"
        onConfirm={() => {
          setConfirmOpen(false);
          apply(true);
        }}
      />
    </div>
  );
}
