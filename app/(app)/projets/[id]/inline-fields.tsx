"use client";

import { InlineDate } from "@/components/inline/inline-date";
import { InlineFk } from "@/components/inline/inline-fk";
import { InlineMultiline } from "@/components/inline/inline-multiline";
import { InlineSelect } from "@/components/inline/inline-select";
import { InlineText } from "@/components/inline/inline-text";
import type { SaveResult, Saver } from "@/components/inline/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { UserAvatar } from "@/components/user/user-avatar";
import { patchProject } from "@/lib/actions/projects";
import { formatEuro } from "@/lib/format";
import {
  type ProjectBillingType,
  type ProjectKind,
  type ProjectStatus,
  projectBillingTypeLabels,
  projectKindLabels,
  projectStatusLabels,
} from "@/lib/schemas/projects";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";

type FieldId =
  | "name"
  | "kind"
  | "status"
  | "entityId"
  | "color"
  | "icon"
  | "description"
  | "startDate"
  | "endDate"
  | "ownerId"
  | "billingType"
  | "budgetAmount"
  | "hourlyRate";

function makeSaver<T>(id: string, field: FieldId): Saver<T> {
  return async (value): Promise<SaveResult> => {
    const res = await patchProject({ id, [field]: value as never });
    if (!res.ok) return { ok: false, message: res.message };
    return { ok: true };
  };
}

const KIND_OPTIONS = (Object.entries(projectKindLabels) as [ProjectKind, string][]).map(
  ([value, label]) => ({ value, label }),
);
const STATUS_OPTIONS = (Object.entries(projectStatusLabels) as [ProjectStatus, string][]).map(
  ([value, label]) => ({ value, label }),
);
const BILLING_OPTIONS = (
  Object.entries(projectBillingTypeLabels) as [ProjectBillingType, string][]
).map(([value, label]) => ({ value, label }));

