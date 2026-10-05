import { invoices } from "@/db/schema/invoices";
import { getSalesInvoiceFolderId } from "@/lib/billing/file-invoice-to-drive";
import { db } from "@/lib/db/server";
import { and, inArray, sql } from "drizzle-orm";
import { SalesInvoiceDriveSettings } from "./sales-invoice-drive-settings";

/**
 * Classement des factures de vente dans le Drive comptable.
 *
 * Distinct du classeur de factures d'achat : celui-ci range ce que **nous**
 * émettons, dans un dossier unique, au moment où la facture part au client.
 */
export async function SalesInvoiceDriveSection() {
  const conn = await db();
  const [folderId, stats] = await Promise.all([
    getSalesInvoiceFolderId(),
    conn
      .select({
        classees: sql<number>`count(*) filter (where ${invoices.driveFileId} is not null)::int`,
        aClasser: sql<number>`count(*) filter (where ${invoices.driveFileId} is null)::int`,
        enErreur: sql<number>`count(*) filter (where ${invoices.driveFilingError} is not null)::int`,
      })
      .from(invoices)
      .where(
        and(
          inArray(invoices.status, ["sent", "paid"]),
          inArray(invoices.kind, ["coworking", "milestone", "one_off"]),
        ),
      ),
  ]);
  const s = stats[0] ?? { classees: 0, aClasser: 0, enErreur: 0 };

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Factures de vente dans le Drive</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            À chaque envoi d'une facture au client, son PDF est déposé dans ce dossier, nommé
            <code> RÉFÉRENCE_Client.pdf</code> — la référence Dougs trie déjà chronologiquement.
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            Un échec de classement n'interrompt jamais l'envoi : la facture part au client, la copie
            se rattrape.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
            folderId
              ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {folderId ? "Configuré" : "Dossier manquant"}
        </span>
      </header>

      <div className="mb-3 grid grid-cols-3 gap-3">
        <Stat label="Classées" value={String(s.classees)} tone="emerald" />
        <Stat label="À classer" value={String(s.aClasser)} tone="amber" />
        <Stat label="En erreur" value={String(s.enErreur)} tone="rose" />
      </div>

      <SalesInvoiceDriveSettings currentFolderId={folderId} />
    </section>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "amber" | "rose";
}) {
  const tint =
    tone === "emerald"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "amber"
        ? "text-amber-700 dark:text-amber-400"
        : "text-rose-700 dark:text-rose-400";
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`mt-0.5 font-medium text-lg tabular-nums ${tint}`}>{value}</p>
    </div>
  );
}
