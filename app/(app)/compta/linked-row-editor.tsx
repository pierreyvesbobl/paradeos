"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import { unlinkProjectDougsQuote } from "@/lib/actions/dougs-quotes";
import {
  deleteInvoice,
  linkProjectQuoteToDougs,
  moveInvoiceDougsLink,
  setInvoiceStatus,
  unlinkInvoiceDougs,
  upsertInvoice,
} from "@/lib/actions/invoices";
import { cn } from "@/lib/utils";
import { ExternalLink, Pencil, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

function formatEur(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

const DOUGS_INV_URL = (id: string) =>
  `https://app.dougs.fr/app/c/107610/invoicing/sales-invoice?status=waiting&salesInvoiceId=${id}`;
const DOUGS_QUOTE_URL = (id: string) =>
  `https://app.dougs.fr/app/c/107610/invoicing/quote?status=pending&quoteId=${id}`;

const ROW_CLS =
  "flex items-center justify-between gap-3 px-6 py-3 text-sm hover:bg-muted/20 transition-colors";
const BADGE_CLS = "rounded bg-muted/50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide";

// ---------- Quote ----------

type QuoteRow = {
  invoiceId: string;
  dougsId: string;
  reference: string | null;
  status: string | null;
  projectId: string;
  projectName: string;
  entityName: string | null;
};

export function LinkedQuoteRow({
  quote,
  projectOptions,
}: {
  quote: QuoteRow;
  projectOptions: { id: string; name: string; entityName: string | null }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [newProjectId, setNewProjectId] = useState<string | null>(null);

  function relink() {
    if (!newProjectId || newProjectId === quote.projectId) return;
    startTransition(async () => {
      // Relink = unlink ancien projet + link nouveau projet avec même
      // dougsQuoteId (re-fetch côté Dougs pour fraîcheur du snapshot).
      const unlinkRes = await unlinkProjectDougsQuote({ projectId: quote.projectId });
      if (!unlinkRes.ok) {
        toast.error(unlinkRes.message);
        return;
      }
      const linkRes = await linkProjectQuoteToDougs({
        projectId: newProjectId,
        dougsIdOrUrl: quote.dougsId,
      });
      if (!linkRes.ok) {
        toast.error(linkRes.message);
        return;
      }
      toast.success("Devis re-rattaché.");
      setEditing(false);
      setNewProjectId(null);
      router.refresh();
    });
  }

  function unlink() {
    startTransition(async () => {
      const res = await unlinkProjectDougsQuote({ projectId: quote.projectId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Devis délié.");
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <li className="text-sm">
      <div className={ROW_CLS}>
        <div className="min-w-0 flex-1">
          <span className={BADGE_CLS}>Devis</span>
          <span className="ml-2 font-mono text-xs">{quote.reference ?? "—"}</span>
          {quote.status ? (
            <span className="ml-2 rounded-full border bg-muted/30 px-1.5 py-0.5 text-[10px]">
              {quote.status}
            </span>
          ) : null}
          <Link href={`/projets/${quote.projectId}`} className="ml-2 font-medium hover:underline">
            {quote.projectName}
          </Link>
          {quote.entityName ? (
            <span className="ml-2 text-muted-foreground">{quote.entityName}</span>
          ) : null}
        </div>
        <a
          href={DOUGS_QUOTE_URL(quote.dougsId)}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Ouvrir sur Dougs"
        >
          <ExternalLink className="size-3.5" />
        </a>
        <EditToggle editing={editing} onToggle={() => setEditing((v) => !v)} />
      </div>
      {editing ? (
        <div className="space-y-2 border-t bg-muted/10 px-6 py-3">
          <SectionLabel>Changer le projet cible</SectionLabel>
          <div className="flex items-center gap-2">
            <FkCombobox
              value={newProjectId}
              onValueChange={setNewProjectId}
              options={projectOptions.map((p) => ({
                id: p.id,
                label: p.name,
                searchValue: `${p.name} ${p.entityName ?? ""}`,
              }))}
              searchPlaceholder="Rechercher un projet…"
              placeholder="Choisir un autre projet…"
              disabled={pending}
              className="flex-1"
            />
            <Button
              type="button"
              size="sm"
              onClick={relink}
              disabled={pending || !newProjectId || newProjectId === quote.projectId}
            >
              Re-lier
            </Button>
          </div>
          <FooterActions onUnlink={unlink} pending={pending} />
        </div>
      ) : null}
    </li>
  );
}

// ---------- Invoice (milestone | coworking | one_off) ----------

type InvoiceRow = {
  invoiceId: string;
  dougsId: string;
  reference: string | null;
  kind: "milestone" | "coworking" | "one_off";
  label: string;
  amountHt: number;
  status: "draft" | "sent" | "accepted" | "refused" | "paid";
  projectId: string | null;
  projectName: string | null;
  coworkingContractId: string | null;
  contractName: string | null;
  entityName: string | null;
};

type FreeInvoice = {
  id: string;
  kind: "milestone" | "coworking" | "one_off";
  label: string;
  amountHt: number;
  projectName: string | null;
  contractName: string | null;
};

export function LinkedInvoiceRow({
  invoice,
  freeInvoices,
}: {
  invoice: InvoiceRow;
  freeInvoices: FreeInvoice[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [label, setLabel] = useState(invoice.label);
  const [amountStr, setAmountStr] = useState(String(invoice.amountHt));
  const [status, setStatus] = useState<"draft" | "sent" | "paid">(
    invoice.status === "paid" ? "paid" : invoice.status === "sent" ? "sent" : "draft",
  );

  const dirty =
    label !== invoice.label ||
    Number(amountStr.replace(",", ".")) !== invoice.amountHt ||
    status !== (invoice.status === "paid" ? "paid" : invoice.status === "sent" ? "sent" : "draft");

  // Picker : on filtre les invoices libres du même kind par défaut
  // (jalon → jalons libres, coworking → coworking libres, one_off → one_off).
  // L'utilisateur peut tout de même choisir un autre kind via la recherche.
  const options = freeInvoices.map((m) => ({
    id: m.id,
    label: `${m.kind === "milestone" ? "Jalon" : m.kind === "coworking" ? "Coworking" : "One-off"} · ${m.projectName ?? m.contractName ?? "?"} — ${m.label} (${formatEur(m.amountHt)})`,
    searchValue: `${m.projectName ?? ""} ${m.contractName ?? ""} ${m.label} ${formatEur(m.amountHt)}`,
  }));

  function relink() {
    if (!targetId) return;
    startTransition(async () => {
      const res = await moveInvoiceDougsLink({
        fromInvoiceId: invoice.invoiceId,
        toInvoiceId: targetId,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Lien Dougs déplacé.");
      setEditing(false);
      setTargetId(null);
      router.refresh();
    });
  }

  function saveData() {
    const amountHt = Number(amountStr.replace(",", "."));
    if (!Number.isFinite(amountHt) || amountHt < 0) {
      toast.error("Montant invalide.");
      return;
    }
    if (!label.trim()) {
      toast.error("Label requis.");
      return;
    }
    startTransition(async () => {
      const r1 = await upsertInvoice({
        id: invoice.invoiceId,
        kind: invoice.kind,
        projectId: invoice.projectId,
        coworkingContractId: invoice.coworkingContractId,
        label: label.trim(),
        amountHt,
        vatRate: 0.2,
        status: invoice.status,
      });
      if (!r1.ok) {
        toast.error(r1.message);
        return;
      }
      const currentDb =
        invoice.status === "paid" ? "paid" : invoice.status === "sent" ? "sent" : "draft";
      if (status !== currentDb) {
        const r2 = await setInvoiceStatus({ id: invoice.invoiceId, status });
        if (!r2.ok) {
          toast.error(r2.message);
          return;
        }
      }
      toast.success("Facture mise à jour.");
      setEditing(false);
      router.refresh();
    });
  }

  function unlink() {
    startTransition(async () => {
      const res = await unlinkInvoiceDougs({ invoiceId: invoice.invoiceId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Facture déliée.");
      setEditing(false);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm("Supprimer cette facture Paradeos ?")) return;
    startTransition(async () => {
      const res = await deleteInvoice({ id: invoice.invoiceId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Facture supprimée.");
      router.refresh();
    });
  }

  const kindLabel =
    invoice.kind === "milestone" ? "Jalon" : invoice.kind === "coworking" ? "Coworking" : "Facture";
  const link =
    invoice.kind === "milestone" && invoice.projectId
      ? `/projets/${invoice.projectId}?tab=billing`
      : invoice.kind === "coworking"
        ? `/coworking/factures/${invoice.invoiceId}`
        : null;

  return (
    <li className="text-sm">
      <div className={ROW_CLS}>
        <div className="min-w-0 flex-1">
          <span className={BADGE_CLS}>{kindLabel}</span>
          <span className="ml-2 font-mono text-xs">{invoice.reference ?? "—"}</span>
          {link ? (
            <Link href={link} className="ml-2 font-medium hover:underline">
              {invoice.projectName ?? invoice.contractName ?? invoice.label}
            </Link>
          ) : (
            <span className="ml-2 font-medium">{invoice.label}</span>
          )}
          <span className="ml-2 text-muted-foreground">
            {invoice.label} · <span className="tabular-nums">{formatEur(invoice.amountHt)}</span>
            {invoice.entityName ? ` · ${invoice.entityName}` : ""}
          </span>
        </div>
        <a
          href={DOUGS_INV_URL(invoice.dougsId)}
          target="_blank"
          rel="noreferrer"
          className="text-muted-foreground hover:text-foreground"
          aria-label="Ouvrir sur Dougs"
        >
          <ExternalLink className="size-3.5" />
        </a>
        <EditToggle editing={editing} onToggle={() => setEditing((v) => !v)} />
      </div>
      {editing ? (
        <div className="space-y-3 border-t bg-muted/10 px-6 py-3">
          <div className="space-y-2">
            <SectionLabel>Modifier la facture</SectionLabel>
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Label"
                disabled={pending}
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="text"
                inputMode="decimal"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                placeholder="Montant HT"
                disabled={pending}
                className="h-8 rounded-md border bg-background px-2 text-sm tabular-nums outline-none focus:ring-1 focus:ring-ring"
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "draft" | "sent" | "paid")}
                disabled={pending}
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="draft">À facturer</option>
                <option value="sent">Émis</option>
                <option value="paid">Payé</option>
              </select>
              <Button type="button" size="sm" onClick={saveData} disabled={pending || !dirty}>
                Enregistrer
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <SectionLabel>Changer la facture cible</SectionLabel>
            <div className="flex items-center gap-2">
              <FkCombobox
                value={targetId}
                onValueChange={setTargetId}
                options={options}
                searchPlaceholder="Rechercher une facture libre…"
                placeholder="Choisir une autre facture (toutes catégories)…"
                disabled={pending}
                className="flex-1"
              />
              <Button type="button" size="sm" onClick={relink} disabled={pending || !targetId}>
                Re-lier
              </Button>
            </div>
          </div>
          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              Supprimer la facture
            </button>
            <button
              type="button"
              onClick={unlink}
              disabled={pending}
              className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
            >
              Délier ce Dougs
            </button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

// ---------- Sub-components ----------

function EditToggle({ editing, onToggle }: { editing: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
        editing && "bg-muted text-foreground",
      )}
      aria-label={editing ? "Fermer l'éditeur" : "Modifier"}
      title={editing ? "Fermer" : "Modifier"}
    >
      {editing ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
    </button>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-medium text-[10px] text-muted-foreground uppercase tracking-wide">
      {children}
    </div>
  );
}

function FooterActions({ onUnlink, pending }: { onUnlink: () => void; pending: boolean }) {
  return (
    <div className="flex items-center justify-end pt-1">
      <button
        type="button"
        onClick={onUnlink}
        disabled={pending}
        className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
      >
        Délier ce Dougs
      </button>
    </div>
  );
}
