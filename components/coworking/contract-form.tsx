"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
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
import { createCoworkingContract, updateCoworkingContract } from "@/lib/actions/coworking";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import {
  type CoworkingBillingFrequency,
  type CoworkingContractStatus,
  coworkingBillingFrequencyEnum,
  coworkingBillingFrequencyLabels,
  coworkingContractStatusEnum,
  coworkingContractStatusLabels,
} from "@/lib/schemas/coworking";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Option = { id: string; label: string };

type Props =
  | {
      mode: "create";
      contactOptions: Option[];
      entityOptions: Option[];
      defaultValues?: undefined;
    }
  | {
      mode: "edit";
      contactOptions: Option[];
      entityOptions: Option[];
      defaultValues: {
        id: string;
        name: string;
        contactId: string | null;
        billToEntityId: string | null;
        startDate: string;
        endDate: string;
        desks: number;
        unitPriceHt: string;
        status: CoworkingContractStatus;
        billingFrequency: CoworkingBillingFrequency;
        notes: string;
      };
    };

export function ContractForm(props: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const seed = props.mode === "edit" ? props.defaultValues : null;
  const [name, setName] = useState(seed?.name ?? "");
  const [contactId, setContactId] = useState<string | null>(seed?.contactId ?? null);
  const [billToEntityId, setBillToEntityId] = useState<string | null>(seed?.billToEntityId ?? null);
  const [startDate, setStartDate] = useState(seed?.startDate ?? "");
  const [endDate, setEndDate] = useState(seed?.endDate ?? "");
  const [desks, setDesks] = useState(seed?.desks ?? 1);
  const [unitPriceHt, setUnitPriceHt] = useState(seed?.unitPriceHt ?? "");
  const [status, setStatus] = useState<CoworkingContractStatus>(seed?.status ?? "en_cours");
  const [billingFrequency, setBillingFrequency] = useState<CoworkingBillingFrequency>(
    seed?.billingFrequency ?? "quarterly",
  );
  const [notes, setNotes] = useState(seed?.notes ?? "");

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const payload = {
        name,
        contactId: contactId ?? null,
        billToEntityId: billToEntityId ?? null,
        startDate,
        endDate: endDate || null,
        desks,
        unitPriceHt,
        status,
        billingFrequency,
        notes: notes || null,
      };
      const result =
        props.mode === "create"
          ? await createCoworkingContract(payload)
          : await updateCoworkingContract({ ...payload, id: props.defaultValues.id });

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        scrollToFirstError(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success(props.mode === "create" ? "Contrat créé." : "Contrat mis à jour.");
      const id = props.mode === "create" ? result.data.id : props.defaultValues.id;
      router.push(`/coworking/contrats/${id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="name">Nom *</Label>
        <Input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Contrat Coworker — 2 postes janvier 2026"
          disabled={pending}
        />
        <FieldError messages={errors.name} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Coworker (qui occupe)</Label>
          <FkCombobox
            value={contactId}
            onValueChange={setContactId}
            options={props.contactOptions.map((c) => ({ id: c.id, label: c.label }))}
            placeholder="Choisir un contact…"
            searchPlaceholder="Rechercher un contact…"
            clearLabel="Aucun"
            disabled={pending}
          />
          <p className="text-muted-foreground text-xs">Doit être un contact qualifié "Coworker".</p>
        </div>
        <div className="space-y-2">
          <Label>Facturer au nom de</Label>
          <FkCombobox
            value={billToEntityId}
            onValueChange={setBillToEntityId}
            options={props.entityOptions.map((e) => ({ id: e.id, label: e.label }))}
            placeholder="Particulier (au nom du contact)…"
            searchPlaceholder="Rechercher une entité…"
            clearLabel="Particulier (au nom du contact)"
            disabled={pending}
          />
          <p className="text-muted-foreground text-xs">
            B2B : choisis l'entité. B2C : laisse vide → facture au nom du contact.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="startDate">Début *</Label>
          <Input
            id="startDate"
            type="date"
            required
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            disabled={pending}
          />
          <FieldError messages={errors.startDate} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="endDate">Fin (optionnel)</Label>
          <Input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            disabled={pending}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="desks">Postes *</Label>
          <Input
            id="desks"
            type="number"
            min={1}
            required
            value={desks}
            onChange={(e) => setDesks(Number(e.target.value))}
            disabled={pending}
          />
          <FieldError messages={errors.desks} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="unitPriceHt">Prix HT mensuel / poste (€) *</Label>
          <Input
            id="unitPriceHt"
            type="number"
            step="0.01"
            min={0}
            required
            value={unitPriceHt}
            onChange={(e) => setUnitPriceHt(e.target.value)}
            disabled={pending}
          />
          <FieldError messages={errors.unitPriceHt} />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="status">Statut</Label>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as CoworkingContractStatus)}
            disabled={pending}
          >
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {coworkingContractStatusEnum.options.map((s) => (
                <SelectItem key={s} value={s}>
                  {coworkingContractStatusLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="billing-frequency">Cadence de facturation</Label>
          <Select
            value={billingFrequency}
            onValueChange={(v) => setBillingFrequency(v as CoworkingBillingFrequency)}
            disabled={pending}
          >
            <SelectTrigger id="billing-frequency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {coworkingBillingFrequencyEnum.options.map((s) => (
                <SelectItem key={s} value={s}>
                  {coworkingBillingFrequencyLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          disabled={pending}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : props.mode === "create" ? "Créer" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
