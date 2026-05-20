"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { unlinkProjectDougsQuote } from "@/lib/actions/dougs-quotes";
import {
  linkProjectQuoteToDougs,
  refreshInvoiceDougs,
  setInvoiceStatus,
} from "@/lib/actions/invoices";
import { CheckCircle2, ExternalLink, FileText, Link2, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Props = {
  projectId: string;
  /** Id de l'invoice kind='quote' liée — nécessaire pour refresh. */
  quoteInvoiceId: string | null;
  /** Status local (mis à jour par cron + actions). Permet l'override
   *  manuel quand l'utilisateur a signé offline mais Dougs reste PENDING. */
  localStatus: "draft" | "sent" | "accepted" | "refused" | "paid" | null;
  dougsQuoteId: string | null;
  dougsQuoteReference: string | null;
  dougsQuoteStatus: string | null;
  dougsQuotePushedAt: string | null;
  dougsQuoteTotalHt: number | null;
  dougsQuoteTotalTtc: number | null;
};

const DOUGS_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  PENDING: "Envoyé / en attente",
  ACCEPTED: "Accepté",
  REFUSED: "Refusé",
};

function formatEur(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

/**
 * UI compacte pour le devis Dougs lié à un projet. Plus de création de
 * devis depuis Paradeos (l'agent MCP s'en charge) — on lit le lien et
 * on rafraîchit le snapshot. "Lier un devis existant" permet de relier
 * un devis créé hors Paradeos (URL ou UUID).
 */
export function DougsQuoteSection({
  projectId,
  quoteInvoiceId,
  localStatus,
  dougsQuoteId,
  dougsQuoteReference,
  dougsQuoteStatus,
  dougsQuotePushedAt,
  dougsQuoteTotalHt,
  dougsQuoteTotalTtc,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [linkInput, setLinkInput] = useState("");
  const [showLink, setShowLink] = useState(false);

  function markAccepted() {
    if (!quoteInvoiceId) return;
    startTransition(async () => {
      const res = await setInvoiceStatus({ id: quoteInvoiceId, status: "accepted" });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Devis marqué comme accepté.");
      router.refresh();
    });
  }

  function refresh() {
    if (!quoteInvoiceId) return;
    startTransition(async () => {
      const res = await refreshInvoiceDougs({ invoiceId: quoteInvoiceId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Synchro Dougs OK.");
      router.refresh();
    });
  }

  function unlink() {
    if (!window.confirm("Désynchroniser le devis Dougs (le devis reste sur Dougs) ?")) return;
    startTransition(async () => {
      const res = await unlinkProjectDougsQuote({ projectId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Lien supprimé.");
      router.refresh();
    });
  }

  function link() {
    const val = linkInput.trim();
    if (!val) return;
    startTransition(async () => {
      const res = await linkProjectQuoteToDougs({ projectId, dougsIdOrUrl: val });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Devis lié : ${res.data.reference ?? "—"}`);
      setLinkInput("");
      setShowLink(false);
      router.refresh();
    });
  }

  if (dougsQuoteId) {
    return (
      <div className="space-y-2 rounded-md border bg-background p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="size-4 text-muted-foreground" />
              <a
                href={`https://app.dougs.fr/app/c/107610/invoicing/quote?status=pending&quoteId=${dougsQuoteId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-sm hover:underline"
                title="Ouvrir sur Dougs"
              >
                {dougsQuoteReference ?? "—"}
                <ExternalLink className="size-3" />
              </a>
              <span className="rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-indigo-700 text-xs dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                {DOUGS_STATUS_LABEL[dougsQuoteStatus ?? "DRAFT"] ?? dougsQuoteStatus ?? "—"}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              {dougsQuoteTotalHt != null ? (
                <span>
                  HT :{" "}
                  <strong className="text-foreground tabular-nums">
                    {formatEur(dougsQuoteTotalHt)}
                  </strong>
                </span>
              ) : null}
              {dougsQuoteTotalTtc != null ? (
                <span>
                  TTC : <span className="tabular-nums">{formatEur(dougsQuoteTotalTtc)}</span>
                </span>
              ) : null}
              {dougsQuotePushedAt ? (
                <span>Lié le {new Date(dougsQuotePushedAt).toLocaleDateString("fr-FR")}</span>
              ) : null}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {/* Override manuel : utile quand le devis a été signé hors
                Dougs et qu'on attend la mise à jour côté Dougs.
                Visible tant que le devis n'est pas déjà accepté ou refusé. */}
            {localStatus !== "accepted" && localStatus !== "refused" ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={markAccepted}
                disabled={pending}
                className="h-7 gap-1 px-2 text-[11px]"
                title="Forcer le statut accepté (override local, indépendant de Dougs)"
              >
                <CheckCircle2 className="size-3" />
                Marquer signé
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={refresh}
              disabled={pending}
              className="h-7 gap-1 px-2 text-xs"
              title="Rafraîchir depuis Dougs"
            >
              <RefreshCw className="size-3" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={unlink}
              disabled={pending}
              className="h-7 px-2 text-muted-foreground hover:text-destructive"
              title="Désynchroniser"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-dashed bg-muted/20 p-3">
      {showLink ? (
        <div className="flex items-center gap-2">
          <Input
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            placeholder="URL Dougs (/invoicing/quotes/…) ou UUID"
            disabled={pending}
            className="h-8 font-mono text-xs"
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
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowLink(true)}
          className="inline-flex items-center gap-1.5 text-muted-foreground text-xs hover:text-foreground hover:underline"
        >
          <Link2 className="size-3.5" />
          Lier un devis Dougs existant (créé via agent MCP ou directement dans Dougs)
        </button>
      )}
    </div>
  );
}
