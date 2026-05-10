"use client";

import { Badge } from "@/components/ui/badge";
import { type DateRange, DateRangePicker } from "@/components/ui/date-range-picker";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { updateCoworkingContract, updateCoworkingInvoice } from "@/lib/actions/coworking";
import {
  type CoworkingContractStatus,
  type CoworkingInvoiceBilledBy,
  type CoworkingInvoiceStatus,
  coworkingContractStatusEnum,
  coworkingContractStatusLabels,
  coworkingInvoiceBilledByEnum,
  coworkingInvoiceBilledByLabels,
  coworkingInvoiceStatusEnum,
  coworkingInvoiceStatusLabels,
} from "@/lib/schemas/coworking";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { toast } from "sonner";

// ---------- Génériques ----------

type ActionResult = { ok: true } | { ok: false; message: string };

function useInlinePatch<T>(saver: (next: T) => Promise<ActionResult>) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function commit(next: T, onDone?: () => void) {
    startTransition(async () => {
      const res = await saver(next);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      onDone?.();
      router.refresh();
    });
  }
  return { pending, commit };
}

/** Édition texte inline : click → input, Enter pour save, Esc pour annuler. */
function InlineText({
  value,
  onSave,
  className,
  placeholder,
}: {
  value: string;
  onSave: (next: string) => Promise<ActionResult>;
  className?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);
  const { pending, commit } = useInlinePatch(onSave);

  useEffect(() => setDraft(value), [value]);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn("cursor-text rounded px-1 py-0.5 text-left hover:bg-muted/50", className)}
      >
        {value || <span className="text-muted-foreground italic">{placeholder ?? "—"}</span>}
      </button>
    );
  }

  function save() {
    if (draft.trim() === value.trim()) {
      setEditing(false);
      return;
    }
    commit(draft.trim(), () => setEditing(false));
  }

  return (
    <Input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
      }}
      disabled={pending}
      className={cn("h-7 px-1.5 text-sm", className)}
    />
  );
}

/** Édition number inline (entier ou décimal). */
function InlineNumber({
  value,
  onSave,
  step = 1,
  min,
  className,
  formatDisplay,
}: {
  value: number | string;
  onSave: (next: string) => Promise<ActionResult>;
  step?: number;
  min?: number;
  className?: string;
  formatDisplay?: (v: number) => string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  const { pending, commit } = useInlinePatch(onSave);

  useEffect(() => setDraft(String(value)), [value]);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  if (!editing) {
    const numeric = typeof value === "string" ? Number(value) : value;
    const display =
      formatDisplay && Number.isFinite(numeric) ? formatDisplay(numeric) : String(value);
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn("cursor-text rounded px-1 py-0.5 text-left hover:bg-muted/50", className)}
      >
        {display}
      </button>
    );
  }

  function save() {
    if (draft === String(value)) {
      setEditing(false);
      return;
    }
    commit(draft, () => setEditing(false));
  }

  return (
    <Input
      ref={ref}
      type="number"
      step={step}
      min={min}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") {
          setDraft(String(value));
          setEditing(false);
        }
      }}
      disabled={pending}
      className={cn("h-7 px-1.5 text-sm", className)}
    />
  );
}

/** Édition date (input type=date). */
function InlineDate({
  value,
  onSave,
  className,
  placeholder = "—",
}: {
  value: string | null;
  onSave: (next: string | null) => Promise<ActionResult>;
  className?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const ref = useRef<HTMLInputElement>(null);
  const { pending, commit } = useInlinePatch(onSave);

  useEffect(() => setDraft(value ?? ""), [value]);
  useEffect(() => {
    if (editing) ref.current?.focus();
  }, [editing]);

  if (!editing) {
    const display = value
      ? new Date(value).toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
        })
      : placeholder;
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className={cn(
          "cursor-text rounded px-1 py-0.5 text-left hover:bg-muted/50",
          !value && "text-muted-foreground italic",
          className,
        )}
      >
        {display}
      </button>
    );
  }

  function save() {
    const next = draft || null;
    if (next === value) {
      setEditing(false);
      return;
    }
    commit(next, () => setEditing(false));
  }

  return (
    <Input
      ref={ref}
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        if (e.key === "Enter") save();
        if (e.key === "Escape") {
          setDraft(value ?? "");
          setEditing(false);
        }
      }}
      disabled={pending}
      className={cn("h-7 px-1.5 text-sm", className)}
    />
  );
}

