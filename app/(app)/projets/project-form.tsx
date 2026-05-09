"use client";

import { FkCombobox } from "@/components/inline/fk-combobox";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { DateRangePicker, formatIsoDate, parseIsoDate } from "@/components/ui/date-range-picker";
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
import { createProject, updateProject } from "@/lib/actions/projects";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import {
  COMMERCIAL_STATUSES,
  type ProjectBillingType,
  type ProjectKind,
  type ProjectStatus,
  projectBillingTypeEnum,
  projectBillingTypeLabels,
  projectDefaultProbability,
  projectKindEnum,
  projectKindLabels,
  projectStatusEnum,
  projectStatusLabels,
} from "@/lib/schemas/projects";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type EntityOption = { id: string; name: string };
type ContactOption = { id: string; firstName: string; lastName: string };
type UserOption = { id: string; fullName: string | null };

type Props = {
  mode: "create" | "edit";
  entities: EntityOption[];
  contacts: ContactOption[];
  users: UserOption[];
  defaultValues: {
    id?: string;
    name: string;
    kind: ProjectKind;
    status: ProjectStatus;
    entityId: string;
    contactId: string;
    color: string;
    icon: string;
    description: string;
    startDate: string;
    endDate: string;
    ownerId: string;
    billingType: ProjectBillingType;
    budgetAmount: string;
    hourlyRate: string;
    valueAmount: string;
    probability: string;
    source: string;
    firstContactDate: string;
    lastContactDate: string;
    followUpDate: string;
    expectedCloseDate: string;
  };
};

