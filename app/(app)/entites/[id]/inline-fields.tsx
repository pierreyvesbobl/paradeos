"use client";

import { InlineMultiline } from "@/components/inline/inline-multiline";
import { InlineSelect } from "@/components/inline/inline-select";
import { InlineText } from "@/components/inline/inline-text";
import type { SaveResult, Saver } from "@/components/inline/types";
import { Badge } from "@/components/ui/badge";
import { patchEntity } from "@/lib/actions/entities";
import { type EntityKind, entityKindLabels } from "@/lib/schemas/entities";

type FieldId = "name" | "kind" | "website" | "siren" | "vatNumber" | "notes";

function makeSaver<T>(id: string, field: FieldId): Saver<T> {
  return async (value): Promise<SaveResult> => {
    const res = await patchEntity({ id, [field]: value as never });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  };
}

const KIND_OPTIONS = (Object.entries(entityKindLabels) as [EntityKind, string][]).map(
  ([value, label]) => ({ value, label }),
);

const KIND_BADGE: Record<EntityKind, string> = {
  client:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  prospect:
    "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  partner:
    "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  supplier:
    "border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950 dark:text-cyan-300",
  other:
    "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
};

export function EntName({
  id,
  value,
  className = "font-semibold text-2xl tracking-tight",
}: {
  id: string;
  value: string;
  className?: string;
}) {
  return (
    <InlineText
      value={value}
      nullable={false}
      maxLength={200}
      className={className}
      onSave={makeSaver<string | null>(id, "name")}
    />
  );
}

export function EntKind({ id, value }: { id: string; value: EntityKind }) {
  return (
    <InlineSelect<EntityKind>
      value={value}
      options={KIND_OPTIONS}
      onSave={makeSaver<EntityKind>(id, "kind")}
      trigger={(c) => (
        <Badge variant="outline" className={c ? KIND_BADGE[c.value] : undefined}>
          {c?.label ?? "—"}
        </Badge>
      )}
    />
  );
}

export function EntWebsite({
  id,
  value,
  className,
  placeholder,
}: {
  id: string;
  value: string | null;
  className?: string;
  placeholder?: string;
}) {
  return (
    <InlineText
      value={value}
      maxLength={500}
      className={className}
      placeholder={placeholder}
      onSave={async (raw): Promise<SaveResult> => {
        const trimmed = raw?.trim() ?? "";
        if (trimmed === "") {
          const res = await patchEntity({ id, website: null });
          return res.ok ? { ok: true } : { ok: false, message: res.message };
        }
        try {
          new URL(trimmed);
        } catch {
          return { ok: false, message: "URL invalide." };
        }
        const res = await patchEntity({ id, website: trimmed });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function EntSiren({ id, value }: { id: string; value: string | null }) {
  return (
    <InlineText
      value={value}
      maxLength={9}
      placeholder="9 chiffres"
      className="font-mono text-sm"
      onSave={async (raw): Promise<SaveResult> => {
        const trimmed = raw?.replace(/\s/g, "") ?? "";
        if (trimmed === "") {
          const res = await patchEntity({ id, siren: null });
          return res.ok ? { ok: true } : { ok: false, message: res.message };
        }
        if (!/^\d{9}$/.test(trimmed)) {
          return { ok: false, message: "Le SIREN doit contenir 9 chiffres." };
        }
        const res = await patchEntity({ id, siren: trimmed });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function EntVat({ id, value }: { id: string; value: string | null }) {
  return (
    <InlineText
      value={value}
      maxLength={40}
      className="font-mono text-sm"
      onSave={makeSaver<string | null>(id, "vatNumber")}
    />
  );
}

export function EntNotes({ id, value }: { id: string; value: string | null }) {
  return (
    <InlineMultiline
      value={value}
      onSave={makeSaver<string | null>(id, "notes")}
      placeholder="Cliquer pour ajouter des notes…"
    />
  );
}

type Address = {
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  country?: string | null;
} | null;

type AddressField = "street" | "postalCode" | "city" | "country";

const ADDRESS_LIMITS: Record<AddressField, number> = {
  street: 200,
  postalCode: 20,
  city: 120,
  country: 80,
};

export function EntAddressField({
  id,
  field,
  current,
  placeholder,
}: {
  id: string;
  field: AddressField;
  current: Address;
  placeholder?: string;
}) {
  const value = (current?.[field] as string | null | undefined) ?? null;
  return (
    <InlineText
      value={value}
      maxLength={ADDRESS_LIMITS[field]}
      placeholder={placeholder}
      onSave={async (raw): Promise<SaveResult> => {
        const trimmed = raw?.trim() ?? "";
        const next: Record<AddressField, string | null> = {
          street: (current?.street as string | null) ?? null,
          postalCode: (current?.postalCode as string | null) ?? null,
          city: (current?.city as string | null) ?? null,
          country: (current?.country as string | null) ?? null,
        };
        next[field] = trimmed === "" ? null : trimmed;
        const allEmpty = Object.values(next).every((v) => v === null);
        const res = await patchEntity({ id, address: allEmpty ? null : next });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}
