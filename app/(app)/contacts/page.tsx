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
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { type SQL, and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { ArrowRight, Plus, Users } from "lucide-react";
import Link from "next/link";
import {
  ContEmail,
  ContEntity,
  ContFirstName,
  ContJobTitle,
  ContLastName,
  ContPhone,
} from "./[id]/inline-fields";

const SORT_FIELDS = ["lastName", "firstName", "jobTitle", "entity", "email"] as const;

function orderByFor(sort: SortState): SQL[] {
  if (!sort) return [asc(contacts.lastName), asc(contacts.firstName)];
  const dir = sort.dir === "asc" ? asc : desc;
  switch (sort.field) {
    case "lastName":
      return [dir(contacts.lastName), asc(contacts.firstName)];
    case "firstName":
      return [dir(contacts.firstName), asc(contacts.lastName)];
    case "jobTitle":
      return [dir(contacts.jobTitle), asc(contacts.lastName)];
    case "entity":
      return [dir(entities.name), asc(contacts.lastName)];
    case "email":
      return [dir(contacts.email), asc(contacts.lastName)];
    default:
      return [asc(contacts.lastName), asc(contacts.firstName)];
  }
}

type SearchParams = Promise<{ q?: string; entity?: string; sort?: string }>;

function buildHref(params: { q?: string; entity?: string; sort?: string | null }): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.entity) sp.set("entity", params.entity);
  if (params.sort) sp.set("sort", params.sort);
  const qs = sp.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

export default async function ContactsPage({ searchParams }: { searchParams: SearchParams }) {
  const { q, entity, sort } = await searchParams;
  const query = q?.trim() ?? "";
  const sortState = parseSort(sort, SORT_FIELDS);
  const activeEntity = entity ?? "all";

  const conn = await db();
  const conditions: SQL[] = [];
  if (query) {
    const like = or(
      ilike(contacts.firstName, `%${query}%`),
      ilike(contacts.lastName, `%${query}%`),
      ilike(contacts.email, `%${query}%`),
      ilike(entities.name, `%${query}%`),
    );
    if (like) conditions.push(like);
  }
  if (activeEntity === "none") conditions.push(isNull(contacts.entityId));
  else if (activeEntity !== "all") conditions.push(eq(contacts.entityId, activeEntity));

  const [rows, entityList] = await Promise.all([
    conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contacts.email,
        phone: contacts.phone,
        jobTitle: contacts.jobTitle,
        entityId: entities.id,
        entityName: entities.name,
      })
      .from(contacts)
      .leftJoin(entities, sql`${contacts.entityId} = ${entities.id}`)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(...orderByFor(sortState)),
    conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .orderBy(asc(entities.name)),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Contacts"
        description="Toutes les personnes physiques suivies par Parade."
        actions={
          <Button asChild>
            <Link href="/contacts/nouveau">
              <Plus className="size-4" />
              Nouveau contact
            </Link>
          </Button>
        }
      />

      <FilterRow
        label="Entité"
        items={[
          { value: undefined, label: "Toutes", active: activeEntity === "all" },
          { value: "none", label: "Sans entité", active: activeEntity === "none" },
          ...entityList.slice(0, 12).map((e) => ({
            value: e.id,
            label: e.name,
            active: activeEntity === e.id,
          })),
        ]}
        buildHref={(value) => buildHref({ q: query, entity: value, sort: sortToParam(sortState) })}
      />

      <form className="max-w-sm">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Rechercher par nom, e-mail, entité…"
          className="h-9"
        />
        {entity ? <input type="hidden" name="entity" value={entity} /> : null}
        {sort ? <input type="hidden" name="sort" value={sort} /> : null}
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={query ? "Aucun contact trouvé." : "Pas encore de contact."}
          description={query ? undefined : "Crée le premier pour commencer."}
          action={
            query ? null : (
              <Button asChild size="sm">
                <Link href="/contacts/nouveau">
                  <Plus className="size-4" />
                  Nouveau contact
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
                    field="lastName"
                    current={sortState}
                    buildHref={(next) => buildHref({ q: query, entity, sort: sortToParam(next) })}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Entité"
                    field="entity"
                    current={sortState}
                    buildHref={(next) => buildHref({ q: query, entity, sort: sortToParam(next) })}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="E-mail"
                    field="email"
                    current={sortState}
                    buildHref={(next) => buildHref({ q: query, entity, sort: sortToParam(next) })}
                  />
                </TableHead>
                <TableHead>Téléphone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="group">
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <ContFirstName
                        id={row.id}
                        value={row.firstName}
                        className="font-medium text-sm"
                      />
                      <ContLastName
                        id={row.id}
                        value={row.lastName}
                        className="font-medium text-sm"
                      />
                      <Link
                        href={`/contacts/${row.id}`}
                        aria-label="Ouvrir la fiche"
                        className="ml-1 inline-flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      >
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </div>
                    <ContJobTitle
                      id={row.id}
                      value={row.jobTitle}
                      className="text-muted-foreground text-xs"
                    />
                  </TableCell>
                  <TableCell>
                    <ContEntity
                      id={row.id}
                      value={row.entityId ? { id: row.entityId, name: row.entityName ?? "" } : null}
                      options={entityList}
                    />
                  </TableCell>
                  <TableCell className="text-sm">
                    <ContEmail id={row.id} value={row.email} />
                  </TableCell>
                  <TableCell className="text-sm">
                    <ContPhone id={row.id} value={row.phone} />
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
