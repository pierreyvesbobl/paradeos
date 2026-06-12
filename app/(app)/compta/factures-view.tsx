import { EmptyState } from "@/components/empty-state";
import { FilingActions } from "@/components/factures/filing-actions";
import { Badge } from "@/components/ui/badge";
import { gmailMessages } from "@/db/schema/gmail";
import { invoiceFilings } from "@/db/schema/invoice-filings";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db/server";
import { formatDate } from "@/lib/format";
import { desc, eq } from "drizzle-orm";
import { ExternalLink, FileText } from "lucide-react";
import Link from "next/link";

const STATUS_LABEL: Record<string, string> = {
  pending: "En attente",
  filed: "Classée",
  rejected: "Écartée",
  error: "Erreur",
};

const STATUS_TONE: Record<string, string> = {
  pending: "border-amber-300 bg-amber-50 text-amber-800",
  filed: "border-emerald-300 bg-emerald-50 text-emerald-800",
  rejected: "border-muted-foreground/30 bg-muted text-muted-foreground",
  error: "border-rose-300 bg-rose-50 text-rose-800",
};

export async function FacturesView() {
  const user = await requireUser();
  const conn = await db();

  const rows = await conn
    .select({
      id: invoiceFilings.id,
      status: invoiceFilings.status,
      originalFilename: invoiceFilings.originalFilename,
      generatedFilename: invoiceFilings.generatedFilename,
      supplierRaw: invoiceFilings.supplierRaw,
      supplierSanitized: invoiceFilings.supplierSanitized,
      prestationType: invoiceFilings.prestationType,
      invoiceDate: invoiceFilings.invoiceDate,
      confidence: invoiceFilings.confidence,
      driveFileId: invoiceFilings.driveFileId,
      errorMessage: invoiceFilings.errorMessage,
      createdAt: invoiceFilings.createdAt,
      messageThreadIdLocal: gmailMessages.threadId,
      messageSubject: gmailMessages.subject,
      messageFrom: gmailMessages.fromEmail,
      messageFromName: gmailMessages.fromName,
    })
    .from(invoiceFilings)
    .innerJoin(gmailMessages, eq(gmailMessages.id, invoiceFilings.messageId))
    .where(eq(invoiceFilings.userId, user.id))
    .orderBy(desc(invoiceFilings.createdAt))
    .limit(200);

  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        L'agent IA détecte les factures PDF reçues par mail, extrait date / fournisseur / prestation
        et les range automatiquement dans Drive (Parade/YYYY/Fournisseur/AAMMJJ_facture_*.pdf).
      </p>

      {rows.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="Aucun classement encore"
          description="Configure le dossier Drive racine dans /settings/integrations puis lance 'Sync now' — les PDF des emails matchés CRM seront classés à chaque sync."
        />
      ) : (
        <ul className="divide-y rounded-md border bg-card">
          {rows.map((r) => (
            <li key={r.id} className="space-y-2 px-4 py-3">
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="truncate font-medium text-sm">
                    {r.generatedFilename ?? r.originalFilename ?? "(sans nom)"}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {r.messageSubject ? `« ${r.messageSubject} »` : "(sans objet)"}
                    {" — "}
                    <Link href={`/emails/${r.messageThreadIdLocal}`} className="hover:underline">
                      {r.messageFromName ?? r.messageFrom ?? "?"}
                    </Link>
                    {r.createdAt ? ` · ${formatDate(r.createdAt.toISOString())}` : ""}
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className={`shrink-0 text-[10px] ${STATUS_TONE[r.status]}`}
                >
                  {STATUS_LABEL[r.status] ?? r.status}
                </Badge>
              </header>

              {r.status === "filed" && r.driveFileId ? (
                <a
                  href={`https://drive.google.com/file/d/${r.driveFileId}/view`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                >
                  Ouvrir sur Drive <ExternalLink className="size-3" />
                </a>
              ) : null}

              {r.status === "filed" ? (
                <p className="text-[11px] text-muted-foreground">
                  <span className="text-foreground/80">{r.supplierSanitized ?? r.supplierRaw}</span>
                  {" · "}
                  {r.prestationType ?? "—"}
                  {r.invoiceDate ? ` · émise le ${r.invoiceDate}` : ""}
                  {r.confidence != null
                    ? ` · confiance ${(Number(r.confidence) * 100).toFixed(0)}%`
                    : ""}
                </p>
              ) : null}

              {r.status !== "filed" && r.errorMessage ? (
                <p className="text-[11px] text-amber-700 dark:text-amber-400">
                  <span className="font-medium">Raison :</span> {r.errorMessage}
                </p>
              ) : null}

              {r.status === "error" || r.status === "rejected" || r.status === "pending" ? (
                <FilingActions filingId={r.id} status={r.status} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
