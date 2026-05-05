import { DeleteButton } from "@/components/delete-button";
import { NoteList } from "@/components/notes/note-list";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { deleteEntityAndRedirect } from "@/lib/actions/entities";
import { buildMarkdownResolver } from "@/lib/db/queries/mention-resolver";
import { getAttachmentsForNotes, getNotesForSubject } from "@/lib/db/queries/notes";
import { db } from "@/lib/db/server";
import { asc, eq } from "drizzle-orm";
import { Plus } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  EntAddressField,
  EntKind,
  EntName,
  EntNotes,
  EntSiren,
  EntVat,
  EntWebsite,
} from "./inline-fields";

type Params = Promise<{ id: string }>;

export default async function EntityDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();

  const [entity] = await conn.select().from(entities).where(eq(entities.id, id)).limit(1);

  if (!entity) notFound();
  const notesList = await getNotesForSubject("entity", id);
  const attachmentRows = await getAttachmentsForNotes(notesList.map((n) => n.id));
  const attachmentsByNote: Record<string, typeof attachmentRows> = {};
  for (const a of attachmentRows) {
    if (!attachmentsByNote[a.noteId]) attachmentsByNote[a.noteId] = [];
    attachmentsByNote[a.noteId]?.push(a);
  }
  const mdResolver = await buildMarkdownResolver();

  const linkedContacts = await conn
    .select({
      id: contacts.id,
      firstName: contacts.firstName,
      lastName: contacts.lastName,
      email: contacts.email,
      jobTitle: contacts.jobTitle,
    })
    .from(contacts)
    .where(eq(contacts.entityId, id))
    .orderBy(asc(contacts.lastName));

  const address = entity.address ?? null;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Entité"
        title={<EntName id={id} value={entity.name} />}
        description={
          <EntWebsite id={id} value={entity.website} placeholder="Ajouter un site web" />
        }
        actions={
          <DeleteButton
            action={deleteEntityAndRedirect}
            id={id}
            label="Supprimer"
            confirmTitle={`Supprimer "${entity.name}" ?`}
            confirmDescription="L'entité sera supprimée. Les contacts rattachés seront détachés (mais conservés)."
          />
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 rounded-lg border bg-card p-6 lg:col-span-2">
          <h2 className="font-medium text-sm">Identité</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Type</dt>
              <dd className="mt-1">
                <EntKind id={id} value={entity.kind} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">Site web</dt>
              <dd className="mt-1 text-sm">
                <EntWebsite id={id} value={entity.website} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">SIREN</dt>
              <dd className="mt-1 text-sm">
                <EntSiren id={id} value={entity.siren} />
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs uppercase tracking-wide">N° TVA</dt>
              <dd className="mt-1 text-sm">
                <EntVat id={id} value={entity.vatNumber} />
              </dd>
            </div>
          </dl>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Adresse</p>
            <div className="mt-1 grid gap-2 text-sm sm:grid-cols-2">
              <div className="sm:col-span-2">
                <EntAddressField id={id} field="street" current={address} placeholder="Rue" />
              </div>
              <EntAddressField
                id={id}
                field="postalCode"
                current={address}
                placeholder="Code postal"
              />
              <EntAddressField id={id} field="city" current={address} placeholder="Ville" />
              <div className="sm:col-span-2">
                <EntAddressField id={id} field="country" current={address} placeholder="Pays" />
              </div>
            </div>
          </div>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Notes</p>
            <div className="mt-1">
              <EntNotes id={id} value={entity.notes} />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-sm">Contacts ({linkedContacts.length})</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link href={`/contacts/nouveau?entityId=${id}`}>
                <Plus className="size-4" />
              </Link>
            </Button>
          </div>
          {linkedContacts.length === 0 ? (
            <p className="text-muted-foreground text-sm">Aucun contact rattaché.</p>
          ) : (
            <ul className="space-y-2">
              {linkedContacts.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/contacts/${c.id}`}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 hover:bg-muted"
                  >
                    <span className="text-sm">
                      {c.firstName} {c.lastName}
                    </span>
                    {c.jobTitle ? (
                      <span className="text-muted-foreground text-xs">{c.jobTitle}</span>
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <NoteList
        subjectType="entity"
        subjectId={id}
        notes={notesList}
        resolver={mdResolver}
        attachmentsByNote={attachmentsByNote}
      />
    </div>
  );
}
