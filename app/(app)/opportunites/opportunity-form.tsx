"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FieldError } from "@/components/ui/field-error";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createOpportunity, updateOpportunity } from "@/lib/actions/opportunities";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import {
  type OpportunityStatus,
  opportunityDefaultProbability,
  opportunityStatusEnum,
  opportunityStatusLabels,
} from "@/lib/schemas/opportunities";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type EntityOption = { id: string; name: string };
type ContactOption = { id: string; firstName: string; lastName: string; entityId: string | null };
type UserOption = { id: string; fullName: string | null };

type Props = {
  mode: "create" | "edit";
  entities: EntityOption[];
  contacts: ContactOption[];
  users: UserOption[];
  defaultValues: {
    id?: string;
    title: string;
    status: OpportunityStatus;
    entityId: string;
    contactId: string;
    valueAmount: string;
    probability: string;
    source: string;
    firstContactDate: string;
    lastContactDate: string;
    followUpDate: string;
    expectedCloseDate: string;
    ownerId: string;
    notes: string;
  };
};

export function OpportunityForm({ mode, entities, contacts, users, defaultValues }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const [title, setTitle] = useState(defaultValues.title);
  const [status, setStatus] = useState<OpportunityStatus>(defaultValues.status);
  const [entityId, setEntityId] = useState<string | null>(defaultValues.entityId || null);
  const [contactId, setContactId] = useState<string | null>(defaultValues.contactId || null);
  const [valueAmount, setValueAmount] = useState(defaultValues.valueAmount);
  const [probability, setProbability] = useState(defaultValues.probability);
  const [probaTouched, setProbaTouched] = useState(Boolean(defaultValues.probability));
  const [source, setSource] = useState(defaultValues.source);
  const [firstContactDate, setFirstContactDate] = useState(defaultValues.firstContactDate);
  const [lastContactDate, setLastContactDate] = useState(defaultValues.lastContactDate);
  const [followUpDate, setFollowUpDate] = useState(defaultValues.followUpDate);
  const [expectedCloseDate, setExpectedCloseDate] = useState(defaultValues.expectedCloseDate);
  const [ownerId, setOwnerId] = useState<string | null>(defaultValues.ownerId || null);
  const [notes, setNotes] = useState(defaultValues.notes);

  function onStatusChange(s: OpportunityStatus) {
    setStatus(s);
    if (!probaTouched) {
      setProbability(String(opportunityDefaultProbability[s]));
    }
  }

  // Filtre les contacts selon l'entité sélectionnée (si l'utilisateur en a choisi une).
  const visibleContacts =
    entityId === null
      ? contacts
      : contacts.filter((c) => c.entityId === entityId || c.id === contactId);

  function buildPayload() {
    return {
      title,
      status,
      entityId: entityId ?? undefined,
      contactId: contactId ?? undefined,
      valueAmount: valueAmount || undefined,
      probability: probability || undefined,
      source: source || undefined,
      firstContactDate: firstContactDate || undefined,
      lastContactDate: lastContactDate || undefined,
      followUpDate: followUpDate || undefined,
      expectedCloseDate: expectedCloseDate || undefined,
      ownerId: ownerId ?? undefined,
      notes: notes || undefined,
    };
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const payload = buildPayload();
      const result =
        mode === "create"
          ? await createOpportunity(payload)
          : await updateOpportunity({ ...payload, id: defaultValues.id ?? "" });

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        scrollToFirstError(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success(mode === "create" ? "Opportunité créée." : "Opportunité mise à jour.");
      const id = mode === "create" ? result.data.id : defaultValues.id;
      router.push(`/opportunites/${id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Identification
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="title">Titre *</Label>
            <Input
              id="title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={pending}
            />
            <FieldError messages={errors.title} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Statut</Label>
            <Select
              value={status}
              onValueChange={(v) => onStatusChange(v as OpportunityStatus)}
              disabled={pending}
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {opportunityStatusEnum.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opportunityStatusLabels[opt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="source">Source</Label>
            <Input
              id="source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="Apporteur, channel…"
              disabled={pending}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Lien
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="entityId">Entité</Label>
            <FkCombobox
              id="entityId"
              value={entityId}
              onValueChange={(v) => {
                setEntityId(v);
                if (v !== entityId) setContactId(null);
              }}
              options={entities.map((e) => ({ id: e.id, label: e.name }))}
              searchPlaceholder="Rechercher une entité…"
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactId">Contact principal</Label>
            <FkCombobox
              id="contactId"
              value={contactId}
              onValueChange={setContactId}
              options={visibleContacts.map((c) => ({
                id: c.id,
                label: `${c.firstName} ${c.lastName}`.trim(),
              }))}
              searchPlaceholder="Rechercher un contact…"
              disabled={pending}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Valeur
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="valueAmount">Montant (HT)</Label>
            <MoneyInput
              id="valueAmount"
              value={valueAmount}
              onValueChange={setValueAmount}
              placeholder="12 500"
              disabled={pending}
            />
            <FieldError messages={errors.valueAmount} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="probability">Probabilité (%)</Label>
            <Input
              id="probability"
              type="number"
              min={0}
              max={100}
              value={probability}
              onChange={(e) => {
                setProbability(e.target.value);
                setProbaTouched(true);
              }}
              disabled={pending}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Dates
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstContactDate">Premier contact</Label>
            <DateInput
              id="firstContactDate"
              value={firstContactDate}
              onValueChange={setFirstContactDate}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastContactDate">Dernier contact</Label>
            <DateInput
              id="lastContactDate"
              value={lastContactDate}
              onValueChange={setLastContactDate}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="followUpDate">Relance prévue</Label>
            <DateInput
              id="followUpDate"
              value={followUpDate}
              onValueChange={setFollowUpDate}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expectedCloseDate">Closing estimé</Label>
            <DateInput
              id="expectedCloseDate"
              value={expectedCloseDate}
              onValueChange={setExpectedCloseDate}
              disabled={pending}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Pilotage
        </h2>
        <div className="space-y-2">
          <Label htmlFor="ownerId">Lead</Label>
          <FkCombobox
            id="ownerId"
            value={ownerId}
            onValueChange={setOwnerId}
            options={users.map((u) => ({ id: u.id, label: u.fullName ?? "(sans nom)" }))}
            searchPlaceholder="Rechercher un membre…"
            disabled={pending}
          />
          <p className="text-muted-foreground text-xs">
            Référent·e de l'opportunité (par défaut, son créateur).
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Notes
        </h2>
        <Textarea
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={pending}
        />
      </section>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background/90 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending || !title.trim()}>
          {pending ? "Enregistrement…" : mode === "create" ? "Créer" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
