import { Breadcrumbs } from "@/components/breadcrumbs";
import { TagChip } from "@/components/emails/tag-chip";
import { TagPicker } from "@/components/emails/tag-picker";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { requireUser } from "@/lib/auth/server";
import { formatDate } from "@/lib/format";
import { getThreadDetail, listAllTags } from "@/lib/gmail/queries";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";

type Params = Promise<{ threadId: string }>;

function targetHrefFor(
  kind: "project" | "contact" | "entity" | "category",
  targetId: string | null,
): string | null {
  if (!targetId) return null;
  if (kind === "project") return `/projets/${targetId}`;
  if (kind === "contact") return `/contacts/${targetId}`;
  if (kind === "entity") return `/entites/${targetId}`;
  return null;
}

export default async function ThreadDetailPage({ params }: { params: Params }) {
  const { threadId } = await params;
  const user = await requireUser();
  const detail = await getThreadDetail(threadId);
  if (!detail) notFound();

  const allTags = await listAllTags(user.id);

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
                <pre className="whitespace-pre-wrap break-words text-foreground/90 text-sm">
                  {m.bodyText}
                </pre>
              ) : m.bodyHtml ? (
                <iframe
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

        {/* Side panel : tags */}
        <aside className="space-y-3">
          <section className="space-y-2 rounded-md border bg-card p-4">
            <h3 className="font-medium text-sm">Tags</h3>
            {detail.tags.length === 0 ? (
              <p className="text-muted-foreground text-xs italic">Aucun tag.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.map((t) => (
                  <TagChip
                    key={t.threadTagId}
                    threadId={threadId}
                    tagId={t.tagId}
                    kind={t.kind}
                    labelName={t.labelName}
                    source={t.source}
                    targetHref={targetHrefFor(t.kind, t.targetId)}
                  />
                ))}
              </div>
            )}
            <TagPicker
              threadId={threadId}
              allTags={allTags.map((t) => ({
                id: t.id,
                kind: t.kind,
                labelName: t.labelName,
              }))}
              appliedTagIds={detail.tags.map((t) => t.tagId)}
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
