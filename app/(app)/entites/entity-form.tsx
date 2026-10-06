"use client";

import { AddressAutocomplete } from "@/components/gouv/address-autocomplete";
import { CompanySearch } from "@/components/gouv/company-search";
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
import { createEntity, updateEntity } from "@/lib/actions/entities";
import { scrollToFirstError } from "@/lib/forms/scroll-to-error";
import type { SireneCompany, SireneEstablishment } from "@/lib/gouv/sirene";
import { type EntityKind, entityKindEnum, entityKindLabels } from "@/lib/schemas/entities";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type Address = { street?: string; postalCode?: string; city?: string; country?: string };

/** « Siège — 4 Boulevard de Mons, 59650 Villeneuve-d'Ascq » */
function establishmentLabel(e: SireneEstablishment): string {
  const head = e.isHeadOffice ? "Siège" : (e.label ?? "Établissement");
  const parts = [head, e.addressLabel ?? e.siret];
  if (!e.active) parts.push("(cessé)");
  return parts.join(" — ");
}

type Props = {
  mode: "create" | "edit";
  defaultValues: {
    id?: string;
    name: string;
    kind: EntityKind;
    website: string;
    siren: string;
    siret: string;
    legalName: string;
    vatNumber: string;
    address: Address;
    deliveryAddress: Address;
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
  const [siret, setSiret] = useState(defaultValues.siret);
  const [legalName, setLegalName] = useState(defaultValues.legalName);
  const [vatNumber, setVatNumber] = useState(defaultValues.vatNumber);
  const [street, setStreet] = useState(defaultValues.address.street ?? "");
  const [postalCode, setPostalCode] = useState(defaultValues.address.postalCode ?? "");
  const [city, setCity] = useState(defaultValues.address.city ?? "");
  const [country, setCountry] = useState(defaultValues.address.country ?? "");
  const [delStreet, setDelStreet] = useState(defaultValues.deliveryAddress.street ?? "");
  const [delPostalCode, setDelPostalCode] = useState(
    defaultValues.deliveryAddress.postalCode ?? "",
  );
  const [delCity, setDelCity] = useState(defaultValues.deliveryAddress.city ?? "");
  const [delCountry, setDelCountry] = useState(defaultValues.deliveryAddress.country ?? "");
  const [notes, setNotes] = useState(defaultValues.notes);
  // Établissements de la dernière entreprise reprise de l'INSEE. Un seul
  // (le siège) la plupart du temps : le sélecteur ne s'affiche qu'au-delà.
  const [establishments, setEstablishments] = useState<SireneEstablishment[]>([]);

  /**
   * Prérempli depuis l'annuaire des entreprises. Le nom d'usage n'est
   * écrasé que s'il est vide : en édition, c'est celui que Parade a choisi
   * qui compte, pas celui de l'INSEE. Le SIRET proposé est celui du siège —
   * à corriger à la main si la facture vise un autre établissement.
   */
  function applyCompany(company: SireneCompany) {
    setSiren(company.siren);
    setEstablishments(company.establishments);
    if (company.siret) setSiret(company.siret);
    if (company.vatNumber) setVatNumber(company.vatNumber);
    if (company.legalName) setLegalName(company.legalName);
    if (!name.trim()) setName(company.legalName ?? company.name);
    if (company.address) {
      setStreet(company.address.street ?? "");
      setPostalCode(company.address.postalCode ?? "");
      setCity(company.address.city ?? "");
      setCountry(company.address.country ?? "");
    }
    toast.success(
      company.address
        ? "Fiche INSEE reprise : identifiants et adresse."
        : "Fiche INSEE reprise. L'INSEE ne diffuse pas l'adresse de cette entreprise.",
    );
  }

  function buildPayload() {
    const address = {
      street: street.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      city: city.trim() || undefined,
      country: country.trim() || undefined,
    };
    const hasAddress = Object.values(address).some(Boolean);
    const deliveryAddress = {
      street: delStreet.trim() || undefined,
      postalCode: delPostalCode.trim() || undefined,
      city: delCity.trim() || undefined,
      country: delCountry.trim() || undefined,
    };
    const hasDeliveryAddress = Object.values(deliveryAddress).some(Boolean);
    return {
      name,
      kind,
      website: website || undefined,
      siren: siren || undefined,
      siret: siret || undefined,
      legalName: legalName || undefined,
      vatNumber: vatNumber || undefined,
      address: hasAddress ? address : undefined,
      deliveryAddress: hasDeliveryAddress ? deliveryAddress : undefined,
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
        <div className="space-y-1.5">
          <CompanySearch onPick={applyCompany} disabled={pending} />
          <p className="text-[11px] text-muted-foreground">
            Source INSEE (Sirene + RNE) : préremplit la dénomination sociale, le SIREN, le SIRET du
            siège, la TVA intracommunautaire et l'adresse. Le nom d'usage déjà saisi n'est pas
            touché.
          </p>
        </div>
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
            <Label htmlFor="siret">SIRET</Label>
            <Input
              id="siret"
              value={siret}
              onChange={(e) => setSiret(e.target.value)}
              placeholder="14 chiffres"
              disabled={pending}
            />
            <p className="text-[11px] text-muted-foreground">
              Requis pour la facture électronique : le SIREN seul ne suffit pas à identifier
              l'établissement destinataire.
            </p>
            {establishments.length > 1 ? (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor="establishment">Établissement à facturer</Label>
                <FkCombobox
                  id="establishment"
                  value={siret || null}
                  onValueChange={(next) => {
                    const chosen = establishments.find((e) => e.siret === next);
                    if (!chosen) return;
                    setSiret(chosen.siret);
                    if (chosen.address) {
                      setStreet(chosen.address.street ?? "");
                      setPostalCode(chosen.address.postalCode ?? "");
                      setCity(chosen.address.city ?? "");
                      setCountry(chosen.address.country ?? "");
                    }
                  }}
                  clearLabel={null}
                  searchPlaceholder="Filtrer par adresse ou SIRET…"
                  options={establishments.map((e) => ({
                    id: e.siret,
                    label: establishmentLabel(e),
                    searchValue: [e.siret, e.label, e.addressLabel].filter(Boolean).join(" "),
                  }))}
                  disabled={pending}
                />
                <p className="text-[11px] text-muted-foreground">
                  L'INSEE connaît {establishments.length} établissements pour cette recherche.
                  Choisir celui que la facture doit viser remplace aussi l'adresse.
                </p>
              </div>
            ) : null}
            <FieldError messages={errors.siret} />
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
            <FieldError messages={errors.vatNumber} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="legalName">Dénomination sociale</Label>
            <Input
              id="legalName"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Si différente du nom d'usage"
              disabled={pending}
            />
            <p className="text-[11px] text-muted-foreground">
              C'est elle qui figure sur la facture.
            </p>
            <FieldError messages={errors.legalName} />
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
            <AddressAutocomplete
              id="street"
              value={street}
              onChange={setStreet}
              onPick={(address) => {
                setPostalCode(address.postalCode ?? "");
                setCity(address.city ?? "");
                setCountry(address.country ?? "");
              }}
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
          Adresse de livraison
        </h2>
        <p className="text-[11px] text-muted-foreground">
          À ne remplir que si elle diffère de l'adresse de facturation. La facture électronique
          l'exige dans ce cas.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="delStreet">Rue</Label>
            <AddressAutocomplete
              id="delStreet"
              value={delStreet}
              onChange={setDelStreet}
              onPick={(address) => {
                setDelPostalCode(address.postalCode ?? "");
                setDelCity(address.city ?? "");
                setDelCountry(address.country ?? "");
              }}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="delPostalCode">Code postal</Label>
            <Input
              id="delPostalCode"
              value={delPostalCode}
              onChange={(e) => setDelPostalCode(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="delCity">Ville</Label>
            <Input
              id="delCity"
              value={delCity}
              onChange={(e) => setDelCity(e.target.value)}
              disabled={pending}
            />
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="delCountry">Pays</Label>
            <Input
              id="delCountry"
              value={delCountry}
              onChange={(e) => setDelCountry(e.target.value)}
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
