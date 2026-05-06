import { DeleteButton } from "@/components/delete-button";
import { EmptyState } from "@/components/empty-state";
import { NoteList } from "@/components/notes/note-list";
import { PageHeader } from "@/components/page-header";
import { contacts } from "@/db/schema/contacts";
import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { projects } from "@/db/schema/projects";
import { users } from "@/db/schema/users";
import { deleteOpportunityAndRedirect } from "@/lib/actions/opportunities";
import { buildMarkdownResolver } from "@/lib/db/queries/mention-resolver";
import { getAttachmentsForNotes, getNotesForSubject } from "@/lib/db/queries/notes";
import { getOpportunityTimeStats } from "@/lib/db/queries/time-stats";
import { db } from "@/lib/db/server";
import { formatDuration } from "@/lib/format";
import { asc, eq } from "drizzle-orm";
import { Briefcase, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ConvertButton } from "./convert-button";
import {
  OppAmount,
  OppContact,
  OppDate,
  OppEntity,
  OppNotes,
  OppOwner,
  OppProbability,
  OppSource,
  OppStatus,
  OppTitle,
} from "./inline-fields";

type Params = Promise<{ id: string }>;

export default async function OpportunityDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const conn = await db();

  const [row] = await conn
    .select({
      opp: opportunities,
      entity: entities,
      contact: contacts,
      project: projects,
      ownerId: users.id,
      ownerName: users.fullName,
      ownerAvatarUrl: users.avatarUrl,
    })
    .from(opportunities)
    .leftJoin(entities, eq(opportunities.entityId, entities.id))
    .leftJoin(contacts, eq(opportunities.contactId, contacts.id))
    .leftJoin(projects, eq(opportunities.projectId, projects.id))
    .leftJoin(users, eq(opportunities.ownerId, users.id))
    .where(eq(opportunities.id, id))
    .limit(1);

  if (!row) notFound();
  const { opp, entity, contact, project, ownerId, ownerName, ownerAvatarUrl } = row;

  const [entityList, contactList, userList, notesList] = await Promise.all([
    conn
      .select({ id: entities.id, name: entities.name })
      .from(entities)
      .orderBy(asc(entities.name)),
    conn
      .select({
        id: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        entityId: contacts.entityId,
      })
      .from(contacts)
      .orderBy(asc(contacts.lastName), asc(contacts.firstName)),
    conn
      .select({ id: users.id, fullName: users.fullName, avatarUrl: users.avatarUrl })
      .from(users)
      .orderBy(asc(users.fullName)),
    getNotesForSubject("opportunity", id),
  ]);

  const presaleTime = await getOpportunityTimeStats(id);

  // Filtre côté UI : si une entité est définie, montrer en priorité ses contacts
  // (mais on garde tous les contacts disponibles pour permettre une réaffectation).
  const visibleContacts = opp.entityId
    ? [
        ...contactList.filter((c) => c.entityId === opp.entityId),
        ...contactList.filter((c) => c.entityId !== opp.entityId),
      ]
    : contactList;

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
        eyebrow={entity ? entity.name : "Opportunité"}
        title={<OppTitle id={id} value={opp.title} />}
        actions={
          <>
            {opp.status === "won" && opp.entityId && !opp.projectId ? (
              <ConvertButton
                opportunityId={opp.id}
                suggestedName={`${entity?.name ?? "Projet"} — ${opp.title}`}
              />
            ) : null}
            <DeleteButton
              action={deleteOpportunityAndRedirect}
              id={id}
              label="Supprimer"
              confirmTitle={`Supprimer "${opp.title}" ?`}
            />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="space-y-4 rounded-lg border bg-card p-6 lg:col-span-2">
          <h2 className="font-medium text-sm">Détails</h2>
          <dl className="grid gap-4 sm:grid-cols-2">
            <Field label="Statut">
              <OppStatus id={id} value={opp.status} />
            </Field>
            <Field label="Source">
              <OppSource id={id} value={opp.source} />
            </Field>
            <Field label="Montant">
              <OppAmount id={id} value={opp.valueAmount} />
            </Field>
            <Field label="Probabilité">
              <OppProbability id={id} value={opp.probability} />
            </Field>
            <Field label="Premier contact">
              <OppDate id={id} field="firstContactDate" value={opp.firstContactDate} />
            </Field>
            <Field label="Dernier contact">
              <OppDate id={id} field="lastContactDate" value={opp.lastContactDate} />
            </Field>
            <Field label="Relance">
              <OppDate id={id} field="followUpDate" value={opp.followUpDate} />
            </Field>
            <Field label="Closing estimé">
              <OppDate id={id} field="expectedCloseDate" value={opp.expectedCloseDate} />
            </Field>
            <Field label="Lead">
              <OppOwner
                id={id}
                value={
                  ownerId
                    ? {
                        id: ownerId,
                        fullName: ownerName ?? null,
                        avatarUrl: ownerAvatarUrl ?? null,
                      }
                    : null
                }
                options={userList}
              />
            </Field>
          </dl>
          <div>
            <p className="text-muted-foreground text-xs uppercase tracking-wide">Notes</p>
            <div className="mt-1">
              <OppNotes id={id} value={opp.notes} />
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-lg border bg-card p-6">
          <div>
            <h2 className="font-medium text-sm">Entité</h2>
            <div className="mt-2">
              <OppEntity
                id={id}
                value={entity ? { id: entity.id, name: entity.name } : null}
                options={entityList}
              />
            </div>
            {entity ? (
              <Link
                href={`/entites/${entity.id}`}
                className="mt-1 inline-flex items-center gap-1 text-muted-foreground text-xs hover:underline"
              >
                Voir la fiche <ExternalLink className="size-3" />
              </Link>
            ) : null}
          </div>

          <div>
            <h2 className="font-medium text-sm">Contact principal</h2>
            <div className="mt-2">
              <OppContact
                id={id}
                value={
                  contact
                    ? { id: contact.id, firstName: contact.firstName, lastName: contact.lastName }
                    : null
                }
                options={visibleContacts}
                entityId={opp.entityId}
              />
            </div>
            {contact ? (
              <Link
                href={`/contacts/${contact.id}`}
                className="mt-1 inline-flex items-center gap-1 text-muted-foreground text-xs hover:underline"
              >
                Voir la fiche <ExternalLink className="size-3" />
              </Link>
            ) : null}
          </div>

          <div>
            <h2 className="flex items-center gap-2 font-medium text-sm">
              <Briefcase className="size-4" />
              Projet lié
            </h2>
            {project ? (
              <Link
                href={`/projets/${project.id}`}
                className="mt-2 inline-flex items-center gap-1 text-sm hover:underline"
              >
                {project.name}
                <ExternalLink className="size-3" />
              </Link>
            ) : (
              <EmptyState
                compact
                title={
                  opp.status === "won"
                    ? "Pas encore de projet — clique sur « Convertir »."
                    : "Aucun projet (l'opportunité doit être Signée)."
                }
              />
            )}
          </div>
        </section>
      </div>

      <section className="space-y-3 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-sm">Temps avant-vente</h2>
        {presaleTime.actualMinutes === 0 && presaleTime.plannedMinutes === 0 ? (
          <EmptyState
            compact
            title="Aucun créneau lié à cette opportunité."
            description={
              <>
                Depuis le{" "}
                <Link href="/planning" className="underline">
                  calendrier
                </Link>
                , crée un créneau et sélectionne cette opportunité dans le picker « Opportunité
                (avant-vente) » pour tracker le temps passé en prospection / découverte /
                proposition.
              </>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded border bg-background p-3">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Réalisé</p>
              <p className="mt-1 font-semibold text-xl tracking-tight text-emerald-600 dark:text-emerald-400">
                {formatDuration(presaleTime.actualMinutes)}
              </p>
            </div>
            <div className="rounded border bg-background p-3">
              <p className="text-muted-foreground text-xs uppercase tracking-wide">Planifié</p>
              <p className="mt-1 font-semibold text-xl tracking-tight text-primary">
                {formatDuration(presaleTime.plannedMinutes)}
              </p>
            </div>
          </div>
        )}
      </section>

      <NoteList
        subjectType="opportunity"
        subjectId={id}
        notes={notesList}
        resolver={mdResolver}
        attachmentsByNote={attachmentsByNote}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs uppercase tracking-wide">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}
