import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { meetings } from "@/db/schema/meetings";
import { db } from "@/lib/db/server";
import { desc, sql } from "drizzle-orm";
import { Mic, Plus } from "lucide-react";
import Link from "next/link";

const STATUS_LABEL = {
  ingested: "À extraire",
  extracted: "À valider",
  reviewed: "Validé",
  archived: "Archivé",
} as const;

const STATUS_BADGE = {
  ingested: "border-amber-300 bg-amber-50 text-amber-700",
  extracted: "border-indigo-300 bg-indigo-50 text-indigo-700",
  reviewed: "border-emerald-300 bg-emerald-50 text-emerald-700",
  archived: "border-slate-300 bg-slate-50 text-slate-500",
} as const;

export default async function MeetingsPage() {
  const conn = await db();

  const rows = await conn
    .select({
      id: meetings.id,
      title: meetings.title,
      occurredAt: meetings.occurredAt,
      createdAt: meetings.createdAt,
      status: meetings.status,
      pendingCount: sql<number>`(
        select count(*) from meeting_proposals
        where meeting_proposals.meeting_id = meetings.id
          and meeting_proposals.status = 'pending'
      )`.as("pending_count"),
    })
    .from(meetings)
    .orderBy(desc(meetings.occurredAt), desc(meetings.createdAt));

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Knowledge"
        title="Meetings"
        description="Importe un transcript, génère un résumé et extrais tâches / contacts / opportunités à valider."
        actions={
          <Button asChild>
            <Link href="/meetings/nouveau">
              <Plus className="size-4" />
              Importer un transcript
            </Link>
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Mic}
          title="Pas encore de meeting."
          description="Colle ou téléverse un transcript pour démarrer."
          action={
            <Button asChild size="sm">
              <Link href="/meetings/nouveau">
                <Plus className="size-4" />
                Importer un transcript
              </Link>
            </Button>
          }
        />
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titre</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">À valider</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id} className="group">
                  <TableCell className="font-medium">
                    <Link href={`/meetings/${row.id}`} className="hover:underline">
                      {row.title}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {row.occurredAt ? new Date(row.occurredAt).toLocaleDateString("fr-FR") : "—"}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs ${STATUS_BADGE[row.status]}`}
                    >
                      {STATUS_LABEL[row.status]}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-sm">
                    {Number(row.pendingCount) > 0 ? (
                      <span className="font-medium">{Number(row.pendingCount)}</span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
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
