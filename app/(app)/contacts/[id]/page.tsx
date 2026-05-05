import { DeleteButton } from "@/components/delete-button";
import { NoteList } from "@/components/notes/note-list";
import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { deleteContactAndRedirect } from "@/lib/actions/contacts";
import { buildMarkdownResolver } from "@/lib/db/queries/mention-resolver";
import { getAttachmentsForNotes, getNotesForSubject } from "@/lib/db/queries/notes";
import { db } from "@/lib/db/server";
import { asc, eq } from "drizzle-orm";
import { ExternalLink, Mail, Phone } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ContEmail,
  ContEntity,
  ContFirstName,
  ContJobTitle,
  ContLastName,
  ContLinkedin,
  ContNotes,
  ContPhone,
} from "./inline-fields";

type Params = Promise<{ id: string }>;

export default async function ContactDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();

  const [row] = await conn
    .select({
      contact: contacts,
      entity: entities,
    })
    .from(contacts)
    .leftJoin(entities, eq(contacts.entityId, entities.id))
    .where(eq(contacts.id, id))
    .limit(1);

  if (!row) notFound();
  const { contact, entity } = row;
  const entityList = await conn
    .select({ id: entities.id, name: entities.name })
    .from(entities)
    .orderBy(asc(entities.name));
  const notesList = await getNotesForSubject("contact", id);
  const attachmentRows = await getAttachmentsForNotes(notesList.map((n) => n.id));
  const attachmentsByNote: Record<string, typeof attachmentRows> = {};
  for (const a of attachmentRows) {
    if (!attachmentsByNote[a.noteId]) attachmentsByNote[a.noteId] = [];
    attachmentsByNote[a.noteId]?.push(a);
  }
  const mdResolver = await buildMarkdownResolver();

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={entity ? entity.name : "Contact"}
        title={
          <span className="inline-flex flex-wrap items-center gap-x-2">
            <ContFirstName
              id={id}
              value={contact.firstName}
              className="font-semibold text-2xl tracking-tight"
            />
            <ContLastName
              id={id}
              value={contact.lastName}
              className="font-semibold text-2xl tracking-tight"
            />
          </span>
        }
        description={
          <ContJobTitle
            id={id}
            value={contact.jobTitle}
            className="text-muted-foreground text-sm"
          />
        }
        actions={
          <DeleteButton
            action={deleteContactAndRedirect}
            id={id}
            label="Supprimer"
            confirmTitle={`Supprimer "${contact.firstName} ${contact.lastName}" ?`}
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 rounded-lg border bg-card p-6 lg:col-span-2">
          <h2 className="font-medium text-sm">Coordonnées</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                <span className="inline-flex items-center gap-1">
                  <Mail className="size-3" /> E-mail
                </span>
              </dt>
              <dd className="mt-1 text-sm">
                <ContEmail id={id} value={contact.email} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                <span className="inline-flex items-center gap-1">
                  <Phone className="size-3" /> Téléphone
                </span>
              </dt>
              <dd className="mt-1 text-sm">
                <ContPhone id={id} value={contact.phone} />
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">
                <span className="inline-flex items-center gap-1">
                  <ExternalLink className="size-3" /> LinkedIn
                </span>
              </dt>
              <dd className="mt-1 text-sm">
                <ContLinkedin id={id} value={contact.linkedinUrl} />
              </dd>
            </div>
          </dl>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Notes</p>
            <div className="mt-1">
              <ContNotes id={id} value={contact.notes} />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-6">
          <h2 className="font-medium text-sm">Entité</h2>
          <ContEntity
            id={id}
            value={entity ? { id: entity.id, name: entity.name } : null}
            options={entityList}
          />
          {entity ? (
            <Link
              href={`/entites/${entity.id}`}
              className="inline-flex items-center gap-1 text-muted-foreground text-xs hover:underline"
            >
              Voir la fiche <ExternalLink className="size-3" />
            </Link>
          ) : null}
        </section>
      </div>

      <NoteList
        subjectType="contact"
        subjectId={id}
        notes={notesList}
        resolver={mdResolver}
        attachmentsByNote={attachmentsByNote}
      />
    </div>
  );
}
