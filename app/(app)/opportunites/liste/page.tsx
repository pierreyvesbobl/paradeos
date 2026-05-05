import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { entities } from "@/db/schema/entities";
import { opportunities } from "@/db/schema/opportunities";
import { db } from "@/lib/db/server";
import { formatDate, formatEuro } from "@/lib/format";
import { type OpportunityStatus, opportunityStatusLabels } from "@/lib/schemas/opportunities";
import { asc, desc, ilike, or, sql } from "drizzle-orm";
import { LayoutGrid, Plus, Sparkles } from "lucide-react";
import Link from "next/link";

type SearchParams = Promise<{ q?: string }>;

const statusVariant: Record<
  OpportunityStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  not_started: "outline",
  proposal_sent: "secondary",
  to_follow_up: "secondary",
  awaiting_response: "secondary",
  won: "default",
  lost: "destructive",
};

export default async function OpportunitiesListPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const conn = await db();
  const rows = await conn
    .select({
      id: opportunities.id,
      title: opportunities.title,
      status: opportunities.status,
      valueAmount: opportunities.valueAmount,
      probability: opportunities.probability,
      followUpDate: opportunities.followUpDate,
      entityId: entities.id,
      entityName: entities.name,
    })
    .from(opportunities)
    .leftJoin(entities, sql`${opportunities.entityId} = ${entities.id}`)
    .where(
      query
        ? or(ilike(opportunities.title, `%${query}%`), ilike(entities.name, `%${query}%`))
        : undefined,
    )
    .orderBy(desc(opportunities.updatedAt), asc(opportunities.title));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Opportunités — Liste"
        description="Vue tableau du pipeline."
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href="/opportunites">
                <LayoutGrid className="size-4" />
                Vue kanban
              </Link>
            </Button>
            <Button asChild>
              <Link href="/opportunites/nouveau">
                <Plus className="size-4" />
                Nouvelle
              </Link>
            </Button>
          </>
        }
      />

      <form className="max-w-sm">
        <Input
          name="q"
          defaultValue={query}
          placeholder="Rechercher par titre, entité…"
          className="h-9"
        />
      </form>

      {rows.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={query ? "Aucune opportunité trouvée." : "Pas encore d'opportunité."}
          action={
            query ? null : (
              <Button asChild size="sm">
                <Link href="/opportunites/nouveau">
                  <Plus className="size-4" />
                  Nouvelle opportunité
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titre</TableHead>
                <TableHead>Entité</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Montant</TableHead>
                <TableHead className="text-right">Proba</TableHead>
                <TableHead>Relance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    <Link href={`/opportunites/${row.id}`} className="hover:underline">
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    {row.entityId ? (
                      <Link href={`/entites/${row.entityId}`} className="text-sm hover:underline">
                        {row.entityName}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground text-sm">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[row.status]}>
                      {opportunityStatusLabels[row.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {row.valueAmount ? formatEuro(Number(row.valueAmount)) : "—"}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-sm">
                    {row.probability != null ? `${row.probability}%` : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.followUpDate ? formatDate(row.followUpDate) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
