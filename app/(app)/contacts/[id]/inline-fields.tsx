"use client";

import { InlineFk } from "@/components/inline/inline-fk";
import { InlineMultiline } from "@/components/inline/inline-multiline";
import { InlineText } from "@/components/inline/inline-text";
import type { SaveResult, Saver } from "@/components/inline/types";
import { patchContact } from "@/lib/actions/contacts";

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
