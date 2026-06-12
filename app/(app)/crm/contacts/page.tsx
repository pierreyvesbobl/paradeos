import {
  ContEmail,
  ContEntity,
  ContFirstName,
  ContJobTitle,
  ContLastName,
  ContPhone,
} from "@/app/(app)/contacts/[id]/inline-fields";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { NotionFilters } from "@/components/table/notion-filters";
import { type SortState, SortableHeader, parseSort } from "@/components/table/sortable-header";
import { Button } from "@/components/ui/button";
import { SearchInputWithClear } from "@/components/ui/search-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PersistViewParams } from "@/components/view-prefs/persist-view-params";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import { buildSortHref, collectF } from "@/lib/filters/url-helpers";
import { contactQualificationEnum, contactQualificationLabels } from "@/lib/schemas/coworking";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { type SQL, and, asc, desc, or, sql } from "drizzle-orm";
import { ArrowRight, Plus, Users } from "lucide-react";
import Link from "next/link";
import { CrmTabs } from "../crm-tabs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const SORT_FIELDS = ["lastName", "firstName", "jobTitle", "entity", "email"] as const;

const PERSISTED_KEYS = ["q", "f", "sort"] as const;

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

export default async function CrmContactsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await applyViewPrefRedirect({
    pageKey: "contacts",
    pathname: "/crm/contacts",
    searchParams: params,
    relevantKeys: PERSISTED_KEYS,
  });
  const query = typeof params.q === "string" ? params.q.trim() : "";
  const sortRaw = typeof params.sort === "string" ? params.sort : undefined;
  const sortState = parseSort(sortRaw, SORT_FIELDS);

  const conn = await db();
  const entityList = await conn
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .orderBy(asc(entities.name));

  const FILTER_DEFS = [
    {
      key: "entity",
      label: "Entité",
      type: "enum" as const,
      options: entityList.map((e) => ({ value: e.id, label: e.name })),
    },
    {
      key: "qualification",
      label: "Qualification",
      type: "enum" as const,
      options: contactQualificationEnum.options.map((q) => ({
        value: q,
        label: contactQualificationLabels[q],
      })),
    },
    { key: "firstName", label: "Prénom", type: "text" as const },
    { key: "lastName", label: "Nom", type: "text" as const },
    { key: "email", label: "E-mail", type: "text" as const },
    { key: "jobTitle", label: "Poste", type: "text" as const },
  ];

  const filters = parseFiltersFromSearchParams(
    params,
    FILTER_DEFS.map((d) => d.key),
  );
  const filterColumns = [
    { key: "entity", column: contacts.entityId, kind: "enum" as const },
    { key: "qualification", column: contacts.qualification, kind: "enum" as const },
    { key: "firstName", column: contacts.firstName, kind: "text" as const },
    { key: "lastName", column: contacts.lastName, kind: "text" as const },
    { key: "email", column: contacts.email, kind: "text" as const },
    { key: "jobTitle", column: contacts.jobTitle, kind: "text" as const },
  ];
  const filterConditions = applyFilters(filters, filterColumns);

  const conditions: SQL[] = [...filterConditions];
  if (query) {
    // ILIKE est case-insensitive mais accent-sensitive : sans unaccent,
    // chercher "benedicte" ne matche pas "Bénédicte". unaccent()
    // (migration 0041) normalise des deux côtés.
    const pattern = `%${query}%`;
    const like = or(
      sql`unaccent(${contacts.firstName}) ilike unaccent(${pattern})`,
      sql`unaccent(${contacts.lastName}) ilike unaccent(${pattern})`,
      sql`unaccent(coalesce(${contacts.email}, '')) ilike unaccent(${pattern})`,
      sql`unaccent(coalesce(${entities.name}, '')) ilike unaccent(${pattern})`,
    );
    if (like) conditions.push(like);
  }

  const rows = await conn
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
    .orderBy(...orderByFor(sortState));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="CRM"
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

      <CrmTabs current="contacts" />

      <NotionFilters
        pathname="/crm/contacts"
        filterDefs={FILTER_DEFS}
        activeFilters={filters.map((f) => ({ key: f.key, op: f.op, value: f.value }))}
      />
      <PersistViewParams pageKey="contacts" relevantKeys={PERSISTED_KEYS} />

      <form className="max-w-sm">
        <SearchInputWithClear
          name="q"
          defaultValue={query}
          placeholder="Rechercher par nom, e-mail, entité…"
        />
        {collectF(params).map((f, i) => (
          <input key={`f-${i}-${f}`} type="hidden" name="f" value={f} />
        ))}
        {sortRaw ? <input type="hidden" name="sort" value={sortRaw} /> : null}
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
                    buildHref={(next) => buildSortHref("/crm/contacts", params, next)}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="Entité"
                    field="entity"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/contacts", params, next)}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    label="E-mail"
                    field="email"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/contacts", params, next)}
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
