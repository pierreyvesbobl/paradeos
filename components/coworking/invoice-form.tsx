"use client";

import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createCoworkingInvoice, updateCoworkingInvoice } from "@/lib/actions/coworking";
import { formatEuro } from "@/lib/format";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import {
  type CoworkingInvoiceBilledBy,
  type CoworkingInvoiceStatus,
  coworkingInvoiceBilledByEnum,
  coworkingInvoiceBilledByLabels,
  coworkingInvoiceStatusEnum,
  coworkingInvoiceStatusLabels,
  invoiceTotalHt,
  invoiceTotalTtc,
  monthsBetween,
} from "@/lib/schemas/coworking";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Defaults = {
  id?: string;
  contractId: string;
  name: string;
  invoiceDate: string;
  periodStart: string;
  periodEnd: string;
  status: CoworkingInvoiceStatus;
  billedBy: CoworkingInvoiceBilledBy;
  desks: number;
  unitPriceHt: string;
  vatRate: string;
  notes: string;
};

type Props = {
  mode: "create" | "edit";
  defaultValues: Defaults;
  onDone?: () => void;
};

export function InvoiceForm({ mode, defaultValues, onDone }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const [name, setName] = useState(defaultValues.name);
  const [invoiceDate, setInvoiceDate] = useState(defaultValues.invoiceDate);
  const [periodStart, setPeriodStart] = useState(defaultValues.periodStart);
  const [periodEnd, setPeriodEnd] = useState(defaultValues.periodEnd);
  const [status, setStatus] = useState<CoworkingInvoiceStatus>(defaultValues.status);
  const [billedBy, setBilledBy] = useState<CoworkingInvoiceBilledBy>(defaultValues.billedBy);
  // desks / unitPriceHt viennent du contrat — affichés en lecture seule.
  // On les passe quand même au payload pour conserver le snapshot DB.
  const desks = defaultValues.desks;
  const unitPriceHt = defaultValues.unitPriceHt;
  const [vatRate, setVatRate] = useState(defaultValues.vatRate);
  const [notes, setNotes] = useState(defaultValues.notes);

  const months = periodStart && periodEnd ? monthsBetween(periodStart, periodEnd) : 1;
  const ht = invoiceTotalHt(desks, unitPriceHt, months);
  const ttc = invoiceTotalTtc(desks, unitPriceHt, months, vatRate);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const payload = {
        contractId: defaultValues.contractId,
        name,
        invoiceDate: invoiceDate || null,
        periodStart,
        periodEnd,
        status,
        billedBy,
        desks,
        unitPriceHt,
        vatRate,
        notes: notes || null,
      };
      const result =
        mode === "create"
          ? await createCoworkingInvoice(payload)
          : await updateCoworkingInvoice({ ...payload, id: defaultValues.id ?? "" });

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        scrollToFirstError(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success(mode === "create" ? "Facture créée." : "Facture mise à jour.");
      onDone?.();
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="inv-name">Nom *</Label>
        <Input
          id="inv-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={pending}
        />
        <FieldError messages={errors.name} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="inv-date">Date facture</Label>
          <Input
            id="inv-date"
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inv-start">Période début *</Label>
          <Input
            id="inv-start"
            type="date"
            required
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inv-end">Période fin *</Label>
          <Input
            id="inv-end"
            type="date"
            required
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            disabled={pending}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">Postes (du contrat)</Label>
          <p className="font-mono text-sm">{desks}</p>
        </div>
        <div className="space-y-1">
          <Label className="text-muted-foreground text-xs">
            Prix HT mensuel / poste (du contrat)
          </Label>
          <p className="font-mono text-sm">{unitPriceHt} €</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inv-vat">TVA</Label>
          <Input
            id="inv-vat"
            type="number"
            step="0.001"
            min={0}
            max={1}
            value={vatRate}
            onChange={(e) => setVatRate(e.target.value)}
            disabled={pending}
          />
          <p className="text-muted-foreground text-[11px]">Décimal (ex: 0.2 = 20%).</p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="inv-status">Statut</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as CoworkingInvoiceStatus)}
            disabled={pending}
          >
            <SelectTrigger id="inv-status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {coworkingInvoiceStatusEnum.options.map((s) => (
                <SelectItem key={s} value={s}>
                  {coworkingInvoiceStatusLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="inv-billed-by">Émetteur</Label>
          <Select
            value={billedBy}
            onValueChange={(v) => setBilledBy(v as CoworkingInvoiceBilledBy)}
            disabled={pending}
          >
            <SelectTrigger id="inv-billed-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {coworkingInvoiceBilledByEnum.options.map((s) => (
                <SelectItem key={s} value={s}>
                  {coworkingInvoiceBilledByLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="inv-notes">Notes</Label>
        <Textarea
          id="inv-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          disabled={pending}
        />
      </div>

      <div className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
        <span className="text-muted-foreground">Total</span>
        <span className="font-mono">
          {formatEuro(ht)} HT · <span className="font-semibold">{formatEuro(ttc)}</span> TTC
        </span>
      </div>

      <div className="flex justify-end gap-2">
        {onDone ? (
          <Button type="button" variant="ghost" onClick={onDone} disabled={pending}>
            Annuler
          </Button>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : mode === "create" ? "Créer" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
