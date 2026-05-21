import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInputWithClear } from "@/components/ui/search-input";
import { requireUser } from "@/lib/auth/server";
import { formatDate } from "@/lib/format";
import { listThreads } from "@/lib/gmail/queries";
import { Inbox, Mail, Tag } from "lucide-react";
import Link from "next/link";

type SearchParams = Promise<{
  q?: string | string[];
  filter?: string | string[];
  tag?: string | string[];
}>;

export default async function EmailsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const filter = typeof params.filter === "string" ? params.filter : "all";
  const tagId = typeof params.tag === "string" ? params.tag : undefined;

  const threads = await listThreads(
    user.id,
    {
      query: q || undefined,
      taggedOnly: filter === "tagged",
      untaggedOnly: filter === "untagged",
      tagId,
    },
    { limit: 100 },
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emails"
        description="Threads Gmail synchronisés, tagués automatiquement (contact/entité/projet) et manuellement (catégories)."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/emails/propositions">
                <Inbox className="size-3.5" />
                Propositions LLM
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/emails/tags">
                <Tag className="size-3.5" />
                Gérer les tags
              </Link>
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <form className="min-w-64 flex-1" method="GET">
          <SearchInputWithClear
            name="q"
            defaultValue={q}
            placeholder="Rechercher dans le sujet ou le snippet…"
          />
          {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
          {tagId ? <input type="hidden" name="tag" value={tagId} /> : null}
        </form>
        <div className="flex items-center gap-1">
          {(["all", "tagged", "untagged"] as const).map((f) => {
            const sp = new URLSearchParams();
            if (q) sp.set("q", q);
            if (f !== "all") sp.set("filter", f);
            if (tagId) sp.set("tag", tagId);
            const href = `/emails${sp.toString() ? `?${sp.toString()}` : ""}`;
            const label = f === "all" ? "Tous" : f === "tagged" ? "Tagués" : "Non tagués";
            return (
              <Button
                key={f}
                asChild
                size="sm"
                variant={filter === f ? "default" : "outline"}
                className="h-8"
              >
                <Link href={href}>{label}</Link>
              </Button>
            );
          })}
        </div>
      </div>

      {threads.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={q ? "Aucun résultat" : "Aucun thread Gmail"}
          description={
            q
              ? "Aucun thread ne matche ta recherche."
              : "Active Gmail dans les réglages puis lance une sync pour voir tes threads ici."
          }
        />
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {threads.map((t) => {
            const participants = Array.isArray(t.participants)
              ? (t.participants as Array<{ email: string; name?: string }>)
              : [];
            const preview = participants
              .slice(0, 3)
              .map((p) => p.name || p.email)
              .join(", ");
            return (
              <li key={t.id} className="px-3 py-2.5 hover:bg-muted/40">
                <Link href={`/emails/${t.id}`} className="block space-y-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={`min-w-0 flex-1 truncate text-sm ${t.hasUnread ? "font-semibold" : "font-medium"}`}
                    >
                      {t.subject || "(sans objet)"}
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5 text-muted-foreground text-xs">
                      {t.messageCount > 1 ? (
                        <Badge variant="outline" className="text-[10px]">
                          {t.messageCount}
                        </Badge>
                      ) : null}
                      {t.lastMessageAt ? (
                        <span>{formatDate(t.lastMessageAt.toISOString())}</span>
                      ) : null}
                    </div>
                  </div>
                  <p className="line-clamp-1 text-muted-foreground text-xs">
                    <span className="font-medium text-foreground/70">{preview}</span>
                    {t.snippet ? <span className="ml-2">— {t.snippet}</span> : null}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