/**
 * Édition d'une période (start + end) via DateRangePicker. Sauvegarde
 * les deux dates en un seul appel pour rester cohérent.
 */
function InlineDateRangeEditor({
  start,
  end,
  onSave,
  className,
  allowEmptyEnd = false,
}: {
  start: string | null;
  end: string | null;
  onSave: (next: { start: string | null; end: string | null }) => Promise<ActionResult>;
  className?: string;
  /** Si true, autorise un end null (utile pour contrats ouverts). */
  allowEmptyEnd?: boolean;
}) {
  const { pending, commit } = useInlinePatch(onSave);
  const value: DateRange | null =
    start || end
      ? {
          start: start ? new Date(`${start}T00:00:00`) : null,
          end: end ? new Date(`${end}T00:00:00`) : null,
        }
      : null;

  function fmt(d: Date | null): string | null {
    if (!d) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function handleChange(next: DateRange | null) {
    const nextStart = fmt(next?.start ?? null);
    const nextEnd = fmt(next?.end ?? null);
    if (!allowEmptyEnd && nextStart && !nextEnd) return; // attend le 2e clic
    if (nextStart === start && nextEnd === end) return;
    commit({ start: nextStart, end: nextEnd });
  }

  const display = (() => {
    if (!start && !end) return "—";
    const s = start
      ? new Date(start).toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
        })
      : "?";
    const e = end
      ? new Date(end).toLocaleDateString("fr-FR", {
          day: "2-digit",
          month: "2-digit",
          year: "2-digit",
        })
      : "—";
    return `${s} → ${e}`;
  })();

  return (
    <DateRangePicker
      value={value}
      onChange={handleChange}
      disabled={pending}
      trigger={
        <button
          type="button"
          className={cn(
            "cursor-pointer rounded px-1 py-0.5 text-left text-muted-foreground text-xs hover:bg-muted/50",
            (!start || !end) && "italic",
            className,
          )}
        >
          {display}
        </button>
      }
    />
  );
}

