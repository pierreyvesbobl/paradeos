import { Breadcrumbs } from "@/components/breadcrumbs";
import { LinkPicker } from "@/components/emails/link-picker";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { contacts as contactsTable } from "@/db/schema/contacts";
import { entities as entitiesTable } from "@/db/schema/entities";
import { projects as projectsTable } from "@/db/schema/projects";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { formatDate } from "@/lib/format";
import { getThreadDetail } from "@/lib/gmail/queries";
import { asc } from "drizzle-orm";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

type Params = Promise<{ threadId: string }>;

const SOURCE_LABEL: Record<string, string> = {
  auto_contact: "Auto · contact",
  auto_llm: "Auto · LLM",
  manual: "Manuel",
};

const LINK_KIND_LABEL: Record<string, string> = {
  project: "Projet",
  contact: "Contact",
  entity: "Entité",
};

function linkKindHref(linkKind: "project" | "contact" | "entity", id: string): string {
  if (linkKind === "project") return `/projets/${id}`;
  if (linkKind === "contact") return `/contacts/${id}`;
  return `/entites/${id}`;
}

export default async function ThreadDetailPage({ params }: { params: Params }) {
  const { threadId } = await params;
  await requireUser();
  const detail = await getThreadDetail(threadId);
  if (!detail) notFound();

  // Options pour le picker. Limité à ~200 pour l'autocomplete.
  const conn = await db();
  const [projectOpts, contactOpts, entityOpts] = await Promise.all([
    conn
      .select({ id: projectsTable.id, name: projectsTable.name })
      .from(projectsTable)
      .orderBy(asc(projectsTable.name))
      .limit(500),
    conn
      .select({
        id: contactsTable.id,
        firstName: contactsTable.firstName,
        lastName: contactsTable.lastName,
        email: contactsTable.email,
      })
      .from(contactsTable)
      .orderBy(asc(contactsTable.lastName), asc(contactsTable.firstName))
      .limit(500),
    conn
      .select({ id: entitiesTable.id, name: entitiesTable.name })
      .from(entitiesTable)
      .orderBy(asc(entitiesTable.name))
      .limit(500),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={
          <Breadcrumbs
            items={[
              { label: "Emails", href: "/emails" },
              { label: detail.thread.subject || "(sans objet)" },
            ]}
          />
        }
        title={detail.thread.subject || "(sans objet)"}
        actions={
          <a
            href={`https://mail.google.com/mail/u/0/#inbox/${detail.thread.gmailThreadId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            Ouvrir sur Gmail
            <ExternalLink className="size-3" />
          </a>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        {/* Liste des messages */}
        <section className="space-y-3">
          {detail.messages.map((m) => (
            <article key={m.id} className="space-y-2 rounded-md border bg-card p-4">
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="font-medium text-sm">
                    {m.fromName ? `${m.fromName} ` : ""}
                    <span className="text-muted-foreground">
                      {m.fromEmail ? `<${m.fromEmail}>` : ""}
                    </span>
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    À : {m.toEmails.join(", ") || "—"}
                    {m.ccEmails.length > 0 ? ` · Cc : ${m.ccEmails.join(", ")}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {m.isDraft ? (
                    <Badge variant="outline" className="text-[10px]">
                      Brouillon
                    </Badge>
                  ) : null}
                  {m.extractionStatus === "pending" ? (
                    <Badge
                      variant="outline"
                      className="border-amber-300 bg-amber-50 text-[10px] text-amber-800"
                    >
                      Extraction en attente
                    </Badge>
                  ) : m.extractionStatus === "extracted" ? (
                    <Badge variant="outline" className="text-[10px]">
                      Extrait
                    </Badge>
                  ) : null}
                  {m.internalDate ? <span>{formatDate(m.internalDate.toISOString())}</span> : null}
                </div>
              </header>

              {m.bodyText ? (
                <pre className="whitespace-pre-wrap break-words text-sm text-foreground/90">
                  {m.bodyText}
                </pre>
              ) : m.bodyHtml ? (
                <iframe
                  // body_html déjà fourni par Gmail — sandbox empêche le JS
                  // et la nav. On l'affiche tel quel, c'est ce que voit
                  // l'utilisateur dans Gmail.
                  title={`Message ${m.gmailMessageId}`}
                  sandbox=""
                  srcDoc={m.bodyHtml}
                  className="h-64 w-full rounded border bg-background"
                />
              ) : (
                <p className="text-muted-foreground text-xs italic">
                  Body non stocké localement — clique sur "Ouvrir sur Gmail" pour le voir.
                  {m.snippet ? ` Aperçu : « ${m.snippet} »` : ""}
                </p>
              )}
            </article>
          ))}
        </section>

        {/* Side panel : liens */}
        <aside className="space-y-3">
          <section className="space-y-2 rounded-md border bg-card p-4">
            <h3 className="font-medium text-sm">Liens</h3>
            {detail.links.length === 0 ? (
              <p className="text-muted-foreground text-xs italic">Aucun lien.</p>
            ) : (
              <ul className="space-y-1.5">
                {detail.links.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 text-xs">
                    <Link
                      href={linkKindHref(l.linkKind, l.linkId)}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      <span className="text-muted-foreground">{LINK_KIND_LABEL[l.linkKind]} ·</span>{" "}
                      {l.label ?? l.linkId.slice(0, 8)}
                    </Link>
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {SOURCE_LABEL[l.source] ?? l.source}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
            <LinkPicker
              threadId={threadId}
              existingLinks={detail.links.map((l) => ({
                linkKind: l.linkKind,
                linkId: l.linkId,
              }))}
              projects={projectOpts}
              contacts={contactOpts.map((c) => ({
                id: c.id,
                label: `${c.firstName} ${c.lastName}${c.email ? ` · ${c.email}` : ""}`,
              }))}
              entities={entityOpts}
            />
          </section>

          <section className="space-y-2 rounded-md border bg-card p-4">
            <h3 className="font-medium text-sm">Participants</h3>
            <ul className="space-y-0.5 text-muted-foreground text-xs">
              {Array.isArray(detail.thread.participants)
                ? (detail.thread.participants as Array<{ email: string; name?: string }>).map(
                    (p) => (
                      <li key={p.email}>
                        {p.name ? `${p.name} ` : ""}
                        <span className="font-mono text-[10px]">{p.email}</span>
                      </li>
                    ),
                  )
                : null}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
