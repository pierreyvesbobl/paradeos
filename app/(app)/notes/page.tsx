import { EmptyState } from "@/components/empty-state";
import { DeleteNoteButton } from "@/components/notes/delete-note-button";
import { InlineNoteEditor } from "@/components/notes/inline-note-editor";
import { PageHeader } from "@/components/page-header";
import { FilterRow } from "@/components/table/filter-row";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PersistViewParams } from "@/components/view-prefs/persist-view-params";
import { users as usersTable } from "@/db/schema/users";
import { buildMarkdownResolver } from "@/lib/db/queries/mention-resolver";
import { type NotesFilter, getRecentNotes } from "@/lib/db/queries/notes";
import { db } from "@/lib/db/server";
import { formatDateTime } from "@/lib/format";
import {
  type NoteKind,
  type NoteSubjectType,
  noteKindEnum,
  noteKindLabels,
  noteSubjectTypeEnum,
  noteSubjectTypeLabels,
} from "@/lib/schemas/notes";
import { applyViewPrefRedirect } from "@/lib/view-prefs/apply";
import { asc } from "drizzle-orm";
import { ArrowDown, ArrowUp, MessageCircle, Phone, StickyNote, Users } from "lucide-react";
import Link from "next/link";

type SearchParams = Promise<{
  q?: string;
  kind?: NoteKind;
  subject?: NoteSubjectType;
  author?: string;
  start?: string;
  end?: string;
  sort?: "asc" | "desc";
}>;

const PERSISTED_KEYS = ["q", "kind", "subject", "author", "start", "end", "sort"] as const;

function buildHref(params: {
  q?: string;
  kind?: NoteKind | "all";
  subject?: NoteSubjectType | "all";
  author?: string;
  start?: string;
  end?: string;
  sort?: "asc" | "desc";
}): string {
  const sp = new URLSearchParams();
  if (params.q) sp.set("q", params.q);
  if (params.kind && params.kind !== "all") sp.set("kind", params.kind);
  if (params.subject && params.subject !== "all") sp.set("subject", params.subject);
  if (params.author) sp.set("author", params.author);
  if (params.start) sp.set("start", params.start);
  if (params.end) sp.set("end", params.end);
  if (params.sort) sp.set("sort", params.sort);
  const qs = sp.toString();
  return qs ? `/notes?${qs}` : "/notes";
}

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

const SUBJECT_PATH: Record<string, (id: string) => string> = {
  entity: (id) => `/entites/${id}`,
  contact: (id) => `/contacts/${id}`,
  opportunity: (id) => `/opportunites/${id}`,
  project: (id) => `/projets/${id}`,
  task: (id) => `/taches/${id}`,
};

