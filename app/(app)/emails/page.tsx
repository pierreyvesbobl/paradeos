import { type Bucket, EmailsListPane, type InvoiceDir } from "@/components/emails/emails-list-pane";
import { EmailThreadDetail } from "@/components/emails/thread-detail";
import { ThreadDetailSkeleton } from "@/components/emails/thread-detail-skeleton";
import { requireUser } from "@/lib/auth/server";
import {
  countBuckets,
  countInvoiceDirections,
  getInvoiceDirectionsForThreads,
  getProjectsForThreads,
  listThreads,
} from "@/lib/gmail/queries";
import { EnvelopeOpen } from "@phosphor-icons/react/dist/ssr";
import { Suspense } from "react";

// Split-view : la liste et le détail changent à chaque paramètre — pas de
// cache statique. `bucket` et `thread` viennent des searchParams.
export const dynamic = "force-dynamic";

type SearchParams = Promise<{
  q?: string | string[];
  filter?: string | string[];
  bucket?: string | string[];
  dir?: string | string[];
  tag?: string | string[];
  thread?: string | string[];
}>;

const BUCKETS: readonly Bucket[] = ["important", "invoices", "noise", "all"];
const INVOICE_DIRS: readonly InvoiceDir[] = ["all", "purchase", "sale"];

export default async function EmailsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const tagId = typeof params.tag === "string" ? params.tag : undefined;
  const activeThreadId = typeof params.thread === "string" ? params.thread : null;
  const rawBucket = typeof params.bucket === "string" ? params.bucket : "important";
  const bucket: Bucket = BUCKETS.includes(rawBucket as Bucket)
    ? (rawBucket as Bucket)
    : "important";
  const rawDir = typeof params.dir === "string" ? params.dir : "all";
  // Le sous-filtre achat/vente n'a de sens que dans le bucket facturation.
  const direction: InvoiceDir =
    bucket === "invoices" && INVOICE_DIRS.includes(rawDir as InvoiceDir)
      ? (rawDir as InvoiceDir)
      : "all";

  const [threads, counts, directionCounts] = await Promise.all([
    listThreads(
      user.id,
      {
        query: q || undefined,
        tagId,
        bucket: bucket === "all" ? undefined : bucket,
        invoiceDirection: direction === "all" ? undefined : direction,
      },
      { limit: 200 },
    ),
    countBuckets(user.id),
    countInvoiceDirections(user.id),
  ]);

  const threadIds = threads.map((t) => t.id);
  const [projectsByThread, invoiceDirectionsByThread] = await Promise.all([
    getProjectsForThreads(threadIds),
    getInvoiceDirectionsForThreads(threadIds),
  ]);

  return (
    <div className="-m-6 flex h-[calc(100vh-58px)] w-full overflow-hidden">
      <EmailsListPane
        threads={threads}
        counts={counts}
        directionCounts={directionCounts}
        activeBucket={bucket}
        activeDirection={direction}
        activeThreadId={activeThreadId}
        projectsByThread={projectsByThread}
        invoiceDirectionsByThread={invoiceDirectionsByThread}
        query={q}
      />
      <div className="min-w-0 flex-1 overflow-y-auto" style={{ background: "var(--ds-bg-app)" }}>
        {activeThreadId ? (
          // La `key` force React à démonter/remonter le Suspense boundary
          // à chaque changement de thread → le skeleton s'affiche pendant
          // que le nouveau détail streame côté serveur, la liste reste
          // stable pendant ce temps.
          <Suspense key={activeThreadId} fallback={<ThreadDetailSkeleton />}>
            <EmailThreadDetail threadId={activeThreadId} />
          </Suspense>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center text-[var(--ds-text-tertiary)]">
            <EnvelopeOpen size={48} weight="duotone" />
            <p className="text-[14px]">Sélectionne un mail dans la liste.</p>
            <p className="text-[12px]">Le triage IA s'affichera ici.</p>
          </div>
        )}
      </div>
    </div>
  );
}