/** Sélection d'enum via popover, rendu en Badge. */
function InlineEnum<T extends string>({
  value,
  options,
  labels,
  variantOf,
  onSave,
}: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  variantOf?: (v: T) => "default" | "secondary" | "outline" | "destructive";
  onSave: (next: T) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const { pending, commit } = useInlinePatch(onSave);

  function pick(next: T) {
    if (next === value) {
      setOpen(false);
      return;
    }
    commit(next, () => setOpen(false));
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="cursor-pointer rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Badge variant={variantOf?.(value) ?? "default"} className="cursor-pointer">
            {labels[value]}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-1">
        <ul className="space-y-0.5">
          {options.map((opt) => (
            <li key={opt}>
              <button
                type="button"
                onClick={() => pick(opt)}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span>{labels[opt]}</span>
                {opt === value ? <Check className="size-3.5" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

// ---------- Wrappers spécifiques aux contrats ----------

const contractStatusVariant: Record<
  CoworkingContractStatus,
  "default" | "secondary" | "outline" | "destructive"
> = { en_cours: "default", termine: "outline" };

export function ContractStatusEditor({
  id,
  value,
}: { id: string; value: CoworkingContractStatus }) {
  return (
    <InlineEnum
      value={value}
      options={coworkingContractStatusEnum.options}
      labels={coworkingContractStatusLabels}
      variantOf={(v) => contractStatusVariant[v]}
      onSave={async (status) => {
        const res = await updateCoworkingContract({ id, status });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function ContractNameEditor({ id, value }: { id: string; value: string }) {
  return (
    <InlineText
      value={value}
      className="font-medium"
      onSave={async (name) => {
        const res = await updateCoworkingContract({ id, name });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function ContractDesksEditor({ id, value }: { id: string; value: number }) {
  return (
    <InlineNumber
      value={value}
      step={1}
      min={1}
      className="w-16 text-right tabular-nums"
      onSave={async (next) => {
        const desks = Number.parseInt(next, 10);
        if (!Number.isFinite(desks) || desks < 1) {
          return { ok: false, message: "Nombre de postes invalide." };
        }
        const res = await updateCoworkingContract({ id, desks });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function ContractPriceEditor({ id, value }: { id: string; value: string }) {
  return (
    <InlineNumber
      value={value}
      step={0.01}
      min={0}
      className="w-24 text-right tabular-nums"
      formatDisplay={(v) => `${v.toLocaleString("fr-FR")} €`}
      onSave={async (next) => {
        const num = Number(next);
        if (!Number.isFinite(num) || num < 0) return { ok: false, message: "Prix invalide." };
        const res = await updateCoworkingContract({ id, unitPriceHt: next });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function ContractPeriodEditor({
  id,
  startDate,
  endDate,
}: {
  id: string;
  startDate: string;
  endDate: string | null;
}) {
  return (
    <InlineDateRangeEditor
      start={startDate}
      end={endDate}
      allowEmptyEnd
      onSave={async ({ start, end }) => {
        if (!start) return { ok: false, message: "La date de début est obligatoire." };
        const res = await updateCoworkingContract({ id, startDate: start, endDate: end });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

// ---------- Wrappers spécifiques aux factures ----------

const invoiceStatusVariant: Record<
  CoworkingInvoiceStatus,
  "default" | "secondary" | "outline" | "destructive"
> = { a_facturer: "outline", envoyee: "secondary", payee: "default" };

export function InvoiceStatusEditor({ id, value }: { id: string; value: CoworkingInvoiceStatus }) {
  return (
    <InlineEnum
      value={value}
      options={coworkingInvoiceStatusEnum.options}
      labels={coworkingInvoiceStatusLabels}
      variantOf={(v) => invoiceStatusVariant[v]}
      onSave={async (status) => {
        const res = await updateCoworkingInvoice({ id, status });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function InvoiceBilledByEditor({
  id,
  value,
}: {
  id: string;
  value: CoworkingInvoiceBilledBy;
}) {
  return (
    <InlineEnum
      value={value}
      options={coworkingInvoiceBilledByEnum.options}
      labels={coworkingInvoiceBilledByLabels}
      variantOf={() => "outline"}
      onSave={async (billedBy) => {
        const res = await updateCoworkingInvoice({ id, billedBy });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function InvoiceNameEditor({ id, value }: { id: string; value: string }) {
  return (
    <InlineText
      value={value}
      className="font-medium"
      onSave={async (name) => {
        const res = await updateCoworkingInvoice({ id, name });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function InvoiceDateEditor({ id, value }: { id: string; value: string | null }) {
  return (
    <InlineDate
      value={value}
      onSave={async (next) => {
        const res = await updateCoworkingInvoice({ id, invoiceDate: next });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}

export function InvoicePeriodEditor({
  id,
  periodStart,
  periodEnd,
}: {
  id: string;
  periodStart: string;
  periodEnd: string;
}) {
  return (
    <InlineDateRangeEditor
      start={periodStart}
      end={periodEnd}
      onSave={async ({ start, end }) => {
        if (!start || !end) {
          return { ok: false, message: "Période complète requise (début + fin)." };
        }
        const res = await updateCoworkingInvoice({ id, periodStart: start, periodEnd: end });
        return res.ok ? { ok: true } : { ok: false, message: res.message };
      }}
    />
  );
}
