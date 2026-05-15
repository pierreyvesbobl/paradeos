"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { pushCoworkingInvoiceToDougs } from "@/lib/actions/coworking";
import {
  linkCoworkingInvoiceDougs,
  refreshCoworkingInvoiceDougs,
} from "@/lib/actions/dougs-refresh";
import { CloudDownload, ExternalLink, Link2, RefreshCw, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  invoiceId: string;
  /** Si déjà poussé : id Dougs pour afficher le lien plutôt que le bouton. */
  dougsInvoiceId: string | null;
  /** URL Dougs pré-calculée côté serveur (companyId stocké en session). */
  dougsUrl: string | null;
};

export function PushToDougsButton({ invoiceId, dougsInvoiceId, dougsUrl }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirmRepush, setConfirmRepush] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [linkInput, setLinkInput] = useState("");

  function push() {
    startTransition(async () => {
      const res = await pushCoworkingInvoiceToDougs({ id: invoiceId });
      if (!res.ok) {
        toast.error(res.message);
        setConfirmRepush(false);
        return;
      }
      toast.success(`Brouillon créé sur Dougs (${res.data.reference}).`);
      setConfirmRepush(false);
      router.refresh();
      window.open(res.data.url, "_blank", "noopener");
    });
  }

  function refresh() {
    startTransition(async () => {
      const res = await refreshCoworkingInvoiceDougs({ coworkingInvoiceId: invoiceId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(
        `Synchro Dougs : ${res.data.reference ?? "—"} · ${res.data.status ?? "—"}${res.data.paidAt ? " · payée" : ""}`,
      );
      router.refresh();
    });
  }

  function link() {
    const val = linkInput.trim();
    if (!val) return;
    startTransition(async () => {
      const res = await linkCoworkingInvoiceDougs({
        coworkingInvoiceId: invoiceId,
        dougsIdOrUrl: val,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Facture Dougs liée : ${res.data.reference ?? "—"}`);
      setShowLink(false);
      setLinkInput("");
      router.refresh();
    });
  }

  if (dougsInvoiceId && dougsUrl) {
    return (
      <>
        <a
          href={dougsUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 text-muted-foreground text-sm hover:bg-muted"
        >
          <ExternalLink className="size-3.5" />
          Voir sur Dougs
        </a>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={pending}
          title="Tirer le statut et les montants finaux depuis Dougs"
        >
          <CloudDownload className="mr-1 size-4" />
          Rafraîchir
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setConfirmRepush(true)}
          disabled={pending}
        >
          <RefreshCw className="mr-1 size-4" />
          {pending ? "Re-push…" : "Re-pousser"}
        </Button>
        <ConfirmDialog
          open={confirmRepush}
          onOpenChange={setConfirmRepush}
          title="Re-pousser le brouillon sur Dougs ?"
          description="Crée un nouveau brouillon avec les valeurs actuelles. L'ancien brouillon reste sur Dougs (à supprimer manuellement si tu veux nettoyer). Le lien stocké est remplacé par le nouveau."
          confirmLabel="Re-pousser"
          onConfirm={push}
          pending={pending}
        />
      </>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" variant="outline" onClick={push} disabled={pending}>
        <Send className="mr-1 size-4" />
        {pending ? "Push…" : "Pousser sur Dougs"}
      </Button>
      {!showLink ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => setShowLink(true)}
          disabled={pending}
          title="Lier une facture Dougs déjà existante"
        >
          <Link2 className="mr-1 size-3.5" />
          Lier existant
        </Button>
      ) : (
        <>
          <Input
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="URL Dougs (/sales-invoices/…) ou UUID"
            disabled={pending}
            className="h-9 max-w-sm font-mono text-xs"
          />
          <Button type="button" size="sm" onClick={link} disabled={pending || !linkInput.trim()}>
            Lier
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setShowLink(false);
              setLinkInput("");
            }}
            disabled={pending}
          >
            Annuler
          </Button>
        </>
      )}
    </div>
  );
}
