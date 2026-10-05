"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { sendProjectInvoiceToClient, sendProjectQuoteToClient } from "@/lib/actions/send-to-client";
import { Eye, PaperPlaneTilt } from "@phosphor-icons/react";
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
 * Aperçu et envoi d'un document client, en pièce jointe de notre mail de marque.
 *
 * L'aperçu part à sa propre adresse et n'émet rien : il télécharge le PDF du
 * brouillon. L'envoi, lui, finalise le document chez Dougs — d'où la
 * confirmation, qui nomme le destinataire et dit ce qui est irréversible.
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
  const [confirmOpen, setConfirmOpen] = useState(false);

  const act = documentKind === "quote" ? sendProjectQuoteToClient : sendProjectInvoiceToClient;
  const noun = documentKind === "quote" ? "devis" : "facture";

  function run(send: boolean) {
    startTransition(async () => {
      const res = await act({ invoiceId, send });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      if ("sent" in res.data) {
        toast.success(`${res.data.reference} envoyé à ${res.data.to}.`);
      } else {
        toast.success(`Aperçu envoyé à ${res.data.to}.`);
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={pending || alreadyIssued}
        title={
          alreadyIssued
            ? `Ce ${noun} est déjà émis : l'aperçu n'a plus d'objet.`
            : "S'envoyer le document tel que le client le recevra, sans rien émettre"
        }
        onClick={() => run(false)}
      >
        <Eye className="mr-1.5 size-4" />
        M'envoyer un aperçu
      </Button>

      <Button
        size="sm"
        disabled={pending || !contactEmail || alreadySent}
        title={
          !contactEmail
            ? "Le contact du projet n'a pas d'adresse mail."
            : alreadySent
              ? "Déjà envoyé au client."
              : undefined
        }
        onClick={() => setConfirmOpen(true)}
      >
        <PaperPlaneTilt className="mr-1.5 size-4" />
        Envoyer au client
      </Button>

      {!contactEmail ? (
        <span className="text-[11px] text-muted-foreground">
          Ajoute l'email du contact du projet pour pouvoir envoyer.
        </span>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Envoyer ce ${noun} à ${clientName} ?`}
        description={
          documentKind === "quote"
            ? `Le devis sera finalisé chez Dougs — il recevra son numéro définitif — puis envoyé à ${contactEmail}, en pièce jointe de notre mail.`
            : `La facture sera finalisée chez Dougs — numéro définitif, irréversible : seul un avoir peut l'annuler — puis envoyée à ${contactEmail}, en pièce jointe de notre mail.`
        }
        confirmLabel="Envoyer"
        onConfirm={() => {
          setConfirmOpen(false);
          run(true);
        }}
      />
    </div>
  );
}
