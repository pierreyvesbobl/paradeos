"use client";

import { InlineFk } from "@/components/inline/inline-fk";
import { InlineMultiline } from "@/components/inline/inline-multiline";
import { InlineText } from "@/components/inline/inline-text";
import type { SaveResult, Saver } from "@/components/inline/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { patchContact } from "@/lib/actions/contacts";
import { quickCreateEntity } from "@/lib/actions/entities";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type FieldId =
  | "firstName"
  | "lastName"
  | "email"
  | "phone"
  | "jobTitle"
  | "linkedinUrl"
  | "entityId"
  | "notes";

function makeSaver<T>(id: string, field: FieldId): Saver<T> {
  return async (value): Promise<SaveResult> => {
    const res = await patchContact({ id, [field]: value as never });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  };
}

export function ContFirstName({
  id,
  value,
  className,
}: {
  id: string;
  value: string;
  className?: string;
}) {
  return (
    <InlineText
      value={value}
      nullable={false}
      maxLength={120}
      className={className}
      onSave={makeSaver<string | null>(id, "firstName")}
    />
  );
}

export function ContLastName({
  id,
  value,
  className,
}: {
  id: string;
  value: string;
  className?: string;
}) {
  return (
    <InlineText
      value={value}
      nullable={false}
      maxLength={120}
      className={className}
      onSave={makeSaver<string | null>(id, "lastName")}
    />
  );
}

export function ContEmail({
  id,
  value,
  className,
}: {
  id: string;
  value: string | null;
  className?: string;
}) {
  return (
    <InlineText
      value={value}
      maxLength={200}
      className={className}
      onSave={async (raw): Promise<SaveResult> => {
        const trimmed = raw?.trim() ?? "";
        if (trimmed === "") {
          const res = await patchContact({ id, email: null });
          return res.ok ? { ok: true } : { ok: false, message: res.message };
        }
        const res = await patchContact({ id, email: trimmed.toLowerCase() });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function ContPhone({
  id,
  value,
  className,
}: {
  id: string;
  value: string | null;
  className?: string;
}) {
  return (
    <InlineText
      value={value}
      maxLength={40}
      className={className}
      onSave={makeSaver<string | null>(id, "phone")}
    />
  );
}

export function ContJobTitle({
  id,
  value,
  className,
  placeholder = "Ajouter un poste / fonction",
}: {
  id: string;
  value: string | null;
  className?: string;
  placeholder?: string;
}) {
  return (
    <InlineText
      value={value}
      maxLength={160}
      className={className}
      placeholder={placeholder}
      onSave={makeSaver<string | null>(id, "jobTitle")}
    />
  );
}

export function ContLinkedin({ id, value }: { id: string; value: string | null }) {
  return (
    <InlineText
      value={value}
      maxLength={500}
      onSave={async (raw): Promise<SaveResult> => {
        const trimmed = raw?.trim() ?? "";
        if (trimmed === "") {
          const res = await patchContact({ id, linkedinUrl: null });
          return res.ok ? { ok: true } : { ok: false, message: res.message };
        }
        try {
          new URL(trimmed);
        } catch {
          return { ok: false, message: "URL invalide." };
        }
        const res = await patchContact({ id, linkedinUrl: trimmed });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function ContEntity({
  id,
  value,
  options,
}: {
  id: string;
  value: { id: string; name: string } | null;
  options: { id: string; name: string }[];
}) {
  return (
    <InlineFk
      value={value ? { id: value.id, label: value.name } : null}
      options={options.map((o) => ({ id: o.id, label: o.name }))}
      onSave={makeSaver<string | null>(id, "entityId")}
      searchPlaceholder="Rechercher une entité…"
      clearLabel="Aucune entité"
      onCreate={async (name) => {
        const res = await quickCreateEntity({ name });
        if (!res.ok) throw new Error(res.message);
        return { id: res.data.id, label: res.data.name };
      }}
      createLabel="Créer l'entité"
    />
  );
}

export function ContNotes({ id, value }: { id: string; value: string | null }) {
  return (
    <InlineMultiline
      value={value}
      onSave={makeSaver<string | null>(id, "notes")}
      placeholder="Cliquer pour ajouter des notes…"
    />
  );
}

type Address = {
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
} | null;

export function ContAddress({ id, value }: { id: string; value: Address }) {
  const [open, setOpen] = useState(false);
  const [street, setStreet] = useState(value?.street ?? "");
  const [postalCode, setPostalCode] = useState(value?.postalCode ?? "");
  const [city, setCity] = useState(value?.city ?? "");
  const [country, setCountry] = useState(value?.country ?? "");
  const [pending, startTransition] = useTransition();

  function display(): React.ReactNode {
    if (!value) return <span className="text-muted-foreground italic">Cliquer pour ajouter…</span>;
    const line1 = value.street ?? "";
    const line2 = [value.postalCode, value.city].filter(Boolean).join(" ");
    const line3 = value.country ?? "";
    const lines = [line1, line2, line3].filter(Boolean);
    if (lines.length === 0) {
      return <span className="text-muted-foreground italic">Cliquer pour ajouter…</span>;
    }
    return <span className="whitespace-pre-line">{lines.join("\n")}</span>;
  }

  function save() {
    const s = street.trim();
    const p = postalCode.trim();
    const c = city.trim();
    const co = country.trim();
    const next: Address =
      s || p || c || co ? { street: s, postalCode: p, city: c, country: co } : null;
    startTransition(async () => {
      const res = await patchContact({ id, address: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOpen(false);
    });
  }

  function cancel() {
    setStreet(value?.street ?? "");
    setPostalCode(value?.postalCode ?? "");
    setCity(value?.city ?? "");
    setCountry(value?.country ?? "");
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="-mx-1 block w-full rounded px-1 py-0.5 text-left hover:bg-muted/50"
        >
          {display()}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3 p-3">
        <div className="space-y-1.5">
          <Label htmlFor="addr-street" className="text-xs">
            Rue
          </Label>
          <Input
            id="addr-street"
            value={street}
            onChange={(e) => setStreet(e.target.value)}
            placeholder="12 rue de la Paix"
            disabled={pending}
            className="h-8"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="addr-postal" className="text-xs">
              Code postal
            </Label>
            <Input
              id="addr-postal"
              value={postalCode}
              onChange={(e) => setPostalCode(e.target.value)}
              placeholder="75002"
              disabled={pending}
              className="h-8"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="addr-city" className="text-xs">
              Ville
            </Label>
            <Input
              id="addr-city"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Paris"
              disabled={pending}
              className="h-8"
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="addr-country" className="text-xs">
            Pays
          </Label>
          <Input
            id="addr-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="France"
            disabled={pending}
            className="h-8"
          />
        </div>
        <div className="flex items-center justify-end gap-1.5 pt-1">
          <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={pending}>
            Annuler
          </Button>
          <Button type="button" size="sm" onClick={save} disabled={pending}>
            {pending ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
