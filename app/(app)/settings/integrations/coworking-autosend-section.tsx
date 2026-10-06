import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { coworkingContracts } from "@/db/schema/coworking";
import { invoices } from "@/db/schema/invoices";
import { db } from "@/lib/db/server";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { CoworkingAutoSendSettings } from "./coworking-autosend-settings";

/**
 * Réglage de l'envoi automatique des factures coworking.
 *
 * Affiche les deux verrous séparément, parce que c'est la question qu'on se
 * pose en arrivant ici : l'interrupteur global est-il ouvert, et combien de
 * contrats l'ont effectivement coché. Un global activé sans aucun contrat
 * opt-in n'envoie rien, et il faut que ça se voie.
 */
export async function CoworkingAutoSendSection() {
  const conn = await db();
  const [enabledSetting, contractStats, queueCount, blockedCount] = await Promise.all([
    getSetting(SETTING_KEYS.COWORKING_AUTOSEND_ENABLED),
    conn
      .select({
        autoSend: coworkingContracts.autoSend,
        n: sql<number>`count(*)::int`,
      })
      .from(coworkingContracts)
      .where(eq(coworkingContracts.status, "en_cours"))
      .groupBy(coworkingContracts.autoSend),
    conn
      .select({ n: sql<number>`count(*)::int` })
      .from(invoices)
      .innerJoin(coworkingContracts, eq(coworkingContracts.id, invoices.coworkingContractId))
      .where(
        and(
          eq(invoices.kind, "coworking"),
          eq(invoices.status, "draft"),
          isNull(invoices.autoSentAt),
          eq(coworkingContracts.autoSend, true),
        ),
      ),
    conn
      .select({ n: sql<number>`count(*)::int` })
      .from(invoices)
      .where(and(eq(invoices.kind, "coworking"), isNotNull(invoices.autoSendError))),
  ]);

  const enabled = enabledSetting === "true";
  const optedIn = contractStats.find((r) => r.autoSend)?.n ?? 0;
  const notOptedIn = contractStats.find((r) => !r.autoSend)?.n ?? 0;

  const state = !enabled
    ? { label: "Désactivé", tone: "amber" as const }
    : optedIn === 0
      ? { label: "Aucun contrat opt-in", tone: "amber" as const }
      : { label: "Activé", tone: "emerald" as const };

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Envoi automatique des factures coworking</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Au passage du cron mensuel, les factures des contrats opt-in sont poussées sur Dougs,
            contrôlées, <strong>finalisées</strong> puis envoyées par mail au coworker. La
            finalisation est irréversible : seul un avoir peut annuler une facture émise.
          </p>
          <p className="mt-1 text-muted-foreground text-xs">
            Double verrou. Cet interrupteur ne suffit pas : chaque contrat doit cocher « Envoi
            automatique » de son côté. Les contrats facturés par G&amp;O ne partent jamais.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
            state.tone === "emerald"
              ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
              : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
          }`}
        >
          {state.label}
        </span>
      </header>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Contrats opt-in" value={String(optedIn)} tone="emerald" />
        <Stat label="Contrats manuels" value={String(notOptedIn)} />
        <Stat label="En attente d'envoi" value={String(queueCount[0]?.n ?? 0)} tone="amber" />
        <Stat label="Bloquées" value={String(blockedCount[0]?.n ?? 0)} tone="rose" />
      </div>

      <CoworkingAutoSendSettings enabled={enabled} optedInCount={optedIn} />
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
    <div className="rounded-md border bg-background px-3 py-2">
      <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className={`mt-0.5 font-medium text-lg tabular-nums ${tint}`}>{value}</p>
    </div>
  );
}
