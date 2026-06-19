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
import { HashedAvatar } from "@/components/user/hashed-avatar";
import { PersistViewParams } from "@/components/view-prefs/persist-view-params";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import { buildSortHref, collectF } from "@/lib/filters/url-helpers";
import { contactQualificationEnum, contactQualificationLabels } from "@/lib/schemas/coworking";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import {
  ArrowRight,
  Buildings,
  EnvelopeSimple,
  Phone,
  Plus,
  Users,
} from "@phosphor-icons/react/dist/ssr";
import { type SQL, and, asc, desc, or, sql } from "drizzle-orm";
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
              <Plus size={14} weight="bold" />
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

      <div className="flex items-center gap-3">
        <form className="max-w-sm flex-1">
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
        <span className="ml-auto text-[var(--ds-text-tertiary)] text-sm">
          {rows.length} contact{rows.length > 1 ? "s" : ""}
        </span>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title={query ? "Aucun contact trouvé." : "Pas encore de contact."}
          description={query ? undefined : "Crée le premier pour commencer."}
          action={
            query ? null : (
              <Button asChild size="sm">
                <Link href="/contacts/nouveau">
                  <Plus size={14} weight="bold" />
                  Nouveau contact
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div>
          <Table>
            <TableHeader>
              <TableRow className="border-border/70 border-b">
                <TableHead className="h-9 px-3 font-semibold text-[11px] text-[var(--ds-text-tertiary)] uppercase tracking-wider">
                  <SortableHeader
                    label="Nom"
                    field="lastName"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/contacts", params, next)}
                  />
                </TableHead>
                <TableHead className="h-9 w-[230px] px-3 font-semibold text-[11px] text-[var(--ds-text-tertiary)] uppercase tracking-wider">
                  <SortableHeader
                    label="Entité"
                    field="entity"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/contacts", params, next)}
                  />
                </TableHead>
                <TableHead className="h-9 w-[290px] px-3 font-semibold text-[11px] text-[var(--ds-text-tertiary)] uppercase tracking-wider">
                  <SortableHeader
                    label="E-mail"
                    field="email"
                    current={sortState}
                    buildHref={(next) => buildSortHref("/crm/contacts", params, next)}
                  />
                </TableHead>
                <TableHead className="h-9 w-[170px] px-3 font-semibold text-[11px] text-[var(--ds-text-tertiary)] uppercase tracking-wider">
                  Téléphone
                </TableHead>
                <TableHead className="h-9 w-10 px-2" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const fullName = `${row.firstName} ${row.lastName}`.trim();
                return (
                  <TableRow
                    key={row.id}
                    className="group border-border/70 border-b transition-colors hover:bg-[var(--ds-bg-hover)]"
                  >
                    <TableCell className="min-h-[58px] px-3 py-2.5">
                      <div className="flex items-center gap-3">
                        <HashedAvatar name={fullName} seed={row.id} size="md" title={fullName} />
                        <div className="flex min-w-0 flex-col gap-px">
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
                              placeholder=""
                            />
                          </div>
                          <ContJobTitle
                            id={row.id}
                            value={row.jobTitle}
                            className="text-[12px] text-[var(--ds-text-tertiary)]"
                            placeholder="+ Ajouter un poste"
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm">
                      <div className="inline-flex max-w-[210px] items-center gap-2 text-muted-foreground">
                        {row.entityId ? (
                          <Buildings
                            size={14}
                            weight="duotone"
                            className="flex-none text-[var(--ds-text-tertiary)]"
                          />
                        ) : null}
                        <ContEntity
                          id={row.id}
                          value={
                            row.entityId ? { id: row.entityId, name: row.entityName ?? "" } : null
                          }
                          options={entityList}
                          placeholder=""
                        />
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm">
                      <div className="inline-flex max-w-full items-center gap-2 text-muted-foreground">
                        {row.email ? (
                          <EnvelopeSimple
                            size={14}
                            weight="duotone"
                            className="flex-none text-[var(--ds-text-tertiary)]"
                          />
                        ) : null}
                        <ContEmail
                          id={row.id}
                          value={row.email}
                          className="truncate"
                          placeholder=""
                        />
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-sm">
                      <div className="inline-flex items-center gap-2 text-muted-foreground">
                        {row.phone ? (
                          <Phone
                            size={14}
                            weight="duotone"
                            className="flex-none text-[var(--ds-text-tertiary)]"
                          />
                        ) : null}
                        <ContPhone id={row.id} value={row.phone} placeholder="" />
                      </div>
                    </TableCell>
                    <TableCell className="px-2 py-2.5 text-right">
                      <Link
                        href={`/contacts/${row.id}`}
                        aria-label="Ouvrir la fiche"
                        className="inline-flex size-7 items-center justify-center rounded-md text-[var(--ds-text-tertiary)] opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100"
                      >
                        <ArrowRight size={15} weight="bold" />
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