function parseDate(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export default async function NotesPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  await applyViewPrefRedirect({
    pageKey: "notes",
    pathname: "/notes",
    searchParams: params,
    relevantKeys: PERSISTED_KEYS,
  });
  const conn = await db();

  const sortDir: "asc" | "desc" = params.sort === "asc" ? "asc" : "desc";
  const activeKind =
    params.kind && noteKindEnum.options.includes(params.kind) ? params.kind : undefined;
  const activeSubject =
    params.subject && noteSubjectTypeEnum.options.includes(params.subject)
      ? params.subject
      : undefined;

  const filter: NotesFilter = {
    query: params.q?.trim() || undefined,
    kind: activeKind,
    subjectType: activeSubject,
    authorId: params.author && /^[0-9a-f-]{36}$/i.test(params.author) ? params.author : undefined,
    start: parseDate(params.start),
    end: parseDate(params.end),
    limit: 200,
    order: sortDir,
  };

  const [notes, authors, mdResolver] = await Promise.all([
    getRecentNotes(filter),
    conn
      .select({ id: usersTable.id, fullName: usersTable.fullName })
      .from(usersTable)
      .orderBy(asc(usersTable.fullName)),
    buildMarkdownResolver(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Référentiel"
        title="Notes"
        description="Compte-rendus, mémos, points de contact — toute l'historique chronologique."
      />
      <PersistViewParams pageKey="notes" relevantKeys={PERSISTED_KEYS} />

      <div className="space-y-3">
        <FilterRow
          label="Type"
          items={[
            { value: undefined, label: "Tous", active: !activeKind },
            ...noteKindEnum.options.map((opt) => ({
              value: opt as string,
              label: noteKindLabels[opt],
              active: activeKind === opt,
            })),
          ]}
          buildHref={(value) =>
            buildHref({
              q: params.q,
              kind: value as NoteKind | "all" | undefined,
              subject: activeSubject,
              author: params.author,
              start: params.start,
              end: params.end,
              sort: sortDir === "desc" ? undefined : sortDir,
            })
          }
        />
        <FilterRow
          label="Sujet"
          items={[
            { value: undefined, label: "Tous", active: !activeSubject },
            ...noteSubjectTypeEnum.options.map((opt) => ({
              value: opt as string,
              label: noteSubjectTypeLabels[opt],
              active: activeSubject === opt,
            })),
          ]}
          buildHref={(value) =>
            buildHref({
              q: params.q,
              kind: activeKind,
              subject: value as NoteSubjectType | "all" | undefined,
              author: params.author,
              start: params.start,
              end: params.end,
              sort: sortDir === "desc" ? undefined : sortDir,
            })
          }
        />
      </div>

      <form
        method="get"
        className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        <Input
          name="q"
          defaultValue={params.q ?? ""}
          placeholder="Rechercher dans le contenu…"
          className="h-9 lg:col-span-2"
        />

        <select
          name="author"
          defaultValue={params.author ?? ""}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Auteur — tous</option>
          {authors.map((a) => (
            <option key={a.id} value={a.id}>
              {a.fullName ?? "(sans nom)"}
            </option>
          ))}
        </select>

        <div className="flex gap-2 lg:col-span-2">
          <Input
            name="start"
            type="date"
            defaultValue={params.start ?? ""}
            className="h-9"
            aria-label="Du"
          />
          <Input
            name="end"
            type="date"
            defaultValue={params.end ?? ""}
            className="h-9"
            aria-label="Au"
          />
        </div>

        <Link
          href={buildHref({
            q: params.q,
            kind: activeKind,
            subject: activeSubject,
            author: params.author,
            start: params.start,
            end: params.end,
            sort: sortDir === "desc" ? "asc" : undefined,
          })}
          className="inline-flex h-9 items-center justify-center gap-1 rounded-md border px-3 text-sm hover:bg-muted"
          title="Inverser le tri par date"
        >
          {sortDir === "desc" ? (
            <ArrowDown className="size-3.5" />
          ) : (
            <ArrowUp className="size-3.5" />
          )}
          {sortDir === "desc" ? "Plus récent" : "Plus ancien"}
        </Link>

        {/* Inputs cachés : conserve les filtres chip à la soumission */}
        {activeKind ? <input type="hidden" name="kind" value={activeKind} /> : null}
        {activeSubject ? <input type="hidden" name="subject" value={activeSubject} /> : null}
        {sortDir !== "desc" ? <input type="hidden" name="sort" value={sortDir} /> : null}

        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-6">
          <button
            type="submit"
            className="h-9 rounded-md bg-foreground px-3 text-background text-sm"
          >
            Filtrer
          </button>
          <Link href="/notes" className="text-muted-foreground text-sm hover:underline">
            Réinitialiser
          </Link>
          <span className="ml-auto text-muted-foreground text-xs">
            {notes.length} résultat{notes.length > 1 ? "s" : ""}
          </span>
        </div>
      </form>

      {notes.length === 0 ? (
        (() => {
          const hasFilter = Boolean(
            filter.query ||
              filter.kind ||
              filter.subjectType ||
              filter.authorId ||
              filter.start ||
              filter.end,
          );
          return (
            <EmptyState
              icon={StickyNote}
              title={hasFilter ? "Aucune note pour ce filtre." : "Pas encore de note."}
              description={
                hasFilter
                  ? "Réinitialise les filtres ou ajuste les dates pour élargir la recherche."
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
          {notes.map((note) => {
            const Icon = KIND_ICON[note.kind];
            const colorClass = KIND_COLOR[note.kind];
            const subjectHref =
              note.subjectType && note.subjectId
                ? SUBJECT_PATH[note.subjectType]?.(note.subjectId)
                : null;
            return (
              <li key={note.id} className="group rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Icon className={`size-4 ${colorClass}`} />
                  <span className={`font-medium text-xs uppercase tracking-wide ${colorClass}`}>
                    {noteKindLabels[note.kind]}
                  </span>
                  {note.title ? <span className="font-medium text-sm">{note.title}</span> : null}
                  {note.subjectType ? (
                    subjectHref ? (
                      <Link href={subjectHref}>
                        <Badge variant="outline">{noteSubjectTypeLabels[note.subjectType]}</Badge>
                      </Link>
                    ) : (
                      <Badge variant="outline">{noteSubjectTypeLabels[note.subjectType]}</Badge>
                    )
                  ) : null}
                  <span className="ml-auto text-muted-foreground text-xs">
                    {formatDateTime(note.occurredAt)}
                  </span>
                  <DeleteNoteButton
                    noteId={note.id}
                    label={note.title ?? note.content.slice(0, 60)}
                  />
                </div>
                <div className="mt-2">
                  <InlineNoteEditor
                    note={{
                      id: note.id,
                      title: note.title,
                      content: note.content,
                      kind: note.kind,
                      occurredAt: note.occurredAt,
                      subjectType: note.subjectType,
                      subjectId: note.subjectId,
                    }}
                    resolver={mdResolver}
                  />
                </div>
                {note.authorName ? (
                  <p className="mt-2 text-muted-foreground text-xs">— {note.authorName}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