export function ProjName({
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

export function ProjKind({ id, value }: { id: string; value: ProjectKind }) {
  return (
    <InlineSelect<ProjectKind>
      value={value}
      options={KIND_OPTIONS}
      onSave={makeSaver<ProjectKind>(id, "kind")}
      trigger={(c) => <Badge variant="outline">{c?.label ?? "—"}</Badge>}
    />
  );
}

const STATUS_BADGE: Record<ProjectStatus, string> = {
  planning:
    "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300",
  active:
    "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  on_hold:
    "border-slate-200 bg-slate-100 text-slate-500 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-500",
  completed:
    "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-300",
  archived:
    "border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-500",
};

export function ProjStatus({ id, value }: { id: string; value: ProjectStatus }) {
  return (
    <InlineSelect<ProjectStatus>
      value={value}
      options={STATUS_OPTIONS}
      onSave={makeSaver<ProjectStatus>(id, "status")}
      trigger={(c) => (
        <Badge variant="outline" className={c ? STATUS_BADGE[c.value] : undefined}>
          {c?.label ?? "—"}
        </Badge>
      )}
    />
  );
}

export function ProjBilling({ id, value }: { id: string; value: ProjectBillingType }) {
  return (
    <InlineSelect<ProjectBillingType>
      value={value}
      options={BILLING_OPTIONS}
      onSave={makeSaver<ProjectBillingType>(id, "billingType")}
      trigger={(c) => <Badge variant="outline">{c?.label ?? "—"}</Badge>}
    />
  );
}

export function ProjDate({
  id,
  field,
  value,
}: {
  id: string;
  field: "startDate" | "endDate";
  value: string | null;
}) {
  return <InlineDate value={value} onSave={makeSaver<string | null>(id, field)} />;
}

export function ProjOwner({
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

export function ProjEntity({
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

export function ProjBudget({ id, value }: { id: string; value: string | null }) {
  const numeric = value != null ? Number(value) : null;
  return (
    <InlineText
      value={numeric != null ? String(numeric) : null}
      inputMode="decimal"
      maxLength={20}
      format={(raw) => (raw != null ? formatEuro(Number(raw)) : "—")}
      onSave={async (raw): Promise<SaveResult> => {
        if (raw === null) {
          const res = await patchProject({ id, budgetAmount: null });
          return res.ok ? { ok: true } : { ok: false, message: res.message };
        }
        const num = Number.parseFloat(raw.replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(num) || num < 0) {
          return { ok: false, message: "Montant invalide." };
        }
        const res = await patchProject({ id, budgetAmount: num });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function ProjHourlyRate({ id, value }: { id: string; value: string | null }) {
  const numeric = value != null ? Number(value) : null;
  return (
    <InlineText
      value={numeric != null ? String(numeric) : null}
      inputMode="decimal"
      maxLength={10}
      format={(raw) => (raw != null ? `${formatEuro(Number(raw))}/h` : "—")}
      onSave={async (raw): Promise<SaveResult> => {
        if (raw === null) {
          const res = await patchProject({ id, hourlyRate: null });
          return res.ok ? { ok: true } : { ok: false, message: res.message };
        }
        const num = Number.parseFloat(raw.replace(/\s/g, "").replace(",", "."));
        if (!Number.isFinite(num) || num < 0) {
          return { ok: false, message: "Taux invalide." };
        }
        const res = await patchProject({ id, hourlyRate: num });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function ProjDescription({ id, value }: { id: string; value: string | null }) {
  return (
    <InlineMultiline
      value={value}
      onSave={makeSaver<string | null>(id, "description")}
      placeholder="Cliquer pour ajouter une description…"
    />
  );
}

const COLOR_PRESETS = [
  "#ef4444", // rouge
  "#f97316", // orange
  "#eab308", // jaune
  "#22c55e", // vert
  "#10b981", // émeraude
  "#06b6d4", // cyan
  "#3b82f6", // bleu
  "#6366f1", // indigo
  "#a855f7", // violet
  "#ec4899", // rose
  "#64748b", // ardoise
  "#0f172a", // noir
];

export function ProjColor({ id, value }: { id: string; value: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function pick(next: string | null) {
    if ((next ?? null) === (value ?? null)) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await patchProject({ id, color: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label="Couleur du projet"
          title={value ?? "Aucune couleur"}
          className="inline-flex size-5 items-center justify-center rounded-full ring-1 ring-border outline-none hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
          style={value ? { backgroundColor: value } : undefined}
        >
          {!value ? (
            <span className="size-2 rounded-full bg-muted-foreground/40" aria-hidden="true" />
          ) : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <div className="grid grid-cols-6 gap-1.5">
          {COLOR_PRESETS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => pick(c)}
              aria-label={c}
              title={c}
              className={`size-6 rounded-full ring-1 ring-border transition-transform hover:scale-110 ${
                value?.toLowerCase() === c.toLowerCase()
                  ? "ring-2 ring-foreground ring-offset-1"
                  : ""
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={() => pick(null)}
          className="mt-2 block w-full rounded-sm px-2 py-1 text-left text-muted-foreground text-xs hover:bg-muted"
        >
          Aucune couleur
        </button>
      </PopoverContent>
    </Popover>
  );
}

export function ProjIcon({ id, value }: { id: string; value: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [pending, startTransition] = useTransition();

  function commit(next: string | null) {
    if ((next ?? null) === (value ?? null)) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      const res = await patchProject({ id, icon: next });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(value ?? "");
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          aria-label="Icône du projet"
          className="inline-flex size-7 items-center justify-center rounded-md text-lg outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {value ? <span>{value}</span> : <span className="text-muted-foreground">＋</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 space-y-2 p-2">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft.trim() === "" ? null : draft.trim());
            if (e.key === "Escape") setOpen(false);
          }}
          placeholder="Texte court"
          maxLength={80}
          className="h-8"
        />
        <div className="flex justify-between">
          <button
            type="button"
            onClick={() => commit(null)}
            className="rounded-sm px-2 py-1 text-muted-foreground text-xs hover:bg-muted"
          >
            Retirer
          </button>
          <button
            type="button"
            onClick={() => commit(draft.trim() === "" ? null : draft.trim())}
            disabled={pending}
            className="rounded-sm bg-foreground px-2 py-1 text-background text-xs hover:opacity-90 disabled:opacity-50"
          >
            Valider
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
