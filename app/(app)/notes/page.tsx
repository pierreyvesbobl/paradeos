import { EmptyState } from "@/components/empty-state";
import { Markdown } from "@/components/markdown";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { asc } from "drizzle-orm";
import { MessageCircle, Phone, StickyNote, Users } from "lucide-react";
import Link from "next/link";

type SearchParams = Promise<{
  q?: string;
  kind?: NoteKind;
  subject?: NoteSubjectType;
  author?: string;
  start?: string;
  end?: string;
}>;

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
  const conn = await db();

  const filter: NotesFilter = {
    query: params.q?.trim() || undefined,
    kind: params.kind && noteKindEnum.options.includes(params.kind) ? params.kind : undefined,
    subjectType:
      params.subject && noteSubjectTypeEnum.options.includes(params.subject)
        ? params.subject
        : undefined,
    authorId: params.author && /^[0-9a-f-]{36}$/i.test(params.author) ? params.author : undefined,
    start: parseDate(params.start),
    end: parseDate(params.end),
    limit: 200,
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
          name="kind"
          defaultValue={params.kind ?? ""}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Type — tous</option>
          {noteKindEnum.options.map((opt) => (
            <option key={opt} value={opt}>
              {noteKindLabels[opt]}
            </option>
          ))}
        </select>

        <select
          name="subject"
          defaultValue={params.subject ?? ""}
          className="h-9 rounded-md border bg-background px-2 text-sm"
        >
          <option value="">Sujet — tous</option>
          {noteSubjectTypeEnum.options.map((opt) => (
            <option key={opt} value={opt}>
              {noteSubjectTypeLabels[opt]}
            </option>
          ))}
        </select>

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

        <div className="flex gap-2 lg:col-span-1">
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
        <EmptyState
          icon={StickyNote}
          title="Aucune note pour ce filtre."
          description="Les notes se créent depuis chaque fiche (projet, contact, opportunité, tâche)."
        />
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
              <li key={note.id} className="rounded-lg border bg-card p-4">
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
                </div>
                <div className="mt-2">
                  <Markdown content={note.content} resolver={mdResolver} />
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
