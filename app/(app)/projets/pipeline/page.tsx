import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { entities } from "@/db/schema/entities";
import { invoices } from "@/db/schema/invoices";
import { projects } from "@/db/schema/projects";
import { db } from "@/lib/db/server";
import { COMMERCIAL_STATUSES } from "@/lib/schemas/projects";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Plus, Sparkles } from "lucide-react";
import Link from "next/link";
import { PipelineBoard, type PipelineItem } from "./pipeline-board";

export default async function PipelinePage() {
  const conn = await db();
  const rows = await conn
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      valueAmount: projects.valueAmount,
      // Source de vérité quand un devis Dougs est lié — prévaut sur valueAmount.
      dougsQuoteTotalHt: invoices.dougsTotalHt,
      dougsQuoteReference: invoices.dougsReference,
      probability: projects.probability,
      followUpDate: projects.followUpDate,
      entityName: entities.name,
    })
    .from(projects)
    .leftJoin(entities, eq(projects.entityId, entities.id))
    .leftJoin(invoices, and(eq(invoices.projectId, projects.id), eq(invoices.kind, "quote")))
    .where(inArray(projects.status, COMMERCIAL_STATUSES))
    .orderBy(asc(projects.followUpDate));

  const items: PipelineItem[] = rows.map((r) => {
    const quoteTotal = r.dougsQuoteTotalHt != null ? Number(r.dougsQuoteTotalHt) : null;
    return {
      id: r.id,
      name: r.name,
      status: r.status,
      // Si un devis Dougs est lié, son montant écrase la saisie manuelle.
      valueAmount: quoteTotal != null ? quoteTotal.toString() : r.valueAmount,
      valueSource: quoteTotal != null ? "dougs" : "manual",
      dougsQuoteReference: r.dougsQuoteReference,
      probability: r.probability,
      followUpDate: r.followUpDate,
      entityName: r.entityName,
    };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Pipeline commercial"
        description="Tous les projets en phase commerciale (avant signature). Glisser-déposer entre colonnes pour changer le statut."
        actions={
          <Button asChild>
            <Link href="/projets/nouveau?kind=client&status=not_started">
              <Plus className="size-4" />
              Nouveau deal
            </Link>
          </Button>
        }
      />

      {items.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="Aucun deal en cours."
          description="Crée un projet client en phase commerciale pour démarrer le pipeline."
          action={
            <Button asChild size="sm">
              <Link href="/projets/nouveau?kind=client&status=not_started">
                <Plus className="size-4" />
                Nouveau deal
              </Link>
            </Button>
          }
        />
      ) : (
        <PipelineBoard items={items} />
      )}
    </div>
  );
}
