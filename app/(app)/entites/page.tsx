import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { FilterRow } from "@/components/table/filter-row";
import {
  type SortState,
  SortableHeader,
  parseSort,
  sortToParam,
} from "@/components/table/sortable-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { type EntityKind, entityKindEnum, entityKindLabels } from "@/lib/schemas/entities";
import { type SQL, and, asc, desc, eq, ilike, or } from "drizzle-orm";
import { ArrowRight, Building2, Plus } from "lucide-react";
import Link from "next/link";
import { EntKind, EntName, EntWebsite } from "./[id]/inline-fields";

const SORT_FIELDS = ["name", "kind", "website", "created"] as const;

function orderByFor(sort: SortState): SQL[] {
  if (!sort) return [asc(entities.name)];
  const dir = sort.dir === "asc" ? asc : desc;
  switch (sort.field) {
    case "name":
      return [dir(entities.name)];
    case "kind":
      return [dir(entities.kind), asc(entities.name)];
    case "website":
      return [dir(entities.website), asc(entities.name)];
    case "created":
      return [dir(entities.createdAt)];
    default:
      return [asc(entities.name)];
  }
}

type SearchParams = Promise<{ q?: string; kind?: EntityKind; sort?: string }>;

function buildHref(params: { q?: string; kind?: EntityKind; sort?: string | null }): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.kind) sp.set("kind", params.kind);
  if (params.sort) sp.set("sort", params.sort);
  const qs = sp.toString();
  return qs ? `/entites?${qs}` : "/entites";
}

export default async function EntitiesPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, kind, sort } = await searchParams;
  const query = q?.trim() ?? "";
  const activeKind = kind && entityKindEnum.options.includes(kind) ? kind : undefined;
  const sortState = parseSort(sort, SORT_FIELDS);

  const conn = await db();
  const conditions: SQL[] = [];
  if (query) {
    const like = or(ilike(entities.name, `%${query}%`), ilike(entities.website, `%${query}%`));
    if (like) conditions.push(like);
  }
  if (activeKind) conditions.push(eq(entities.kind, activeKind));

  const rows = await conn
    .select({
      id: entities.id,
      name: entities.name,
      kind: entities.kind,
      website: entities.website,
      createdAt: entities.createdAt,
    })
    .from(entities)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(...orderByFor(sortState));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Entités"
        description="Sociétés clientes, prospects, partenaires et fournisseurs."
        actions={
          <Button asChild>
            <Link href="/entites/nouveau">
              <Plus className="size-4" />
              Nouvelle entité
            </Link>
          </Button>
        }
      />

      <FilterRow
        label="Type"
        items={[
          { value: undefined, label: "Tous", active: !activeKind },
          ...entityKindEnum.options.map((k) => ({
            value: k as string,
            label: entityKindLabels[k],
            active: activeKind === k,
          })),
        ]}
        buildHref={(value) =>
          buildHref({
            kind: value as EntityKind | undefined,
            q: query,
            sort: sortToParam(sortState),
          })
        }
      />

      <form className="max-w-sm">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Rechercher par nom, site web…"
          className="h-9"
        />
        {activeKind ? <input type="hidden" name="kind" value={activeKind} /> : null}
        {sort ? <input type="hidden" name="sort" value={sort} /> : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Building2}
          title={query ? "Aucune entité trouvée." : "Pas encore d'entité."}
          description={query ? undefined : "Crée la première pour commencer."}
          action={
            query ? null : (
              <Button asChild size="sm">
                <Link href="/entites/nouveau">
                  <Plus className="size-4" />
                  Nouvelle entité
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortableHeader
                    label="Nom"
                    field="name"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({ kind: activeKind, q: query, sort: sortToParam(next) })
                    }
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Type"
                    field="kind"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({ kind: activeKind, q: query, sort: sortToParam(next) })
                    }
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Site web"
                    field="website"
                    current={sortState}
                    buildHref={(next) =>
                      buildHref({ kind: activeKind, q: query, sort: sortToParam(next) })
                    }
                  />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <EntName id={row.id} value={row.name} className="font-medium text-sm" />
                      <Link
                        href={`/entites/${row.id}`}
                        aria-label="Ouvrir la fiche"
                        className="ml-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      >
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                  </TableCell>
                  <TableCell>
                    <EntKind id={row.id} value={row.kind} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <EntWebsite id={row.id} value={row.website} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
