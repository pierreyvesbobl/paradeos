import "server-only";

import {
  type AnyColumn,
  type SQL,
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

export type FilterOp =
  | "is"
  | "isnot"
  | "in"
  | "notin"
  | "contains"
  | "eq"
  | "neq"
  | "before"
  | "after"
  | "gt"
  | "lt"
  | "gte"
  | "lte"
  | "empty"
  | "notempty";

export type ServerFilter = {
  key: string;
  op: FilterOp;
  value: string | string[] | null;
};

/**
 * Description côté serveur : à quel `column` (ou expression SQL) chaque
 * `key` correspond, et quel `kind` de colonne pour choisir l'opérateur
 * SQL approprié.
 */
export type FilterColumnDef = {
  key: string;
  column: AnyColumn | SQL;
  kind: "enum" | "text" | "date" | "number";
};

/**
 * Parse l'URL côté serveur (mêmes règles que le client) : récupère
 * `?f=key:op:value` répété, ne garde que les clés autorisées.
 */
export function parseFiltersFromSearchParams(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
  allowedKeys: string[],
): ServerFilter[] {
  const raws = collectF(searchParams);
  const allowed = new Set(allowedKeys);
  const out: ServerFilter[] = [];
  for (const raw of raws) {
    const [key, op, ...rest] = raw.split(":");
    if (!key || !op || !allowed.has(key)) continue;
    const value = decodeValue(rest.join(":"), op as FilterOp);
    out.push({ key, op: op as FilterOp, value });
  }
  return out;
}

function collectF(sp: URLSearchParams | Record<string, string | string[] | undefined>): string[] {
  if (sp instanceof URLSearchParams) return sp.getAll("f");
  const v = (sp as Record<string, string | string[] | undefined>).f;
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return [v];
  return [];
}

function decodeValue(raw: string, op: FilterOp): string | string[] | null {
  if (op === "empty" || op === "notempty") return null;
  if (op === "in" || op === "notin") {
    return raw
      .split(",")
      .map(decodeURIComponent)
      .filter((v) => v.length > 0);
  }
  return decodeURIComponent(raw);
}

export function applyFilters(filters: ServerFilter[], defs: FilterColumnDef[]): SQL[] {
  const out: SQL[] = [];
  const map = new Map(defs.map((d) => [d.key, d]));
  for (const f of filters) {
    const def = map.get(f.key);
    if (!def) continue;
    const cond = buildCondition(f, def);
    if (cond) out.push(cond);
  }
  return out;
}

function buildCondition(f: ServerFilter, def: FilterColumnDef): SQL | undefined {
  const col = def.column;
  switch (f.op) {
    case "empty":
      return isNull(col as AnyColumn);
    case "notempty":
      return isNotNull(col as AnyColumn);
    case "in": {
      if (!Array.isArray(f.value) || f.value.length === 0) return undefined;
      return inArray(col as AnyColumn, f.value);
    }
    case "notin": {
      if (!Array.isArray(f.value) || f.value.length === 0) return undefined;
      return notInArray(col as AnyColumn, f.value);
    }
    case "is": {
      if (typeof f.value !== "string" || f.value === "") return undefined;
      return eq(col as AnyColumn, f.value);
    }
    case "isnot": {
      if (typeof f.value !== "string" || f.value === "") return undefined;
      return ne(col as AnyColumn, f.value);
    }
    case "eq": {
      if (typeof f.value !== "string" || f.value === "") return undefined;
      if (def.kind === "number") return eq(col as AnyColumn, Number(f.value));
      if (def.kind === "date") return eq(col as AnyColumn, f.value);
      return eq(col as AnyColumn, f.value);
    }
    case "neq": {
      if (typeof f.value !== "string" || f.value === "") return undefined;
      if (def.kind === "number") return ne(col as AnyColumn, Number(f.value));
      return ne(col as AnyColumn, f.value);
    }
    case "contains": {
      if (typeof f.value !== "string" || f.value === "") return undefined;
      return ilike(col as AnyColumn, `%${f.value}%`);
    }
    case "before": {
      if (typeof f.value !== "string" || f.value === "") return undefined;
      return lt(col as AnyColumn, f.value);
    }
    case "after": {
      if (typeof f.value !== "string" || f.value === "") return undefined;
      return gt(col as AnyColumn, f.value);
    }
    case "gt":
      if (typeof f.value !== "string" || f.value === "") return undefined;
      return gt(col as AnyColumn, def.kind === "number" ? Number(f.value) : f.value);
    case "lt":
      if (typeof f.value !== "string" || f.value === "") return undefined;
      return lt(col as AnyColumn, def.kind === "number" ? Number(f.value) : f.value);
    case "gte":
      if (typeof f.value !== "string" || f.value === "") return undefined;
      return gte(col as AnyColumn, def.kind === "number" ? Number(f.value) : f.value);
    case "lte":
      if (typeof f.value !== "string" || f.value === "") return undefined;
      return lte(col as AnyColumn, def.kind === "number" ? Number(f.value) : f.value);
    default:
      return undefined;
  }
}

// Exporter `and`/`or` pour que les pages composent facilement.
export { and, or, sql };