export function ProjectForm({ mode, entities, contacts, users, defaultValues }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const [name, setName] = useState(defaultValues.name);
  const [kind, setKind] = useState<ProjectKind>(defaultValues.kind);
  const [status, setStatus] = useState<ProjectStatus>(defaultValues.status);
  const [entityId, setEntityId] = useState<string | null>(defaultValues.entityId || null);
  const [contactId, setContactId] = useState<string | null>(defaultValues.contactId || null);
  const [color, setColor] = useState(defaultValues.color);
  const [icon, setIcon] = useState(defaultValues.icon);
  const [description, setDescription] = useState(defaultValues.description);
  const [startDate, setStartDate] = useState(defaultValues.startDate);
  const [endDate, setEndDate] = useState(defaultValues.endDate);
  const [ownerId, setOwnerId] = useState<string | null>(defaultValues.ownerId || null);
  const [billingType, setBillingType] = useState<ProjectBillingType>(defaultValues.billingType);
  const [budgetAmount, setBudgetAmount] = useState(defaultValues.budgetAmount);
  const [hourlyRate, setHourlyRate] = useState(defaultValues.hourlyRate);
  const [valueAmount, setValueAmount] = useState(defaultValues.valueAmount);
  const [probability, setProbability] = useState(defaultValues.probability);
  const [probaTouched, setProbaTouched] = useState(Boolean(defaultValues.probability));
  const [source, setSource] = useState(defaultValues.source);
  const [firstContactDate, setFirstContactDate] = useState(defaultValues.firstContactDate);
  const [lastContactDate, setLastContactDate] = useState(defaultValues.lastContactDate);
  const [followUpDate, setFollowUpDate] = useState(defaultValues.followUpDate);
  const [expectedCloseDate, setExpectedCloseDate] = useState(defaultValues.expectedCloseDate);

  // Champs commerciaux pertinents pour kind=client en phase pré-won.
  const showCommercial =
    kind === "client" && (COMMERCIAL_STATUSES as readonly string[]).includes(status);

  function onStatusChange(s: ProjectStatus) {
    setStatus(s);
    if (!probaTouched) {
      const p = projectDefaultProbability[s];
      if (p != null) setProbability(String(p));
    }
  }

  function buildPayload() {
    return {
      name,
      kind,
      status,
      entityId: entityId ?? undefined,
      contactId: contactId ?? undefined,
      color: color || undefined,
      icon: icon || undefined,
      description: description || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      ownerId: ownerId ?? undefined,
      billingType,
      budgetAmount: billingType === "fixed" ? budgetAmount || undefined : undefined,
      hourlyRate: billingType === "hourly" ? hourlyRate || undefined : undefined,
      valueAmount: showCommercial && valueAmount ? valueAmount : undefined,
      probability: showCommercial && probability ? probability : undefined,
      source: showCommercial && source ? source : undefined,
      firstContactDate: showCommercial && firstContactDate ? firstContactDate : undefined,
      lastContactDate: showCommercial && lastContactDate ? lastContactDate : undefined,
      followUpDate: showCommercial && followUpDate ? followUpDate : undefined,
      expectedCloseDate: showCommercial && expectedCloseDate ? expectedCloseDate : undefined,
    };
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrors({});
    startTransition(async () => {
      const payload = buildPayload();
      const result =
        mode === "create"
          ? await createProject(payload)
          : await updateProject({ ...payload, id: defaultValues.id ?? "" });

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        scrollToFirstError(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success(mode === "create" ? "Projet créé." : "Projet mis à jour.");
      const id = mode === "create" ? result.data.id : defaultValues.id;
      router.push(`/projets/${id}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-10">
      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Identité
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="name">Nom *</Label>
            <Input
              id="name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
            <FieldError messages={errors.name} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="kind">Type *</Label>
            <Select
              value={kind}
              onValueChange={(v) => setKind(v as ProjectKind)}
              disabled={pending}
            >
              <SelectTrigger id="kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projectKindEnum.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {projectKindLabels[opt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Statut</Label>
            <Select
              value={status}
              onValueChange={(v) => onStatusChange(v as ProjectStatus)}
              disabled={pending}
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projectStatusEnum.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {projectStatusLabels[opt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {kind === "client" ? (
        <section className="space-y-4">
          <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
            Client
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="entityId">Entité *</Label>
              <FkCombobox
                id="entityId"
                value={entityId}
                onValueChange={setEntityId}
                options={entities.map((e) => ({ id: e.id, label: e.name }))}
                searchPlaceholder="Rechercher une entité…"
                disabled={pending}
              />
              <FieldError messages={errors.entityId} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contactId">Contact principal</Label>
              <FkCombobox
                id="contactId"
                value={contactId}
                onValueChange={setContactId}
                options={contacts.map((c) => ({
                  id: c.id,
                  label: `${c.firstName} ${c.lastName}`.trim(),
                }))}
                searchPlaceholder="Rechercher un contact…"
                disabled={pending}
              />
            </div>
          </div>
        </section>
      ) : null}

      {showCommercial ? (
        <section className="space-y-4">
          <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
            Commercial (avant signature)
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="valueAmount">Montant prévisionnel (HT)</Label>
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
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="source">Source</Label>
              <Input
                id="source"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="Apporteur, channel…"
                disabled={pending}
              />
            </div>
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
      ) : null}

      {kind === "product" ? (
        <section className="space-y-4">
          <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
            Apparence
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="color">Couleur (hex)</Label>
              <Input
                id="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                placeholder="#4F46E5"
                disabled={pending}
              />
              <FieldError messages={errors.color} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="icon">Icône (emoji)</Label>
              <Input
                id="icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="🤖"
                disabled={pending}
              />
            </div>
          </div>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Facturation
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="billingType">Type</Label>
            <Select
              value={billingType}
              onValueChange={(v) => setBillingType(v as ProjectBillingType)}
              disabled={pending}
            >
              <SelectTrigger id="billingType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {projectBillingTypeEnum.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {projectBillingTypeLabels[opt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {billingType === "fixed" ? (
            <div className="space-y-2">
              <Label htmlFor="budgetAmount">Budget (HT)</Label>
              <MoneyInput
                id="budgetAmount"
                value={budgetAmount}
                onValueChange={setBudgetAmount}
                placeholder="2 000"
                disabled={pending}
              />
              <FieldError messages={errors.budgetAmount} />
            </div>
          ) : null}
          {billingType === "hourly" ? (
            <div className="space-y-2">
              <Label htmlFor="hourlyRate">Taux horaire (HT/h)</Label>
              <MoneyInput
                id="hourlyRate"
                value={hourlyRate}
                onValueChange={setHourlyRate}
                placeholder="120"
                disabled={pending}
              />
              <FieldError messages={errors.hourlyRate} />
            </div>
          ) : null}
        </div>
        {billingType === "none" ? (
          <p className="text-muted-foreground text-xs">
            Pas de revenu généré. Le coût interne reste tracké pour le suivi temps.
          </p>
        ) : null}
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
            Référent·e du projet (par défaut, son créateur).
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Calendrier
        </h2>
        <div className="space-y-2">
          <Label>Période du projet (début & fin)</Label>
          <DateRangePicker
            value={
              startDate || endDate
                ? { start: parseIsoDate(startDate), end: parseIsoDate(endDate) }
                : null
            }
            onChange={(r) => {
              setStartDate(r?.start ? formatIsoDate(r.start) : "");
              setEndDate(r?.end ? formatIsoDate(r.end) : "");
            }}
            disabled={pending}
            placeholder="Définir la période"
            triggerSize="default"
            className="w-full"
          />
          <p className="text-muted-foreground text-xs">
            Glisse pour sélectionner l'intervalle d'un coup, ou clique sur un preset à gauche.
          </p>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Description
        </h2>
        <Textarea
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={pending}
        />
      </section>

      <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t bg-background/90 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <Button type="button" variant="ghost" onClick={() => router.back()} disabled={pending}>
          Annuler
        </Button>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? "Enregistrement…" : mode === "create" ? "Créer" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
