"use client";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Invoice } from "@/db/schema/invoices";
import {
  deleteInvoice,
  linkInvoiceToDougs,
  refreshInvoiceDougs,
  seedProjectMilestones,
  setInvoiceStatus,
  upsertInvoice,
} from "@/lib/actions/invoices";
import {
  Check,
  ExternalLink,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

type MilestoneType = "acompte" | "intermediaire" | "solde";
type UiStatus = "todo" | "invoiced" | "paid";

type MilestoneView = {
  id: string;
  type: MilestoneType;
  label: string;
  percent: number | null;
  amountHt: number;
  status: UiStatus;
  dougsInvoiceId: string | null;
  dougsInvoiceReference: string | null;
  invoicedAt: string | null;
  paidAt: string | null;
};

type Props = {
  projectId: string;
  projectValueHt: number;
  milestones: Invoice[];
};

const TYPE_LABEL: Record<MilestoneType, string> = {
  acompte: "Acompte",
  intermediaire: "Intermédiaire",
  solde: "Solde",
};

const STATUS_BADGE: Record<UiStatus, string> = {
  todo: "border-amber-300 bg-amber-50 text-amber-700",
  invoiced: "border-indigo-300 bg-indigo-50 text-indigo-700",
  paid: "border-emerald-300 bg-emerald-50 text-emerald-700",
};

const STATUS_LABEL: Record<UiStatus, string> = {
  todo: "À facturer",
  invoiced: "Facturé",
  paid: "Payé",
};

function toUiStatus(s: Invoice["status"]): UiStatus {
  if (s === "paid") return "paid";
  if (s === "sent") return "invoiced";
  return "todo";
}

function toDbStatus(s: UiStatus): "draft" | "sent" | "paid" {
  if (s === "paid") return "paid";
  if (s === "invoiced") return "sent";
  return "draft";
}

function adapt(i: Invoice): MilestoneView {
  return {
    id: i.id,
    type: (i.milestoneType as MilestoneType) ?? "intermediaire",
    label: i.label,
    percent: i.milestonePercent,
    amountHt: Number(i.amountHt) || 0,
    status: toUiStatus(i.status),
    dougsInvoiceId: i.dougsInvoiceId,
    dougsInvoiceReference: i.dougsReference,
    invoicedAt: i.invoicedAt ? i.invoicedAt.toISOString() : null,
    paidAt: i.paidAt ? i.paidAt.toISOString() : null,
  };
}

function formatEur(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

type Draft = {
  milestoneId: string | null;
  type: MilestoneType;
  label: string;
  mode: "percent" | "amount";
  percent: number;
  amountHt: number;
};

function emptyDraft(projectValueHt: number): Draft {
  return {
    milestoneId: null,
    type: "acompte",
    label: "Acompte",
    mode: "percent",
    percent: 40,
    amountHt: Math.round(projectValueHt * 0.4 * 100) / 100,
  };
}

export function BillingMilestonesSection({ projectId, projectValueHt, milestones }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const rows = useMemo(() => milestones.map(adapt), [milestones]);
  const total = useMemo(
    () => Math.round(rows.reduce((s, m) => s + m.amountHt, 0) * 100) / 100,
    [rows],
  );
  const pct = projectValueHt > 0 ? Math.round((total / projectValueHt) * 100) : null;

  function openCreate() {
    setDraft(emptyDraft(projectValueHt));
  }

  function openEdit(m: MilestoneView) {
    setDraft({
      milestoneId: m.id,
      type: m.type,
      label: m.label,
      mode: m.percent != null ? "percent" : "amount",
      percent: m.percent ?? 0,
      amountHt: m.amountHt,
    });
  }

  function updateDraft(patch: Partial<Draft>) {
    if (!draft) return;
    const next = { ...draft, ...patch };
    if (next.mode === "percent" && projectValueHt > 0) {
      next.amountHt = Math.round(projectValueHt * (next.percent / 100) * 100) / 100;
    } else if (next.mode === "amount" && projectValueHt > 0) {
      next.percent = Math.round((next.amountHt / projectValueHt) * 1000) / 10;
    }
    setDraft(next);
  }

  function save() {
    if (!draft) return;
    startTransition(async () => {
      const res = await upsertInvoice({
        id: draft.milestoneId,
        kind: "milestone",
        projectId,
        label: draft.label.trim(),
        amountHt: draft.amountHt,
        vatRate: 0.2,
        status: "draft",
        milestoneType: draft.type,
        milestonePercent: draft.mode === "percent" ? Math.round(draft.percent) : null,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(draft.milestoneId ? "Jalon mis à jour." : "Jalon ajouté.");
      setDraft(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteInvoice({ id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Jalon supprimé.");
      setConfirmDelete(null);
      router.refresh();
    });
  }

  function refreshDougs(id: string) {
    startTransition(async () => {
      const res = await refreshInvoiceDougs({ invoiceId: id });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Synchro Dougs OK.");
      router.refresh();
    });
  }

  const [linkingId, setLinkingId] = useState<string | null>(null);
  const [linkInput, setLinkInput] = useState("");
  function linkDougs(milestoneId: string) {
    const val = linkInput.trim();
    if (!val) return;
    startTransition(async () => {
      const res = await linkInvoiceToDougs({ invoiceId: milestoneId, dougsIdOrUrl: val });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Facture Dougs liée.");
      setLinkingId(null);
      setLinkInput("");
      router.refresh();
    });
  }

  function setStatus(id: string, status: UiStatus) {
    startTransition(async () => {
      const res = await setInvoiceStatus({ id, status: toDbStatus(status) });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      router.refresh();
    });
  }

  function seedDefaults() {
    startTransition(async () => {
      const res = await seedProjectMilestones({
        projectId,
        totalHt: projectValueHt,
        acomptePercent: 40,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success("Jalons 40 / 60 ajoutés.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 && !draft ? (
        <div className="rounded-md border border-dashed bg-muted/30 p-3 text-xs">
          <p className="mb-2 text-muted-foreground">
            Aucun jalon. Le total des jalons doit couvrir le montant projet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={seedDefaults}
              disabled={pending || projectValueHt <= 0}
              className="gap-1.5"
            >
              <Sparkles className="size-3.5" />
              Init 40 % / 60 %
            </Button>
            <Button type="button" size="sm" onClick={openCreate} className="gap-1.5">
              <Plus className="size-3.5" />
              Ajouter un jalon
            </Button>
          </div>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ul className="divide-y rounded-md border bg-background">
          {rows.map((m) => (
            <li key={m.id} className="space-y-2 px-3 py-2.5 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-sm">{m.label}</span>
                    <span className="rounded-full border bg-muted/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {TYPE_LABEL[m.type]}
                    </span>
                    <span
                      className={`rounded-full border px-1.5 py-0.5 text-[10px] ${STATUS_BADGE[m.status]}`}
                    >
                      {STATUS_LABEL[m.status]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-muted-foreground">
                    {m.percent != null ? `${m.percent} % · ` : null}
                    <span className="font-medium text-foreground tabular-nums">
                      {formatEur(m.amountHt)} HT
                    </span>
                    {m.dougsInvoiceReference && m.dougsInvoiceId ? (
                      <>
                        {" · "}
                        <a
                          href={`https://app.dougs.fr/app/c/107610/invoicing/sales-invoice?status=${m.status === "paid" ? "paid" : "waiting"}&salesInvoiceId=${m.dougsInvoiceId}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-0.5 font-mono hover:underline"
                          title="Ouvrir sur Dougs"
                        >
                          {m.dougsInvoiceReference}
                          <ExternalLink className="size-2.5" />
                        </a>
                      </>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {m.status === "todo" && !m.dougsInvoiceId ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setLinkingId(m.id);
                        setLinkInput("");
                      }}
                      disabled={pending}
                      className="h-7 gap-1 px-2 text-[11px]"
                      title="Lier une facture Dougs existante"
                    >
                      <Link2 className="size-3" />
                      Lier
                    </Button>
                  ) : null}
                  {m.status === "invoiced" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setStatus(m.id, "paid")}
                      disabled={pending}
                      className="h-7 gap-1 px-2 text-[11px]"
                    >
                      <Check className="size-3" />
                      Marquer payé
                    </Button>
                  ) : null}
                  {m.dougsInvoiceId ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => refreshDougs(m.id)}
                        disabled={pending}
                        className="h-7 px-2 text-[11px]"
                        title="Rafraîchir depuis Dougs"
                      >
                        <RefreshCw className="size-3" />
                      </Button>
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-[11px]"
                        title="Ouvrir sur Dougs"
                      >
                        <a
                          href={`https://app.dougs.fr/app/c/107610/invoicing/sales-invoice?status=${m.status === "paid" ? "paid" : "waiting"}&salesInvoiceId=${m.dougsInvoiceId}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink className="size-3" />
                        </a>
                      </Button>
                    </>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => openEdit(m)}
                    disabled={pending}
                    className="h-7 px-2 text-muted-foreground"
                    title="Éditer"
                  >
                    <Pencil className="size-3" />
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmDelete(m.id)}
                    disabled={pending}
                    className="h-7 px-2 text-muted-foreground hover:text-destructive"
                    title="Supprimer"
                  >
                    <Trash2 className="size-3" />
                  </Button>
                </div>
              </div>
              {m.status !== "todo" ? (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {m.invoicedAt ? (
                    <span>Facturé le {new Date(m.invoicedAt).toLocaleDateString("fr-FR")}</span>
                  ) : null}
                  {m.paidAt ? (
                    <span>· Payé le {new Date(m.paidAt).toLocaleDateString("fr-FR")}</span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setStatus(m.id, "todo")}
                    className="ml-auto underline hover:no-underline"
                    disabled={pending}
                  >
                    Revenir à "À facturer"
                  </button>
                </div>
              ) : null}
              {linkingId === m.id ? (
                <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/30 p-2">
                  <Input
                    value={linkInput}
                    onChange={(e) => setLinkInput(e.target.value)}
                    placeholder="URL Dougs (/sales-invoices/…) ou UUID"
                    disabled={pending}
                    className="h-7 font-mono text-[11px]"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => linkDougs(m.id)}
                    disabled={pending || !linkInput.trim()}
                    className="h-7 text-[11px]"
                  >
                    Lier
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setLinkingId(null);
                      setLinkInput("");
                    }}
                    disabled={pending}
                    className="h-7 text-[11px]"
                  >
                    Annuler
                  </Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {rows.length > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
          <div>
            <span>
              Total jalons : <strong className="tabular-nums">{formatEur(total)}</strong>
            </span>
            {projectValueHt > 0 ? (
              <span className="ml-2 text-muted-foreground">
                ({pct} % de {formatEur(projectValueHt)})
              </span>
            ) : null}
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={openCreate}
            disabled={pending}
            className="h-7 gap-1.5 text-xs"
          >
            <Plus className="size-3" />
            Ajouter
          </Button>
        </div>
      ) : null}

      {draft ? (
        <div className="space-y-3 rounded-md border bg-background p-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Type</Label>
              <select
                value={draft.type}
                onChange={(e) => updateDraft({ type: e.target.value as MilestoneType })}
                disabled={pending}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              >
                <option value="acompte">Acompte</option>
                <option value="intermediaire">Intermédiaire</option>
                <option value="solde">Solde</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Label</Label>
              <Input
                value={draft.label}
                onChange={(e) => updateDraft({ label: e.target.value })}
                disabled={pending}
                className="h-8 text-xs"
                placeholder="Ex. Acompte 30 %"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] text-muted-foreground uppercase">Saisie en</Label>
              <select
                value={draft.mode}
                onChange={(e) => updateDraft({ mode: e.target.value as "percent" | "amount" })}
                disabled={pending}
                className="h-8 w-full rounded-md border bg-background px-2 text-xs"
              >
                <option value="percent">% du montant projet</option>
                <option value="amount">€ HT direct</option>
              </select>
            </div>
            {draft.mode === "percent" ? (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase">% projet</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.5"
                  value={draft.percent}
                  onChange={(e) => updateDraft({ percent: Number(e.target.value) || 0 })}
                  disabled={pending}
                  className="h-8 text-xs"
                />
              </div>
            ) : (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground uppercase">€ HT</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.amountHt}
                  onChange={(e) => updateDraft({ amountHt: Number(e.target.value) || 0 })}
                  disabled={pending}
                  className="h-8 text-xs"
                />
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            {draft.mode === "percent" ? (
              <>
                Montant calculé : <strong>{formatEur(draft.amountHt)} HT</strong>
              </>
            ) : (
              <>
                Équivaut à <strong>{draft.percent.toLocaleString("fr-FR")} %</strong>
                {projectValueHt > 0 ? ` de ${formatEur(projectValueHt)}` : null}
              </>
            )}
          </p>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDraft(null)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={save}
              disabled={pending || !draft.label.trim() || draft.amountHt <= 0}
            >
              {draft.milestoneId ? "Mettre à jour" : "Ajouter"}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(confirmDelete)}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        title="Supprimer ce jalon ?"
        description="Si une facture Dougs est liée, elle ne sera pas supprimée côté Dougs."
        confirmLabel="Supprimer"
        variant="destructive"
        onConfirm={() => confirmDelete && remove(confirmDelete)}
        pending={pending}
      />
    </div>
  );
}
