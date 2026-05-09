import { EmptyState } from "@/components/empty-state";
import { NoteCard } from "@/components/notes/note-card";
import { NoteSortMenu } from "@/components/notes/note-sort-menu";
import { SubjectPill } from "@/components/notes/subject-pill";
import { PageHeader } from "@/components/page-header";
import { NotionFilters } from "@/components/table/notion-filters";
import { parseSort } from "@/components/table/sortable-header";
import { Input } from "@/components/ui/input";
import { PersistViewParams } from "@/components/view-prefs/persist-view-params";
import { notes as notesTable } from "@/db/schema/notes";
import { users as usersTable } from "@/db/schema/users";
import { type NoteSortField, getAttachmentsForNotes, getRecentNotes } from "@/lib/db/queries/notes";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import { buildSortHref, collectF } from "@/lib/filters/url-helpers";
import { NOTE_SORT_OPTIONS } from "@/lib/notes/sort-options";
import {
  noteKindEnum,
  noteKindLabels,
  noteSubjectTypeEnum,
  noteSubjectTypeLabels,
} from "@/lib/schemas/notes";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { asc } from "drizzle-orm";
import { StickyNote } from "lucide-react";
import Link from "next/link";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PERSISTED_KEYS = ["q", "f", "sort"] as const;

const SORT_FIELDS: readonly NoteSortField[] = ["occurredAt", "subject", "kind", "author"] as const;

export default async function NotesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await applyViewPrefRedirect({
    pageKey: "notes",
    pathname: "/notes",
    searchParams: params,
    relevantKeys: PERSISTED_KEYS,
  });

  const query = typeof params.q === "string" ? params.q.trim() : "";
  const sortRaw = typeof params.sort === "string" ? params.sort : undefined;
  const sortState = parseSort(sortRaw, SORT_FIELDS);
  const sortField = (sortState?.field as NoteSortField | undefined) ?? "occurredAt";
  const sortDir = sortState?.dir ?? "desc";

  const conn = await db();
  const authors = await conn
    .select({ id: usersTable.id, fullName: usersTable.fullName })
    .from(usersTable)
    .orderBy(asc(usersTable.fullName));

  const FILTER_DEFS = [
    {
      key: "kind",
      label: "Type",
      type: "enum" as const,
      options: noteKindEnum.options.map((k) => ({ value: k, label: noteKindLabels[k] })),
    },
    {
      key: "subjectType",
      label: "Lié à",
      type: "enum" as const,
      options: noteSubjectTypeEnum.options.map((s) => ({
        value: s,
        label: noteSubjectTypeLabels[s],
      })),
    },
    {
      key: "authorId",
      label: "Auteur",
      type: "enum" as const,
      options: authors.map((a) => ({ value: a.id, label: a.fullName ?? "(sans nom)" })),
    },
    { key: "occurredAt", label: "Date", type: "date" as const },
  ];

  const filters = parseFiltersFromSearchParams(
    params,
    FILTER_DEFS.map((d) => d.key),
  );
  const filterColumns = [
    { key: "kind", column: notesTable.kind, kind: "enum" as const },
    { key: "subjectType", column: notesTable.subjectType, kind: "enum" as const },
    { key: "authorId", column: notesTable.authorId, kind: "enum" as const },
    { key: "occurredAt", column: notesTable.occurredAt, kind: "date" as const },
  ];
  const filterConditions = applyFilters(filters, filterColumns);

  const notesList = await getRecentNotes({
    conditions: filterConditions,
    query: query || undefined,
    limit: 200,
    sortField,
    sortDir,
  });

  const attachmentRows = await getAttachmentsForNotes(notesList.map((n) => n.id));
  const attachmentsByNote: Record<string, typeof attachmentRows> = {};
  for (const a of attachmentRows) {
    if (!attachmentsByNote[a.noteId]) attachmentsByNote[a.noteId] = [];
    attachmentsByNote[a.noteId]?.push(a);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Référentiel"
        title="Notes"
        description="Compte-rendus, mémos, points de contact — toute l'historique chronologique."
      />

      <NotionFilters
        pathname="/notes"
        filterDefs={FILTER_DEFS}
        activeFilters={filters.map((f) => ({ key: f.key, op: f.op, value: f.value }))}
      />
      <PersistViewParams pageKey="notes" relevantKeys={PERSISTED_KEYS} />

      <div className="flex flex-wrap items-center gap-3">
        <form className="max-w-sm flex-1">
          <Input
            name="q"
            defaultValue={query}
            placeholder="Rechercher dans le contenu…"
            className="h-9"
          />
          {collectF(params).map((f, i) => (
            <input key={`f-${i}-${f}`} type="hidden" name="f" value={f} />
          ))}
          {sortRaw ? <input type="hidden" name="sort" value={sortRaw} /> : null}
        </form>
        <NoteSortMenu
          current={{ field: sortField, dir: sortDir }}
          hrefs={Object.fromEntries(
            NOTE_SORT_OPTIONS.map((opt) => [
              `${opt.field}:${opt.dir}`,
              buildSortHref("/notes", params, { field: opt.field, dir: opt.dir }),
            ]),
          )}
        />
        <span className="text-muted-foreground text-xs">
          {notesList.length} résultat{notesList.length > 1 ? "s" : ""}
        </span>
      </div>

      {notesList.length === 0 ? (
        (() => {
          const hasFilter = Boolean(query) || filters.length > 0;
          return (
            <EmptyState
              icon={StickyNote}
              title={hasFilter ? "Aucune note pour ce filtre." : "Pas encore de note."}
              description={
                hasFilter
                  ? "Réinitialise les filtres ou ajuste la recherche pour élargir."
                  : "Les notes se créent depuis chaque fiche (projet, contact, opportunité, tâche)."
              }
              action={
                hasFilter ? (
                  <Link href="/notes" className="text-muted-foreground text-sm hover:underline">
                    Réinitialiser les filtres
                  </Link>
                ) : null
              }
            />
          );
        })()
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notesList.map((note) => {
            const subjectType =
              note.subjectType === "opportunity" ? null : (note.subjectType ?? null);
            return (
              <li key={note.id}>
                <NoteCard
                  note={note}
                  attachments={attachmentsByNote[note.id] ?? []}
                  subjectType={subjectType}
                  subjectId={note.subjectId}
                  subjectPill={
                    note.subjectType && note.subjectId && note.subjectType !== "opportunity" ? (
                      <SubjectPill
                        type={note.subjectType}
                        id={note.subjectId}
                        label={note.subjectLabel}
                      />
                    ) : null
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
