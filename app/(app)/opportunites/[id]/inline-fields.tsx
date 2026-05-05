"use client";

import { InlineDate } from "@/components/inline/inline-date";
import { InlineFk } from "@/components/inline/inline-fk";
import { InlineMultiline } from "@/components/inline/inline-multiline";
import { InlineSelect } from "@/components/inline/inline-select";
import { InlineText } from "@/components/inline/inline-text";
import type { SaveResult, Saver } from "@/components/inline/types";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user/user-avatar";
import { patchOpportunity } from "@/lib/actions/opportunities";
import { formatEuro } from "@/lib/format";
import { type OpportunityStatus, opportunityStatusLabels } from "@/lib/schemas/opportunities";

type FieldId =
  | "title"
  | "status"
  | "source"
  | "valueAmount"
  | "probability"
  | "firstContactDate"
  | "lastContactDate"
  | "followUpDate"
  | "expectedCloseDate"
  | "ownerId"
  | "entityId"
  | "contactId"
  | "notes";

function makeSaver<T>(id: string, field: FieldId): Saver<T> {
  return async (value): Promise<SaveResult> => {
    const res = await patchOpportunity({ id, [field]: value as never });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  };
}

const STATUS_OPTIONS = (
  Object.entries(opportunityStatusLabels) as [OpportunityStatus, string][]
).map(([value, label]) => ({ value, label }));

const STATUS_VARIANT: Record<
  OpportunityStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  not_started: "outline",
  proposal_sent: "default",
  to_follow_up: "secondary",
  awaiting_response: "secondary",
  won: "default",
  lost: "destructive",
};

export function OppTitle({ id, value }: { id: string; value: string }) {
  return (
    <InlineText
      value={value}
      nullable={false}
      maxLength={200}
      className="font-semibold text-2xl tracking-tight"
      onSave={makeSaver<string | null>(id, "title")}
    />
  );
}

export function OppStatus({ id, value }: { id: string; value: OpportunityStatus }) {
  return (
    <InlineSelect<OpportunityStatus>
      value={value}
      options={STATUS_OPTIONS}
      onSave={makeSaver<OpportunityStatus>(id, "status")}
      trigger={(c) => (
        <Badge variant={c ? STATUS_VARIANT[c.value] : "outline"}>{c?.label ?? "—"}</Badge>
      )}
    />
  );
}

export function OppSource({ id, value }: { id: string; value: string | null }) {
  return (
    <InlineText value={value} maxLength={120} onSave={makeSaver<string | null>(id, "source")} />
  );
}

export function OppAmount({ id, value }: { id: string; value: string | null }) {
  const numeric = value != null ? Number(value) : null;
  return (
    <InlineText
      value={numeric != null ? String(numeric) : null}
      inputMode="decimal"
      maxLength={20}
      format={(raw) => (raw != null ? formatEuro(Number(raw)) : "—")}
      onSave={async (raw): Promise<SaveResult> => {
        if (raw === null) {
          const res = await patchOpportunity({ id, valueAmount: null });
          return res.ok ? { ok: true } : { ok: false, message: res.message };
        }
        const num = Number.parseFloat(raw.replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(num) || num < 0) {
          return { ok: false, message: "Montant invalide." };
        }
        const res = await patchOpportunity({ id, valueAmount: num });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function OppProbability({ id, value }: { id: string; value: number | null }) {
  return (
    <InlineText
      value={value != null ? String(value) : null}
      inputMode="numeric"
      maxLength={3}
      format={(raw) => (raw != null ? `${raw}%` : "—")}
      onSave={async (raw): Promise<SaveResult> => {
        if (raw === null) {
          const res = await patchOpportunity({ id, probability: null });
          return res.ok ? { ok: true } : { ok: false, message: res.message };
        }
        const num = Number.parseInt(raw, 10);
        if (!Number.isFinite(num) || num < 0 || num > 100) {
          return { ok: false, message: "Entier entre 0 et 100." };
        }
        const res = await patchOpportunity({ id, probability: num });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function OppDate({
  id,
  field,
  value,
}: {
  id: string;
  field: "firstContactDate" | "lastContactDate" | "followUpDate" | "expectedCloseDate";
  value: string | null;
}) {
  return <InlineDate value={value} onSave={makeSaver<string | null>(id, field)} />;
}

export function OppOwner({
  id,
  value,
  options,
}: {
  id: string;
  value: { id: string; fullName: string | null; avatarUrl: string | null } | null;
  options: { id: string; fullName: string | null; avatarUrl: string | null }[];
}) {
  return (
    <InlineFk
      value={
        value
          ? {
              id: value.id,
              label: value.fullName ?? "(sans nom)",
              leading: <UserAvatar size="sm" name={value.fullName} avatarUrl={value.avatarUrl} />,
            }
          : null
      }
      options={options.map((o) => ({
        id: o.id,
        label: o.fullName ?? "(sans nom)",
        leading: <UserAvatar size="sm" name={o.fullName} avatarUrl={o.avatarUrl} />,
      }))}
      onSave={makeSaver<string | null>(id, "ownerId")}
      searchPlaceholder="Rechercher un membre…"
      clearLabel="Aucun lead"
      triggerVariant="leading-only"
    />
  );
}

export function OppEntity({
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

export function OppContact({
  id,
  value,
  options,
}: {
  id: string;
  value: { id: string; firstName: string; lastName: string } | null;
  options: { id: string; firstName: string; lastName: string }[];
}) {
  return (
    <InlineFk
      value={value ? { id: value.id, label: `${value.firstName} ${value.lastName}` } : null}
      options={options.map((o) => ({
        id: o.id,
        label: `${o.firstName} ${o.lastName}`,
      }))}
      onSave={makeSaver<string | null>(id, "contactId")}
      searchPlaceholder="Rechercher un contact…"
      clearLabel="Aucun contact"
    />
  );
}

export function OppNotes({ id, value }: { id: string; value: string | null }) {
  return (
    <InlineMultiline
      value={value}
      onSave={makeSaver<string | null>(id, "notes")}
      placeholder="Cliquer pour ajouter des notes…"
    />
  );
}
