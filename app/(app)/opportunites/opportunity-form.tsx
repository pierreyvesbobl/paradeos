"use client";

import { Button } from "@/components/ui/button";
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
import { createOpportunity, updateOpportunity } from "@/lib/actions/opportunities";
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

const NONE = "__none__";

export function OpportunityForm({ mode, entities, contacts, users, defaultValues }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const [title, setTitle] = useState(defaultValues.title);
  const [status, setStatus] = useState<OpportunityStatus>(defaultValues.status);
  const [entityId, setEntityId] = useState(defaultValues.entityId || NONE);
  const [contactId, setContactId] = useState(defaultValues.contactId || NONE);
  const [valueAmount, setValueAmount] = useState(defaultValues.valueAmount);
  const [probability, setProbability] = useState(defaultValues.probability);
  const [probaTouched, setProbaTouched] = useState(Boolean(defaultValues.probability));
  const [source, setSource] = useState(defaultValues.source);
  const [firstContactDate, setFirstContactDate] = useState(defaultValues.firstContactDate);
  const [lastContactDate, setLastContactDate] = useState(defaultValues.lastContactDate);
  const [followUpDate, setFollowUpDate] = useState(defaultValues.followUpDate);
  const [expectedCloseDate, setExpectedCloseDate] = useState(defaultValues.expectedCloseDate);
  const [ownerId, setOwnerId] = useState(defaultValues.ownerId || NONE);
  const [notes, setNotes] = useState(defaultValues.notes);

  function onStatusChange(s: OpportunityStatus) {
    setStatus(s);
    if (!probaTouched) {
      setProbability(String(opportunityDefaultProbability[s]));
    }
  }

  // Filtre les contacts selon l'entité sélectionnée (si l'utilisateur en a choisi une).
  const visibleContacts =
    entityId === NONE
      ? contacts
      : contacts.filter((c) => c.entityId === entityId || c.id === contactId);

  function buildPayload() {
    return {
      title,
      status,
      entityId: entityId === NONE ? undefined : entityId,
      contactId: contactId === NONE ? undefined : contactId,
      valueAmount: valueAmount || undefined,
      probability: probability || undefined,
      source: source || undefined,
      firstContactDate: firstContactDate || undefined,
      lastContactDate: lastContactDate || undefined,
      followUpDate: followUpDate || undefined,
      expectedCloseDate: expectedCloseDate || undefined,
      ownerId: ownerId === NONE ? undefined : ownerId,
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
    <form onSubmit={onSubmit} className="space-y-8">
      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Identification</h2>
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
            {errors.title ? <p className="text-destructive text-xs">{errors.title[0]}</p> : null}
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

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Lien</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="entityId">Entité</Label>
            <Select
              value={entityId}
              onValueChange={(v) => {
                setEntityId(v);
                if (v !== entityId) setContactId(NONE);
              }}
              disabled={pending}
            >
              <SelectTrigger id="entityId">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {entities.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="contactId">Contact principal</Label>
            <Select value={contactId} onValueChange={setContactId} disabled={pending}>
              <SelectTrigger id="contactId">
                <SelectValue placeholder="—" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {visibleContacts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Valeur</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="valueAmount">Montant (€ HT)</Label>
            <Input
              id="valueAmount"
              inputMode="decimal"
              value={valueAmount}
              onChange={(e) => setValueAmount(e.target.value)}
              placeholder="12 500"
              disabled={pending}
            />
            {errors.valueAmount ? (
              <p className="text-destructive text-xs">{errors.valueAmount[0]}</p>
            ) : null}
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

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Dates</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="firstContactDate">Premier contact</Label>
            <Input
              id="firstContactDate"
              type="date"
              value={firstContactDate}
              onChange={(e) => setFirstContactDate(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lastContactDate">Dernier contact</Label>
            <Input
              id="lastContactDate"
              type="date"
              value={lastContactDate}
              onChange={(e) => setLastContactDate(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="followUpDate">Relance prévue</Label>
            <Input
              id="followUpDate"
              type="date"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="expectedCloseDate">Closing estimé</Label>
            <Input
              id="expectedCloseDate"
              type="date"
              value={expectedCloseDate}
              onChange={(e) => setExpectedCloseDate(e.target.value)}
              disabled={pending}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Pilotage</h2>
        <div className="space-y-2">
          <Label htmlFor="ownerId">Lead</Label>
          <Select value={ownerId} onValueChange={setOwnerId} disabled={pending}>
            <SelectTrigger id="ownerId">
              <SelectValue placeholder="—" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NONE}>—</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.fullName ?? "(sans nom)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">
            Référent·e de l'opportunité (par défaut, son créateur).
          </p>
        </div>
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Notes</h2>
        <Textarea
          rows={5}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={pending}
        />
      </section>

      <div className="flex items-center justify-end gap-2">
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
