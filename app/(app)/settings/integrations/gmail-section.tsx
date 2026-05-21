import { emailProposals, gmailMessages, gmailSyncState, gmailThreads } from "@/db/schema/gmail";
import { db } from "@/lib/db/server";
import { formatDate } from "@/lib/format";
import { getGoogleAccount } from "@/lib/google/account";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { and, eq, sql } from "drizzle-orm";
import { GmailActions } from "./gmail-actions";
import { GmailExtractionToggle } from "./gmail-extraction-toggle";

/**
 * Section UI pour Gmail. Réutilise le même flow OAuth que Drive/Calendar
 * (`/api/google/oauth/start`) — un seul compte Google par user. Si le
 * compte est connecté mais sans scope gmail, on signale qu'une
 * reconnexion est nécessaire pour ajouter la permission.
 *
 * Actions exposées :
 *   - Sync now : bouton qui appelle `triggerGmailSync` (action serveur).
 *     Pendant le bootstrap initial (3 derniers mois), à cliquer plusieurs
 *     fois pour drainer.
 *   - Purger : vide les tables locales (gmail_threads, gmail_messages,
 *     gmail_links, gmail_sync_state). Le prochain sync repart de zéro.
 */
export async function GmailSection({ userId }: { userId: string }) {
  const account = await getGoogleAccount(userId);
  const scopesOk = account ? hasRequiredGmailScopes(account.scopes) : false;

  // Stats locales (uniquement si l'utilisateur a le scope ; sinon les
  // tables peuvent être vides pour de bonnes raisons).
  let threadCount = 0;
  let lastSync: Date | null = null;
  let bootstrapPending = false;
  let lastError: string | null = null;
  let pendingProposals = 0;
  let extractedMessages = 0;
  let extractionEnabled = true;
  if (account && scopesOk) {
    const conn = await db();
    const [count, state, propCount, extCount, extEnabledSetting] = await Promise.all([
      conn
        .select({ n: sql<number>`count(*)::int` })
        .from(gmailThreads)
        .where(eq(gmailThreads.userId, userId)),
      conn.select().from(gmailSyncState).where(eq(gmailSyncState.userId, userId)).limit(1),
      conn
        .select({ n: sql<number>`count(*)::int` })
        .from(emailProposals)
        .innerJoin(gmailMessages, eq(gmailMessages.id, emailProposals.messageId))
        .where(and(eq(gmailMessages.userId, userId), eq(emailProposals.status, "pending"))),
      conn
        .select({ n: sql<number>`count(*)::int` })
        .from(gmailMessages)
        .where(
          and(eq(gmailMessages.userId, userId), eq(gmailMessages.extractionStatus, "pending")),
        ),
      getSetting(SETTING_KEYS.GMAIL_EXTRACTION_ENABLED),
    ]);
    threadCount = count[0]?.n ?? 0;
    lastSync = state[0]?.lastIncrementalAt ?? null;
    bootstrapPending = Boolean(state[0]?.bootstrapCursor);
    lastError = state[0]?.lastError ?? null;
    pendingProposals = propCount[0]?.n ?? 0;
    extractedMessages = extCount[0]?.n ?? 0;
    extractionEnabled = extEnabledSetting !== "false";
  }

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Gmail</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Indexe les emails dont l'expéditeur ou un destinataire est un contact CRM, pour les voir
            liés à leurs projets / entités. Le contenu complet n'est stocké que pour les emails
            matchés (pas toute la boîte). Sync quotidien automatique + bouton manuel.
          </p>
        </div>
        {!account ? (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Connecte d'abord Google
          </span>
        ) : scopesOk ? (
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700 text-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            Activé
          </span>
        ) : (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Reconnexion requise
          </span>
        )}
      </header>

      {!account ? (
        <p className="text-muted-foreground text-xs">
          Connecte Google Drive ou Calendar d'abord (section au-dessus) — Gmail réutilise le même
          compte Google.
        </p>
      ) : !scopesOk ? (
        <div className="space-y-3">
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            <p className="font-medium">Scope gmail.readonly manquant</p>
            <p className="mt-1">
              Le compte connecté n'a pas encore la permission de lire Gmail. Reconnecte pour ajouter{" "}
              <code>gmail.readonly</code> au consentement Google (Google relance l'écran de scopes).
            </p>
          </div>
          <a
            href="/api/google/oauth/start"
            className="inline-flex items-center gap-2 rounded-md bg-foreground px-3 py-1.5 text-background text-sm hover:opacity-90"
          >
            Reconnecter Google pour activer Gmail
          </a>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Threads indexés" value={threadCount.toLocaleString("fr-FR")} />
            <Stat
              label="Dernière sync"
              value={lastSync ? formatDate(lastSync.toISOString()) : "—"}
            />
            <Stat
              label="État"
              value={
                bootstrapPending
                  ? "Bootstrap en cours"
                  : lastError
                    ? "Dernière sync en erreur"
                    : "OK"
              }
            />
          </div>
          {lastError ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-400">
              <span className="font-medium">Erreur sync :</span> {lastError}
            </p>
          ) : null}
          {bootstrapPending ? (
            <p className="text-[11px] text-muted-foreground">
              Le bootstrap initial (3 derniers mois) s'étale sur plusieurs runs (50 messages / run).
              Clique plusieurs fois sur "Sync now" pour drainer plus vite.
            </p>
          ) : null}
          <GmailActions />

          {/* Extraction LLM (Phase 2) */}
          <div className="space-y-2 rounded-md border bg-muted/30 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-medium text-xs">Extraction LLM des emails</h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  À chaque sync, les emails matchés CRM sont analysés (10 max par run) et le LLM
                  propose tâches / catégories / liens projet. Coût indicatif : ~0,01-0,05€ par email
                  selon le modèle.
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {pendingProposals > 0 ? (
                    <a className="font-medium underline" href="/emails/propositions">
                      {pendingProposals} proposition(s) en attente
                    </a>
                  ) : (
                    "Aucune proposition en attente."
                  )}
                  {extractedMessages > 0
                    ? ` · ${extractedMessages} message(s) en file d'extraction.`
                    : ""}
                </p>
              </div>
              <GmailExtractionToggle enabled={extractionEnabled} />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border bg-background p-2">
      <p className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="mt-0.5 font-semibold text-sm tabular-nums">{value}</p>
    </div>
  );
}
