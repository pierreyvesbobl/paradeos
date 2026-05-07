import { EmptyState } from "@/components/empty-state";
import { DeleteNoteButton } from "@/components/notes/delete-note-button";
import { InlineNoteEditor } from "@/components/notes/inline-note-editor";
import { NoteSortMenu } from "@/components/notes/note-sort-menu";
import { SubjectPill } from "@/components/notes/subject-pill";
import { PageHeader } from "@/components/page-header";
import { NotionFilters } from "@/components/table/notion-filters";
import { parseSort } from "@/components/table/sortable-header";
import { Input } from "@/components/ui/input";
import { PersistViewParams } from "@/components/view-prefs/persist-view-params";
import { notes as notesTable } from "@/db/schema/notes";
import { users as usersTable } from "@/db/schema/users";
import { buildMarkdownResolver } from "@/lib/db/queries/mention-resolver";
import { type NoteSortField, getRecentNotes } from "@/lib/db/queries/notes";
import { db } from "@/lib/db/server";
import { applyFilters, parseFiltersFromSearchParams } from "@/lib/filters/apply";
import { buildSortHref, collectF } from "@/lib/filters/url-helpers";
import { formatDateTime } from "@/lib/format";
import { NOTE_SORT_OPTIONS } from "@/lib/notes/sort-options";
import {
  type NoteKind,
  noteKindEnum,
  noteKindLabels,
  noteSubjectTypeEnum,
  noteSubjectTypeLabels,
} from "@/lib/schemas/notes";
import { cn } from "@/lib/utils";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { asc } from "drizzle-orm";
import { MessageCircle, Phone, StickyNote, Users } from "lucide-react";
import Link from "next/link";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PERSISTED_KEYS = ["q", "f", "sort"] as const;

const SORT_FIELDS: readonly NoteSortField[] = ["occurredAt", "subject", "kind", "author"] as const;

const KIND_ICON: Record<NoteKind, React.ComponentType<{ className?: string }>> = {
  memo: StickyNote,
  call: Phone,
  meeting: Users,
  message: MessageCircle,
};

const KIND_COLOR: Record<NoteKind, string> = {
  memo: "text-muted-foreground",
  call: "text-blue-600 dark:text-blue-400",
  meeting: "text-violet-600 dark:text-violet-400",
  message: "text-amber-600 dark:text-amber-400",
};

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

  const [notesList, mdResolver] = await Promise.all([
    getRecentNotes({
      conditions: filterConditions,
      query: query || undefined,
      limit: 200,
      sortField,
      sortDir,
    }),
    buildMarkdownResolver(),
  ]);

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
        <ul className="space-y-3">
          {notesList.map((note) => {
            const Icon = KIND_ICON[note.kind];
            const colorClass = KIND_COLOR[note.kind];
            return (
              <li
                key={note.id}
                className="group space-y-2.5 rounded-lg border bg-card p-4 transition-shadow hover:shadow-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {note.subjectType && note.subjectId && note.subjectType !== "opportunity" ? (
                    <SubjectPill
                      type={note.subjectType}
                      id={note.subjectId}
                      label={note.subjectLabel}
                    />
                  ) : null}
                  <span
                    className={cn("inline-flex items-center gap-1 text-xs", colorClass)}
                    title={noteKindLabels[note.kind]}
                  >
                    <Icon className="size-3.5" />
                    <span className="font-medium">{noteKindLabels[note.kind]}</span>
                  </span>
                  {note.authorName ? (
                    <span className="text-muted-foreground text-xs">· {note.authorName}</span>
                  ) : null}
                  <span className="ml-auto text-muted-foreground text-xs tabular-nums">
                    {formatDateTime(note.occurredAt)}
                  </span>
                  <DeleteNoteButton
                    noteId={note.id}
                    label={note.title ?? note.content.slice(0, 60)}
                  />
                </div>

                {note.title ? (
                  <h3 className="font-semibold text-base leading-snug">{note.title}</h3>
                ) : null}

                <InlineNoteEditor
                  note={{
                    id: note.id,
                    title: note.title,
                    content: note.content,
                    kind: note.kind,
                    occurredAt: note.occurredAt,
                    subjectType:
                      note.subjectType === "opportunity" ? null : (note.subjectType ?? null),
                    subjectId: note.subjectId,
                  }}
                  resolver={mdResolver}
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
