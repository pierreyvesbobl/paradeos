"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { sendDueCoworkingInvoices } from "@/lib/actions/coworking";
import { PaperPlaneTilt, Warning } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

export type DueRow = {
  invoiceId: string;
  contractName: string;
  label: string;
  frequency: string;
  amountHt: string;
  recipient: string | null;
  blocker: string | null;
};

/**
 * Envoi groupé des factures coworking dues.
 *
 * Remplace l'envoi automatique par le cron : l'API Dougs s'authentifie par un
 * cookie de session rafraîchi par l'extension Chrome, donc un envoi nocturne
 * sans personne devant la machine est un pari. Déclenché d'ici, le cookie est
 * frais par construction.
 *
 * La liste est affichée **avant** le clic, et c'est elle qui fait office de
 * relecture : les contrats n'ont pas la même fréquence, donc on ne « facture
 * pas le mois », on envoie ce qui est effectivement dû. Voir la période et le
 * montant de chaque ligne est ce qui permet de s'en assurer.
 */
export function SendDueInvoices({ rows, enabled }: { rows: DueRow[]; enabled: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const sendable = rows.filter((r) => !r.blocker);
  const stuck = rows.filter((r) => r.blocker);
  const total = sendable.reduce((sum, r) => sum + Number(r.amountHt), 0);

  function run() {
    startTransition(async () => {
      const res = await sendDueCoworkingInvoices({});
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      const { sent, blocked, errors } = res.data;
      if (sent.length > 0) {
        toast.success(
          `${sent.length} facture${sent.length > 1 ? "s" : ""} envoyée${sent.length > 1 ? "s" : ""}.`,
        );
      }
      for (const e of errors) toast.error(`${e.contractName} — ${e.message}`);
      for (const b of blocked) toast.warning(`${b.contractName} — ${b.reason}`);
      if (sent.length === 0 && errors.length === 0 && blocked.length === 0) {
        toast.info("Rien à envoyer.");
      }
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground text-xs">
        Aucune facture à envoyer. Les factures apparaissent ici dès que la période d'un contrat
        opt-in est due.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-md border">
        {rows.map((r) => (
          <li key={r.invoiceId} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-sm">
                {r.contractName} — {r.label}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {r.frequency === "quarterly" ? "Trimestriel" : "Mensuel"} ·{" "}
                {Number(r.amountHt).toLocaleString("fr-FR", {
                  style: "currency",
                  currency: "EUR",
                })}{" "}
                HT
                {r.recipient ? ` · ${r.recipient}` : ""}
              </p>
              {r.blocker ? (
                <p className="mt-0.5 flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                  <Warning className="mt-0.5 size-3 shrink-0" />
                  {r.blocker}
                </p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={pending || !enabled || sendable.length === 0}
          title={
            !enabled
              ? "L'envoi groupé est désactivé dans les réglages."
              : sendable.length === 0
                ? "Aucune facture envoyable en l'état."
                : undefined
          }
          onClick={() => setConfirmOpen(true)}
        >
          <PaperPlaneTilt className="mr-1.5 size-4" />
          Envoyer {sendable.length} facture{sendable.length > 1 ? "s" : ""}
        </Button>
        {stuck.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">
            {stuck.length} bloquée{stuck.length > 1 ? "s" : ""}, à corriger d'abord.
          </span>
        ) : null}
        {!enabled ? (
          <span className="text-[11px] text-amber-700 dark:text-amber-400">
            Envoi désactivé dans les réglages.
          </span>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Envoyer ${sendable.length} facture${sendable.length > 1 ? "s" : ""} ?`}
        description={`Chacune sera finalisée chez Dougs — numéro définitif, irréversible : seul un avoir peut l'annuler — puis envoyée au coworker, avec le PDF en pièce jointe. Total ${total.toLocaleString(
          "fr-FR",
          { style: "currency", currency: "EUR" },
        )} HT.`}
        confirmLabel="Envoyer"
        onConfirm={() => {
          setConfirmOpen(false);
          run();
        }}
      />
    </div>
  );
}
