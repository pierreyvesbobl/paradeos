"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Filter, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

// ---------- Types ----------

export type FilterDef =
  | {
      key: string;
      label: string;
      type: "enum";
      options: { value: string; label: string }[];
    }
  | { key: string; label: string; type: "text" }
  | { key: string; label: string; type: "date" }
  | { key: string; label: string; type: "number" };

export type FilterOp =
  // enum
  | "is"
  | "isnot"
  | "in"
  | "notin"
  // text
  | "contains"
  | "eq"
  | "neq"
  // date
  | "before"
  | "after"
  // number
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  // common
  | "empty"
  | "notempty";

export type ActiveFilter = {
  key: string;
  op: FilterOp;
  value: string | string[] | null;
};

// ---------- URL serialization ----------

const FILTER_PARAM = "f"; // ?f=key:op:value (répété)

const OPS_BY_TYPE: Record<FilterDef["type"], { value: FilterOp; label: string }[]> = {
  enum: [
    { value: "in", label: "Est l'un de" },
    { value: "notin", label: "N'est pas" },
    { value: "empty", label: "Est vide" },
    { value: "notempty", label: "N'est pas vide" },
  ],
  text: [
    { value: "contains", label: "Contient" },
    { value: "eq", label: "Égal à" },
    { value: "neq", label: "Différent de" },
    { value: "empty", label: "Est vide" },
    { value: "notempty", label: "N'est pas vide" },
  ],
  date: [
    { value: "eq", label: "Le" },
    { value: "before", label: "Avant le" },
    { value: "after", label: "Après le" },
    { value: "empty", label: "Est vide" },
    { value: "notempty", label: "N'est pas vide" },
  ],
  number: [
    { value: "eq", label: "=" },
    { value: "neq", label: "≠" },
    { value: "gt", label: ">" },
    { value: "lt", label: "<" },
    { value: "gte", label: "≥" },
    { value: "lte", label: "≤" },
    { value: "empty", label: "Est vide" },
    { value: "notempty", label: "N'est pas vide" },
  ],
};

export function parseFilters(searchParams: URLSearchParams, defs: FilterDef[]): ActiveFilter[] {
  const allowedKeys = new Set(defs.map((d) => d.key));
  const out: ActiveFilter[] = [];
  for (const raw of searchParams.getAll(FILTER_PARAM)) {
    const [key, op, ...rest] = raw.split(":");
    if (!key || !op || !allowedKeys.has(key)) continue;
    const valueStr = rest.join(":");
    const def = defs.find((d) => d.key === key);
    if (!def) continue;
    const value = decodeFilterValue(valueStr, op as FilterOp);
    out.push({ key, op: op as FilterOp, value });
  }
  return out;
}

function decodeFilterValue(raw: string, op: FilterOp): string | string[] | null {
  if (op === "empty" || op === "notempty") return null;
  if (op === "in" || op === "notin") {
    return raw
      .split(",")
      .map(decodeURIComponent)
      .filter((v) => v.length > 0);
  }
  return decodeURIComponent(raw);
}

function encodeFilter(f: ActiveFilter): string {
  if (f.op === "empty" || f.op === "notempty") return `${f.key}:${f.op}:`;
  if (Array.isArray(f.value)) {
    return `${f.key}:${f.op}:${f.value.map(encodeURIComponent).join(",")}`;
  }
  return `${f.key}:${f.op}:${encodeURIComponent(String(f.value ?? ""))}`;
}

