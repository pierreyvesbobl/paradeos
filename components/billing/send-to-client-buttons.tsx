"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { sendProjectInvoiceToClient, sendProjectQuoteToClient } from "@/lib/actions/send-to-client";
import { Eye, PaperPlaneTilt, Warning } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  invoiceId: string;
  /** Devis et facture ne passent pas par le même endpoint Dougs. */
  documentKind: "invoice" | "quote";
  /** Nom du client, pour que la confirmation dise où ça part. */
  clientName: string;
  /** Adresse du contact du projet. Sans elle, l'envoi est impossible. */
  contactEmail: string | null;
  /** Déjà finalisé chez Dougs : l'aperçu n'a plus d'objet. */
  alreadyIssued: boolean;
  /** Déjà parti au client par nos soins. */
  alreadySent: boolean;
};

/**
 * Rédaction puis envoi d'un document client.
 *
 * Pas de gabarit : on écrit un vrai message, qui part en **texte brut** avec le
 * document en pièce jointe. Un modèle HTML n'a de sens que là où personne n'est
 * là pour rédiger — c'est le cas des factures coworking envoyées par le cron,
 * pas celui d'un devis adressé à un client.
 *
 * Deux issues depuis la même fenêtre : l'aperçu, qui s'envoie à soi-même sans
 * rien émettre, et l'envoi, qui finalise le document chez Dougs.
 */
export function SendToClientButtons({
  invoiceId,
  documentKind,
  clientName,
  contactEmail,
  alreadyIssued,
  alreadySent,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [confirming, setConfirming] = useState(false);

  const act = documentKind === "quote" ? sendProjectQuoteToClient : sendProjectInvoiceToClient;
  const noun = documentKind === "quote" ? "devis" : "facture";
  const ready = subject.trim().length > 0 && body.trim().length > 0;

  function run(send: boolean) {
    startTransition(async () => {
      const res = await act({ invoiceId, send, subject, body });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if ("sent" in res.data) {
        toast.success(`${res.data.reference} envoyé à ${res.data.to}.`);
        setOpen(false);
      } else {
        toast.success(`Aperçu envoyé à ${res.data.to}.`);
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={alreadySent}
        title={alreadySent ? `Ce ${noun} a déjà été envoyé au client.` : undefined}
        onClick={() => setOpen(true)}
      >
        <PaperPlaneTilt className="mr-1.5 size-4" />
        Rédiger et envoyer
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              Envoyer le {noun} à {clientName}
            </DialogTitle>
            <DialogDescription>
              Le message part en texte brut, avec le {noun} en pièce jointe. Écris-le comme tu
              l'écrirais à la main.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mailSubject">Objet</Label>
              <Input
                id="mailSubject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={
                  documentKind === "quote" ? "Notre proposition pour…" : "Votre facture pour…"
                }
                disabled={pending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mailBody">Message</Label>
              <Textarea
                id="mailBody"
                rows={10}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={"Bonjour,\n\n…\n\nBien à vous,"}
                disabled={pending}
                className="font-mono text-xs"
              />
            </div>

            <p className="text-[11px] text-muted-foreground">
              Destinataire de l'envoi :{" "}
              {contactEmail ? (
                <span className="font-mono">{contactEmail}</span>
              ) : (
                <span className="text-amber-700 dark:text-amber-400">
                  aucune adresse sur le contact du projet
                </span>
              )}
              . L'aperçu, lui, part à toi.
            </p>

            {confirming ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                <p className="flex items-start gap-1.5 font-medium text-amber-800 text-xs dark:text-amber-300">
                  <Warning className="mt-0.5 size-3.5 shrink-0" />
                  {documentKind === "quote"
                    ? `Le devis sera finalisé chez Dougs — numéro définitif — puis envoyé à ${contactEmail}.`
                    : `La facture sera finalisée chez Dougs — numéro définitif, irréversible : seul un avoir peut l'annuler — puis envoyée à ${contactEmail}.`}
                </p>
              </div>
            ) : null}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              variant="outline"
              size="sm"
              disabled={pending || !ready || alreadyIssued}
              title={
                alreadyIssued
                  ? `Ce ${noun} est déjà émis : l'aperçu n'a plus d'objet.`
                  : "S'envoyer le message tel que le client le recevra, sans rien émettre"
              }
              onClick={() => run(false)}
            >
              <Eye className="mr-1.5 size-4" />
              M'envoyer un aperçu
            </Button>

            <Button
              size="sm"
              disabled={pending || !ready || !contactEmail}
              onClick={() => (confirming ? run(true) : setConfirming(true))}
            >
              <PaperPlaneTilt className="mr-1.5 size-4" />
              {confirming ? "Confirmer l'envoi" : "Envoyer au client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
