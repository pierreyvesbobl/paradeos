"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { pushProjectQuoteToDougs, unlinkProjectDougsQuote } from "@/lib/actions/dougs-quotes";
import { refreshProjectDougsQuote } from "@/lib/actions/dougs-refresh";
import { ExternalLink, FileText, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Line = {
  title: string;
  description: string;
  unit: string;
  quantity: number;
  unitAmount: number;
  vatRate: number;
};

type Props = {
  projectId: string;
  defaultUnitAmount: number;
  defaultTitle: string;
  dougsQuoteId: string | null;
  dougsQuoteReference: string | null;
  dougsQuoteStatus: string | null;
  dougsQuotePushedAt: string | null;
};

const DOUGS_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Brouillon",
  PENDING: "Envoyé / en attente",
  ACCEPTED: "Accepté",
  REFUSED: "Refusé",
};

const UNIT_OPTIONS = ["forfait", "unité", "jour", "heure", "mois"];

function makeDefaultLine(title: string, unitAmount: number): Line {
  return {
    title: title || "Prestation",
    description: "",
    unit: "forfait",
    quantity: 1,
    unitAmount,
    vatRate: 0.2,
  };
}

function lineTotal(l: Line): number {
  return Math.round(l.quantity * l.unitAmount * 100) / 100;
}