function buildUrl(
  pathname: string,
  searchParams: URLSearchParams,
  next: { filters?: ActiveFilter[] },
): string {
  const sp = new URLSearchParams(searchParams);
  if (next.filters !== undefined) {
    sp.delete(FILTER_PARAM);
    for (const f of next.filters) sp.append(FILTER_PARAM, encodeFilter(f));
  }
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

// ---------- Component ----------

export function NotionFilters({
  pathname,
  filterDefs,
  activeFilters,
}: {
  pathname: string;
  filterDefs: FilterDef[];
  activeFilters: ActiveFilter[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function go(next: { filters?: ActiveFilter[] }) {
    router.push(buildUrl(pathname, searchParams, next));
  }

  function addFilter(def: FilterDef) {
    const op: FilterOp = def.type === "enum" ? "in" : def.type === "text" ? "contains" : "eq";
    const value: string | string[] | null = def.type === "enum" ? [] : "";
    go({ filters: [...activeFilters, { key: def.key, op, value }] });
  }

  function updateFilter(idx: number, next: ActiveFilter) {
    const copy = activeFilters.slice();
    copy[idx] = next;
    go({ filters: copy });
  }

  function removeFilter(idx: number) {
    go({ filters: activeFilters.filter((_, i) => i !== idx) });
  }

  function clearAll() {
    go({ filters: [] });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <AddFilterButton defs={filterDefs} onPick={addFilter} />
        {activeFilters.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground">
            <X className="size-3.5" />
            Tout effacer
          </Button>
        ) : null}
      </div>

      {activeFilters.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {activeFilters.map((f, i) => {
            const def = filterDefs.find((d) => d.key === f.key);
            if (!def) return null;
            return (
              <FilterPill
                key={`${f.key}-${i}`}
                def={def}
                filter={f}
                onChange={(next) => updateFilter(i, next)}
                onRemove={() => removeFilter(i)}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function AddFilterButton({
  defs,
  onPick,
}: {
  defs: FilterDef[];
  onPick: (def: FilterDef) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const filtered = defs.filter((d) => d.label.toLowerCase().includes(search.toLowerCase()));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Filter className="size-3.5" />
          Filtrer
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        <div className="border-b p-2">
          <div className="flex items-center gap-2 rounded-md border bg-background px-2">
            <Search className="size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filtrer par…"
              className="h-8 flex-1 bg-transparent text-sm outline-none"
            />
          </div>
        </div>
        <ul className="max-h-72 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-muted-foreground text-xs">Aucune propriété.</li>
          ) : (
            filtered.map((d) => (
              <li key={d.key}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(d);
                    setOpen(false);
                    setSearch("");
                  }}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                >
                  {d.label}
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function FilterPill({
  def,
  filter,
  onChange,
  onRemove,
}: {
  def: FilterDef;
  filter: ActiveFilter;
  onChange: (next: ActiveFilter) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ops = OPS_BY_TYPE[def.type];
  const opLabel = ops.find((o) => o.value === filter.op)?.label ?? filter.op;
  const valueLabel = formatFilterValue(def, filter);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="inline-flex items-center gap-0 rounded-md border bg-card text-xs">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-l-md px-2 py-1 hover:bg-muted"
          >
            <span className="font-medium">{def.label}</span>
            <span className="text-muted-foreground">{opLabel}</span>
            {valueLabel ? <span className="font-medium">{valueLabel}</span> : null}
          </button>
        </PopoverTrigger>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Retirer ce filtre"
          className="rounded-r-md border-l p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3" />
        </button>
      </div>
      <PopoverContent align="start" className="w-72 space-y-2 p-3">
        <div className="space-y-1">
          <Label className="text-xs">Opérateur</Label>
          <select
            value={filter.op}
            onChange={(e) => {
              const newOp = e.target.value as FilterOp;
              const newValue =
                newOp === "empty" || newOp === "notempty"
                  ? null
                  : def.type === "enum"
                    ? Array.isArray(filter.value)
                      ? filter.value
                      : []
                    : typeof filter.value === "string"
                      ? filter.value
                      : "";
              onChange({ ...filter, op: newOp, value: newValue });
            }}
            className="block h-8 w-full rounded-md border bg-background px-2 text-sm"
          >
            {ops.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {filter.op !== "empty" && filter.op !== "notempty" ? (
          <ValueInput def={def} filter={filter} onChange={onChange} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function ValueInput({
  def,
  filter,
  onChange,
}: {
  def: FilterDef;
  filter: ActiveFilter;
  onChange: (next: ActiveFilter) => void;
}) {
  if (def.type === "enum") {
    const current = Array.isArray(filter.value) ? filter.value : [];
    return (
      <div className="space-y-1">
        <Label className="text-xs">Valeur(s)</Label>
        <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-md border bg-background p-1">
          {def.options.map((o) => {
            const checked = current.includes(o.value);
            return (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...current, o.value]
                        : current.filter((v) => v !== o.value);
                      onChange({ ...filter, value: next });
                    }}
                  />
                  {o.label}
                </label>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }
  if (def.type === "date") {
    return (
      <div className="space-y-1">
        <Label className="text-xs">Date</Label>
        <Input
          type="date"
          value={typeof filter.value === "string" ? filter.value : ""}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          className="h-8"
        />
      </div>
    );
  }
  if (def.type === "number") {
    return (
      <div className="space-y-1">
        <Label className="text-xs">Nombre</Label>
        <Input
          type="number"
          value={typeof filter.value === "string" ? filter.value : ""}
          onChange={(e) => onChange({ ...filter, value: e.target.value })}
          className="h-8"
        />
      </div>
    );
  }
  // text
  return (
    <div className="space-y-1">
      <Label className="text-xs">Valeur</Label>
      <Input
        value={typeof filter.value === "string" ? filter.value : ""}
        onChange={(e) => onChange({ ...filter, value: e.target.value })}
        placeholder="Saisir…"
        className="h-8"
      />
    </div>
  );
}

function formatFilterValue(def: FilterDef, f: ActiveFilter): string {
  if (f.op === "empty" || f.op === "notempty") return "";
  if (def.type === "enum") {
    const arr = Array.isArray(f.value) ? f.value : [];
    if (arr.length === 0) return "—";
    const labels = arr.map((v) => def.options.find((o) => o.value === v)?.label ?? v).slice(0, 2);
    return arr.length > 2 ? `${labels.join(", ")} +${arr.length - 2}` : labels.join(", ");
  }
  return typeof f.value === "string" && f.value.length > 0 ? f.value : "—";
}
