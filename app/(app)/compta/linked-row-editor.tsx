"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import {
  setProjectBillingMilestoneStatus,
  upsertProjectBillingMilestone,
} from "@/lib/actions/billing-milestones";
import { updateCoworkingInvoice } from "@/lib/actions/coworking";
import { unlinkProjectDougsQuote } from "@/lib/actions/dougs-quotes";
import {
  relinkCoworkingInvoiceDougs,
  relinkProjectDougsQuote,
  relinkProjectMilestoneDougsInvoice,
  unlinkCoworkingInvoiceDougs,
  unlinkProjectMilestoneDougsInvoice,
} from "@/lib/actions/dougs-refresh";
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
      const res = await relinkProjectDougsQuote({
        oldProjectId: quote.projectId,
        newProjectId,
      });
      if (!res.ok) {
        toast.error(res.message);
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

// ---------- Milestone ----------

type MilestoneRow = {
  dougsId: string;
  reference: string | null;
  projectId: string;
  projectName: string;
  entityName: string | null;
  milestoneId: string;
  milestoneLabel: string;
  amountHt: number;
  status: "todo" | "invoiced" | "paid";
  type: "acompte" | "intermediaire" | "solde";
  percent: number | null;
  vatRate: number;
};

export function LinkedMilestoneRow({
  milestone,
  freeMilestones,
}: {
  milestone: MilestoneRow;
  freeMilestones: {
    projectId: string;
    projectName: string;
    milestoneId: string;
    label: string;
    amountHt: number;
  }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [targetKey, setTargetKey] = useState<string | null>(null);
  const [label, setLabel] = useState(milestone.milestoneLabel);
  const [amountStr, setAmountStr] = useState(String(milestone.amountHt));
  const [status, setStatus] = useState(milestone.status);

  const dirtyData =
    label !== milestone.milestoneLabel ||
    Number(amountStr.replace(",", ".")) !== milestone.amountHt ||
    status !== milestone.status;

  // Option synthétique pour combobox: "projectId|milestoneId".
  const options = freeMilestones.map((m) => ({
    id: `${m.projectId}|${m.milestoneId}`,
    label: `${m.projectName} — ${m.label} (${formatEur(m.amountHt)})`,
    searchValue: `${m.projectName} ${m.label} ${formatEur(m.amountHt)}`,
  }));

  function relink() {
    if (!targetKey) return;
    const [newProjectId, newMilestoneId] = targetKey.split("|");
    if (!newProjectId || !newMilestoneId) return;
    startTransition(async () => {
      const res = await relinkProjectMilestoneDougsInvoice({
        oldProjectId: milestone.projectId,
        oldMilestoneId: milestone.milestoneId,
        newProjectId,
        newMilestoneId,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Jalon re-rattaché.");
      setEditing(false);
      setTargetKey(null);
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
      const r1 = await upsertProjectBillingMilestone({
        projectId: milestone.projectId,
        milestoneId: milestone.milestoneId,
        type: milestone.type,
        label: label.trim(),
        percent: milestone.percent,
        amountHt,
        vatRate: milestone.vatRate,
      });
      if (!r1.ok) {
        toast.error(r1.message);
        return;
      }
      if (status !== milestone.status) {
        const r2 = await setProjectBillingMilestoneStatus({
          projectId: milestone.projectId,
          milestoneId: milestone.milestoneId,
          status,
        });
        if (!r2.ok) {
          toast.error(r2.message);
          return;
        }
      }
      toast.success("Jalon mis à jour.");
      setEditing(false);
      router.refresh();
    });
  }

  function unlink() {
    startTransition(async () => {
      const res = await unlinkProjectMilestoneDougsInvoice({
        projectId: milestone.projectId,
        milestoneId: milestone.milestoneId,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Jalon délié.");
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <li className="text-sm">
      <div className={ROW_CLS}>
        <div className="min-w-0 flex-1">
          <span className={BADGE_CLS}>Jalon</span>
          <span className="ml-2 font-mono text-xs">{milestone.reference ?? "—"}</span>
          <Link
            href={`/projets/${milestone.projectId}?tab=billing`}
            className="ml-2 font-medium hover:underline"
          >
            {milestone.projectName}
          </Link>
          <span className="ml-2 text-muted-foreground">
            {milestone.milestoneLabel} ·{" "}
            <span className="tabular-nums">{formatEur(milestone.amountHt)}</span>
            {milestone.entityName ? ` · ${milestone.entityName}` : ""}
          </span>
        </div>
        <a
          href={DOUGS_INV_URL(milestone.dougsId)}
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
            <SectionLabel>Modifier le jalon</SectionLabel>
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
                onChange={(e) => setStatus(e.target.value as MilestoneRow["status"])}
                disabled={pending}
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="todo">À facturer</option>
                <option value="invoiced">Émis</option>
                <option value="paid">Payé</option>
              </select>
              <Button type="button" size="sm" onClick={saveData} disabled={pending || !dirtyData}>
                Enregistrer
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <SectionLabel>Changer le jalon cible</SectionLabel>
            <div className="flex items-center gap-2">
              <FkCombobox
                value={targetKey}
                onValueChange={setTargetKey}
                options={options}
                searchPlaceholder="Rechercher un jalon libre…"
                placeholder="Choisir un autre jalon (tous projets)…"
                disabled={pending}
                className="flex-1"
              />
              <Button type="button" size="sm" onClick={relink} disabled={pending || !targetKey}>
                Re-lier
              </Button>
            </div>
          </div>
          <FooterActions onUnlink={unlink} pending={pending} />
        </div>
      ) : null}
    </li>
  );
}

// ---------- Coworking ----------

type CoworkingRow = {
  dougsId: string;
  reference: string | null;
  coworkingInvoiceId: string;
  invoiceName: string;
  contractName: string | null;
  amountHt: number;
  status: "a_facturer" | "envoyee" | "payee";
};

export function LinkedCoworkingRow({
  coworking,
  freeCoworking,
}: {
  coworking: CoworkingRow;
  freeCoworking: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [targetId, setTargetId] = useState<string | null>(null);
  const [name, setName] = useState(coworking.invoiceName);
  const [status, setStatus] = useState(coworking.status);

  const dirtyData = name !== coworking.invoiceName || status !== coworking.status;

  function relink() {
    if (!targetId || targetId === coworking.coworkingInvoiceId) return;
    startTransition(async () => {
      const res = await relinkCoworkingInvoiceDougs({
        oldCoworkingInvoiceId: coworking.coworkingInvoiceId,
        newCoworkingInvoiceId: targetId,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Facture coworking re-rattachée.");
      setEditing(false);
      setTargetId(null);
      router.refresh();
    });
  }

  function saveData() {
    if (!name.trim()) {
      toast.error("Nom requis.");
      return;
    }
    startTransition(async () => {
      const res = await updateCoworkingInvoice({
        id: coworking.coworkingInvoiceId,
        name: name.trim(),
        status,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Facture coworking mise à jour.");
      setEditing(false);
      router.refresh();
    });
  }

  function unlink() {
    startTransition(async () => {
      const res = await unlinkCoworkingInvoiceDougs({
        coworkingInvoiceId: coworking.coworkingInvoiceId,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Facture coworking déliée.");
      setEditing(false);
      router.refresh();
    });
  }

  return (
    <li className="text-sm">
      <div className={ROW_CLS}>
        <div className="min-w-0 flex-1">
          <span className={BADGE_CLS}>Coworking</span>
          <span className="ml-2 font-mono text-xs">{coworking.reference ?? "—"}</span>
          <Link
            href={`/coworking/factures/${coworking.coworkingInvoiceId}`}
            className="ml-2 font-medium hover:underline"
          >
            {coworking.invoiceName}
          </Link>
          <span className="ml-2 text-muted-foreground">
            {coworking.contractName ?? "—"} ·{" "}
            <span className="tabular-nums">{formatEur(coworking.amountHt)}</span>
          </span>
        </div>
        <a
          href={DOUGS_INV_URL(coworking.dougsId)}
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
            <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Nom"
                disabled={pending}
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as CoworkingRow["status"])}
                disabled={pending}
                className="h-8 rounded-md border bg-background px-2 text-sm outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="a_facturer">À facturer</option>
                <option value="envoyee">Envoyée</option>
                <option value="payee">Payée</option>
              </select>
              <Button type="button" size="sm" onClick={saveData} disabled={pending || !dirtyData}>
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
                options={freeCoworking}
                searchPlaceholder="Rechercher une facture coworking libre…"
                placeholder="Choisir une autre facture coworking…"
                disabled={pending}
                className="flex-1"
              />
              <Button
                type="button"
                size="sm"
                onClick={relink}
                disabled={pending || !targetId || targetId === coworking.coworkingInvoiceId}
              >
                Re-lier
              </Button>
            </div>
          </div>
          <FooterActions onUnlink={unlink} pending={pending} />
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