export function DougsQuoteSection({
  projectId,
  defaultUnitAmount,
  defaultTitle,
  dougsQuoteId,
  dougsQuoteReference,
  dougsQuoteStatus,
  dougsQuotePushedAt,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(!dougsQuoteId);
  const [lines, setLines] = useState<Line[]>([makeDefaultLine(defaultTitle, defaultUnitAmount)]);
  const [subject, setSubject] = useState("");
  const [thankYouNote, setThankYouNote] = useState("");
  const [openUrl, setOpenUrl] = useState<string | null>(null);

  const totalHt = Math.round(lines.reduce((s, l) => s + lineTotal(l), 0) * 100) / 100;
  const totalVat = Math.round(lines.reduce((s, l) => s + lineTotal(l) * l.vatRate, 0) * 100) / 100;
  const totalTtc = Math.round((totalHt + totalVat) * 100) / 100;

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setLines((prev) => [
      ...prev,
      { title: "", description: "", unit: "forfait", quantity: 1, unitAmount: 0, vatRate: 0.2 },
    ]);
  }

  function removeLine(idx: number) {
    setLines((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }

  function push() {
    const cleaned = lines.filter((l) => l.title.trim().length > 0);
    if (cleaned.length === 0) {
      toast.error("Au moins une ligne avec un titre.");
      return;
    }
    startTransition(async () => {
      const res = await pushProjectQuoteToDougs({
        projectId,
        subject: subject.trim(),
        thankYouNote: thankYouNote.trim(),
        lines: cleaned.map((l) => ({
          title: l.title.trim(),
          description: l.description.trim(),
          unit: l.unit,
          quantity: l.quantity,
          unitAmount: l.unitAmount,
          vatRate: l.vatRate,
          discount: 0,
          discountUnit: "%" as const,
        })),
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Devis ${res.data.reference} poussé sur Dougs.`);
      setOpenUrl(res.data.url);
      setShowForm(false);
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

  function refresh() {
    startTransition(async () => {
      const res = await refreshProjectDougsQuote({ projectId });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Synchro Dougs : ${res.data.reference ?? "—"} · ${res.data.status ?? "—"}`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      {dougsQuoteId ? (
        <div className="rounded-md border bg-background p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                <span className="font-mono text-sm">{dougsQuoteReference ?? "—"}</span>
                <span className="rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-indigo-700 text-xs dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                  {DOUGS_STATUS_LABEL[dougsQuoteStatus ?? "DRAFT"] ?? dougsQuoteStatus ?? "—"}
                </span>
              </div>
              {dougsQuotePushedAt ? (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Poussé le {new Date(dougsQuotePushedAt).toLocaleString("fr-FR")}
                </p>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={refresh}
                disabled={pending}
                className="h-7 gap-1 px-2 text-xs"
                title="Rafraîchir depuis Dougs (statut, totaux, dates)"
              >
                <RefreshCw className="size-3" />
              </Button>
              {openUrl ? (
                <Button asChild size="sm" variant="outline" className="h-7 gap-1 text-xs">
                  <a href={openUrl} target="_blank" rel="noreferrer">
                    Ouvrir <ExternalLink className="size-3" />
                  </a>
                </Button>
              ) : null}
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
          {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="mt-2 text-[11px] underline hover:no-underline"
            >
              Pousser une nouvelle version
            </button>
          ) : null}
        </div>
      ) : null}

      {showForm ? (
        <div className="space-y-3 rounded-md border bg-background p-3">
          <div className="space-y-1.5">
            <Label htmlFor="quote-subject" className="text-xs">
              Objet
            </Label>
            <Input
              id="quote-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Ex. Refonte plateforme web — proposition commerciale"
              disabled={pending}
              className="h-8 text-xs"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Lignes</Label>
            {lines.map((l, idx) => (
              <div
                key={`line-${idx}-${l.title.slice(0, 8)}`}
                className="space-y-2 rounded-md border bg-muted/30 p-2"
              >
                <div className="grid grid-cols-12 gap-2">
                  <Input
                    value={l.title}
                    onChange={(e) => updateLine(idx, { title: e.target.value })}
                    placeholder="Titre de la prestation"
                    disabled={pending}
                    className="col-span-12 h-8 text-xs"
                  />
                </div>
                <Textarea
                  value={l.description}
                  onChange={(e) => updateLine(idx, { description: e.target.value })}
                  placeholder="Description détaillée (optionnel)"
                  disabled={pending}
                  rows={2}
                  className="text-xs"
                />
                <div className="grid grid-cols-12 items-end gap-2">
                  <div className="col-span-3">
                    <Label className="text-[10px] text-muted-foreground uppercase">Unité</Label>
                    <select
                      value={l.unit}
                      onChange={(e) => updateLine(idx, { unit: e.target.value })}
                      disabled={pending}
                      className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                    >
                      {UNIT_OPTIONS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] text-muted-foreground uppercase">Qté</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.5"
                      value={l.quantity}
                      onChange={(e) => updateLine(idx, { quantity: Number(e.target.value) || 0 })}
                      disabled={pending}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="col-span-3">
                    <Label className="text-[10px] text-muted-foreground uppercase">PU HT (€)</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={l.unitAmount}
                      onChange={(e) => updateLine(idx, { unitAmount: Number(e.target.value) || 0 })}
                      disabled={pending}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px] text-muted-foreground uppercase">TVA</Label>
                    <select
                      value={l.vatRate}
                      onChange={(e) => updateLine(idx, { vatRate: Number(e.target.value) })}
                      disabled={pending}
                      className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                    >
                      <option value={0.2}>20 %</option>
                      <option value={0.1}>10 %</option>
                      <option value={0.055}>5,5 %</option>
                      <option value={0}>0 %</option>
                    </select>
                  </div>
                  <div className="col-span-2 text-right">
                    <div className="text-[10px] text-muted-foreground uppercase">Total HT</div>
                    <div className="font-medium text-xs tabular-nums">
                      {lineTotal(l).toLocaleString("fr-FR", {
                        style: "currency",
                        currency: "EUR",
                      })}
                    </div>
                  </div>
                </div>
                {lines.length > 1 ? (
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => removeLine(idx)}
                      disabled={pending}
                      className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3" /> Retirer
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={addLine}
              disabled={pending}
              className="gap-1.5"
            >
              <Plus className="size-3.5" /> Ajouter une ligne
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="quote-thanks" className="text-xs">
              Mentions / conditions
            </Label>
            <Textarea
              id="quote-thanks"
              value={thankYouNote}
              onChange={(e) => setThankYouNote(e.target.value)}
              placeholder="Acompte 30 % à la commande, solde à la livraison. Devis valable 30 jours."
              disabled={pending}
              rows={2}
              className="text-xs"
            />
          </div>

          <div className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs">
            <div className="space-x-3">
              <span>
                Total HT :{" "}
                <strong className="tabular-nums">
                  {totalHt.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
                </strong>
              </span>
              <span className="text-muted-foreground">
                TVA : {totalVat.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
              </span>
              <span className="text-muted-foreground">
                TTC : {totalTtc.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {dougsQuoteId ? (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setShowForm(false)}
                  disabled={pending}
                >
                  Annuler
                </Button>
              ) : null}
              <Button type="button" size="sm" onClick={push} disabled={pending}>
                {pending ? "Poussé…" : dougsQuoteId ? "Re-pousser sur Dougs" : "Pousser sur Dougs"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
