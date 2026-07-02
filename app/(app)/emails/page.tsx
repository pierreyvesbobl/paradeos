import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SearchInputWithClear } from "@/components/ui/search-input";
import { requireUser } from "@/lib/auth/server";
import { formatDate } from "@/lib/format";
import { countBuckets, listThreads } from "@/lib/gmail/queries";
import { Inbox, Mail, Receipt, Sparkles, Tag, VolumeX } from "lucide-react";
import Link from "next/link";

// Buckets sont dérivés des searchParams — dynamic force le re-render à
// chaque changement d'onglet (Next 15 ne re-fetche pas sinon car le
// pathname reste identique et il considère la page cacheable).
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  q?: string | string[];
  filter?: string | string[];
  bucket?: string | string[];
  tag?: string | string[];
}>;

type Bucket = "important" | "invoices" | "noise" | "all";

const BUCKET_META: Record<Bucket, { label: string; icon: typeof Mail; description: string }> = {
  important: {
    label: "À traiter",
    icon: Sparkles,
    description:
      "Threads liés à un projet ou une opportunité qui appellent une tâche ou une réponse.",
  },
  invoices: {
    label: "Facturation",
    icon: Receipt,
    description: "Factures d'achat classées ou emails marqués compta.",
  },
  noise: {
    label: "Bruits",
    icon: VolumeX,
    description: "Notifications, newsletters, admin — masqué par défaut.",
  },
  all: {
    label: "Tous",
    icon: Mail,
    description: "Tous les threads Gmail synchronisés.",
  },
};

export default async function EmailsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const tagId = typeof params.tag === "string" ? params.tag : undefined;
  const rawBucket = typeof params.bucket === "string" ? params.bucket : "important";
  const bucket: Bucket = (["important", "invoices", "noise", "all"] as const).includes(
    rawBucket as Bucket,
  )
    ? (rawBucket as Bucket)
    : "important";

  const [threads, counts] = await Promise.all([
    listThreads(
      user.id,
      {
        query: q || undefined,
        tagId,
        bucket: bucket === "all" ? undefined : bucket,
      },
      { limit: 100 },
    ),
    countBuckets(user.id),
  ]);

  const meta = BUCKET_META[bucket];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Emails"
        description={meta.description}
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

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(["important", "invoices", "noise", "all"] as const).map((b) => {
            const sp = new URLSearchParams();
            if (q) sp.set("q", q);
            if (b !== "important") sp.set("bucket", b);
            if (tagId) sp.set("tag", tagId);
            const href = `/emails${sp.toString() ? `?${sp.toString()}` : ""}`;
            const m = BUCKET_META[b];
            const Icon = m.icon;
            const count =
              b === "important"
                ? counts.important
                : b === "invoices"
                  ? counts.invoices
                  : b === "noise"
                    ? counts.noise
                    : counts.total;
            const isActive = bucket === b;
            const activeStyle = isActive
              ? "bg-primary text-primary-foreground shadow hover:bg-primary/90"
              : "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground";
            const badgeStyle = isActive
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-muted text-foreground";
            return (
              <Link
                key={b}
                href={href}
                className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md px-3 font-medium text-xs transition-colors ${activeStyle}`}
              >
                <Icon className="size-3.5" />
                <span>{m.label}</span>
                <span
                  className={`ml-0.5 inline-flex h-4 items-center rounded px-1 text-[10px] font-semibold ${badgeStyle}`}
                >
                  {count}
                </span>
              </Link>
            );
          })}
        </div>
        <form method="GET">
          <SearchInputWithClear
            name="q"
            defaultValue={q}
            placeholder="Rechercher dans le sujet ou le snippet…"
          />
          {bucket !== "important" ? <input type="hidden" name="bucket" value={bucket} /> : null}
          {tagId ? <input type="hidden" name="tag" value={tagId} /> : null}
        </form>
      </div>

      {threads.length === 0 ? (
        <EmptyState
          icon={meta.icon}
          title={q ? "Aucun résultat" : `Aucun thread dans « ${meta.label} »`}
          description={
            q
              ? "Aucun thread ne matche ta recherche."
              : bucket === "important"
                ? "Tout est traité — passe à Facturation ou Bruits pour voir le reste."
                : bucket === "invoices"
                  ? "Aucune facture détectée sur cette période."
                  : bucket === "noise"
                    ? "Rien à masquer — tes threads sont tous liés à quelque chose d'actif."
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
