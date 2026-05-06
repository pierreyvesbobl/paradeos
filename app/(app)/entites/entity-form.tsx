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
import { createEntity, updateEntity } from "@/lib/actions/entities";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import { type EntityKind, entityKindEnum, entityKindLabels } from "@/lib/schemas/entities";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Address = { street?: string; postalCode?: string; city?: string; country?: string };

type Props = {
  mode: "create" | "edit";
  defaultValues: {
    id?: string;
    name: string;
    kind: EntityKind;
    website: string;
    siren: string;
    vatNumber: string;
    address: Address;
    notes: string;
  };
};

export function EntityForm({ mode, defaultValues }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<Record<string, string[] | undefined>>({});

  const [name, setName] = useState(defaultValues.name);
  const [kind, setKind] = useState<EntityKind>(defaultValues.kind);
  const [website, setWebsite] = useState(defaultValues.website);
  const [siren, setSiren] = useState(defaultValues.siren);
  const [vatNumber, setVatNumber] = useState(defaultValues.vatNumber);
  const [street, setStreet] = useState(defaultValues.address.street ?? "");
  const [postalCode, setPostalCode] = useState(defaultValues.address.postalCode ?? "");
  const [city, setCity] = useState(defaultValues.address.city ?? "");
  const [country, setCountry] = useState(defaultValues.address.country ?? "");
  const [notes, setNotes] = useState(defaultValues.notes);

  function buildPayload() {
    const address = {
      street: street.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      city: city.trim() || undefined,
      country: country.trim() || undefined,
    };
    const hasAddress = Object.values(address).some(Boolean);
    return {
      name,
      kind,
      website: website || undefined,
      siren: siren || undefined,
      vatNumber: vatNumber || undefined,
      address: hasAddress ? address : undefined,
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
          ? await createEntity(payload)
          : await updateEntity({ ...payload, id: defaultValues.id ?? "" });

      if (!result.ok) {
        if (result.fieldErrors) setErrors(result.fieldErrors);
        scrollToFirstError(result.fieldErrors);
        toast.error(result.message);
        return;
      }
      toast.success(mode === "create" ? "Entité créée." : "Entité mise à jour.");
      const id = mode === "create" ? result.data.id : defaultValues.id;
      router.push(`/entites/${id}`);
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
            <Label htmlFor="kind">Type</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as EntityKind)} disabled={pending}>
              <SelectTrigger id="kind">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {entityKindEnum.options.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {entityKindLabels[opt]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="website">Site web</Label>
            <Input
              id="website"
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://…"
              disabled={pending}
            />
            <FieldError messages={errors.website} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Identifiants légaux
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="siren">SIREN</Label>
            <Input
              id="siren"
              value={siren}
              onChange={(e) => setSiren(e.target.value)}
              placeholder="9 chiffres"
              disabled={pending}
            />
            <FieldError messages={errors.siren} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vatNumber">N° TVA intracommunautaire</Label>
            <Input
              id="vatNumber"
              value={vatNumber}
              onChange={(e) => setVatNumber(e.target.value)}
              placeholder="FR…"
              disabled={pending}
            />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="border-b pb-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Adresse
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="street">Rue</Label>
            <Input
              id="street"
              value={street}
              onChange={(e) => setStreet(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="postalCode">Code postal</Label>
            <Input
              id="postalCode"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">Ville</Label>
            <Input
              id="city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="country">Pays</Label>
            <Input
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="France"
              disabled={pending}
            />
          </div>
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
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? "Enregistrement…" : mode === "create" ? "Créer" : "Enregistrer"}
        </Button>
      </div>
    </form>
  );
}
