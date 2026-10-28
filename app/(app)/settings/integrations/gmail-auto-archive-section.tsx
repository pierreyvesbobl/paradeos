import { and, eq, isNotNull, sql } from "drizzle-orm";
import { gmailThreads } from "@/db/schema/gmail";
import { db } from "@/lib/db/server";
import {
  AUTOMATED_DAYS_CHOICES,
  getAutoArchiveSettings,
  selectAutomatedThreads,
  selectDoneTaskThreads,
} from "@/lib/gmail/auto-archive";
import { GmailAutoArchiveForm } from "./gmail-auto-archive-form";

/**
 * Archivage automatique de la boîte de réception : ce que la prochaine
 * relève retirerait selon les réglages courants, et ce qui l'a déjà été.
 */
export async function GmailAutoArchiveSection({ userId }: { userId: string }) {
  const conn = await db();
  const settings = await getAutoArchiveSettings();
  const [doneCandidates, automatedCandidates, archivedRows] = await Promise.all([
    selectDoneTaskThreads(conn, { userId }),
    // Aperçu sur le réglage courant, ou sur 7 jours quand la règle est coupée.
    selectAutomatedThreads(conn, {
      userId,
      days: settings.automatedDays ?? 7,
      limit: 10_000,
    }),
    conn
      .select({ reason: gmailThreads.autoArchiveReason, n: sql<number>`count(*)::int` })
      .from(gmailThreads)
      .where(and(eq(gmailThreads.userId, userId), isNotNull(gmailThreads.autoArchivedAt)))
      .groupBy(gmailThreads.autoArchiveReason),
  ]);
  const archivedByReason = new Map(archivedRows.map((r) => [r.reason, r.n]));
  const active = settings.doneTasks || settings.automatedDays !== null;

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Archivage automatique de la boîte</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            À chaque relève, les fils qui n'ont plus rien à faire dans la boîte de réception en sont
            retirés, jamais supprimés. Tout ce qui attend une action reste : réponse attendue,
            paiement refusé, pièce à signer, compte à confirmer, expiration. Un fil remis en boîte à
            la main y reste tant qu'aucun message plus récent n'arrive.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${active ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" : "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"}`}
        >
          {active ? "Actif" : "Coupé"}
        </span>
      </header>

      <div className="space-y-3">
        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-xs">Tâches terminées</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Un fil dont toutes les tâches liées sont terminées, lu, sans proposition en attente
                ni message arrivé depuis la clôture. {doneCandidates.length} fil
                {doneCandidates.length > 1 ? "s" : ""} concerné
                {doneCandidates.length > 1 ? "s" : ""} aujourd'hui ·{" "}
                {archivedByReason.get("task_done") ?? 0} déjà archivé
                {(archivedByReason.get("task_done") ?? 0) > 1 ? "s" : ""}.
              </p>
            </div>
            <GmailAutoArchiveForm kind="doneTasks" enabled={settings.doneTasks} />
          </div>
        </div>

        <div className="space-y-2 rounded-md border bg-muted/30 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-medium text-xs">Notifications de robots</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Reçus, alertes, notifications : un fil où personne d'humain n'a écrit, lu ou non,
                une fois le dernier message assez vieux. Les invitations, rappels d'agenda et
                confirmations de rendez-vous restent en boîte. {automatedCandidates.length} fil
                {automatedCandidates.length > 1 ? "s" : ""} de plus de {settings.automatedDays ?? 7}{" "}
                jours aujourd'hui · {archivedByReason.get("automated") ?? 0} déjà archivé
                {(archivedByReason.get("automated") ?? 0) > 1 ? "s" : ""}. 100 fils au plus par
                relève.
              </p>
            </div>
            <GmailAutoArchiveForm
              kind="automatedDays"
              value={settings.automatedDays === null ? "off" : String(settings.automatedDays)}
              choices={AUTOMATED_DAYS_CHOICES}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
