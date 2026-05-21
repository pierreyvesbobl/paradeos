import { invoiceFilings } from "@/db/schema/invoice-filings";
import { db } from "@/lib/db/server";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { eq, sql } from "drizzle-orm";
import { InvoiceFilingSettings } from "./invoice-filing-settings";

export async function InvoiceFilingSection({ userId }: { userId: string }) {
  const conn = await db();
  const [rootFolderId, enabledSetting, statsRows] = await Promise.all([
    getSetting(SETTING_KEYS.INVOICE_FILING_ROOT_FOLDER_ID),
    getSetting(SETTING_KEYS.INVOICE_FILING_ENABLED),
    conn
      .select({
        status: invoiceFilings.status,
        n: sql<number>`count(*)::int`,
      })
      .from(invoiceFilings)
      .where(eq(invoiceFilings.userId, userId))
      .groupBy(invoiceFilings.status),
  ]);
  const enabled = enabledSetting !== "false";
  const statMap = new Map(statsRows.map((s) => [s.status, s.n]));

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Agent factures d'achat</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            À chaque sync Gmail, les PDF des emails matchés CRM passent dans un pipeline LLM qui
            extrait date / fournisseur / prestation, renomme et range dans Drive (
            <code>Parade/YYYY/Fournisseur/AAMMJJ_facture_Prestation_Fournisseur.pdf</code>).
          </p>
        </div>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs ${enabled && rootFolderId ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}
        >
          {!rootFolderId ? "Folder Drive manquant" : enabled ? "Activé" : "Désactivé"}
        </span>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Classées" value={String(statMap.get("filed") ?? 0)} tone="emerald" />
        <Stat label="En attente" value={String(statMap.get("pending") ?? 0)} tone="amber" />
        <Stat label="Écartées" value={String(statMap.get("rejected") ?? 0)} />
        <Stat label="Erreurs" value={String(statMap.get("error") ?? 0)} tone="rose" />
      </div>

      <InvoiceFilingSettings currentFolderId={rootFolderId} enabled={enabled} />
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
        : tone === "rose"
          ? "text-rose-700 dark:text-rose-400"
          : "text-foreground";
  return (
    <div className="rounded border bg-background p-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`mt-0.5 font-semibold text-sm tabular-nums ${tint}`}>{value}</p>
    </div>
  );
}
