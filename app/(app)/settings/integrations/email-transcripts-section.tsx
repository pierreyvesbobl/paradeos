import { getGoogleAccount } from "@/lib/google/account";
import { hasRequiredGmailScopes } from "@/lib/google/oauth";
import { SUGGESTED_MEETINGS_EMAIL_LABEL } from "@/lib/meetings/ingest-from-email";
import { getSetting, SETTING_KEYS } from "@/lib/settings";
import { EmailTranscriptsForm } from "./email-transcripts-form";

/**
 * Section UI pour l'ingestion des réunions envoyées par mail. Un label
 * Gmail sert de file d'attente : ce qui y arrive devient une réunion,
 * puis le label est retiré. Le cron `ingest-email-transcripts` (15 min)
 * et le bouton « Sync now » font le même travail.
 */
export async function EmailTranscriptsSection({ userId }: { userId: string }) {
  const [labelName, address, account] = await Promise.all([
    getSetting(SETTING_KEYS.MEETINGS_EMAIL_LABEL),
    getSetting(SETTING_KEYS.MEETINGS_EMAIL_ADDRESS),
    getGoogleAccount(userId),
  ]);
  const scopesOk = account ? hasRequiredGmailScopes(account.scopes) : false;

  return (
    <section className="rounded-lg border bg-card p-6">
      <header className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="font-medium text-sm">Transcripts par mail (auto-import)</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Envoie un compte-rendu ou un enregistrement à l'adresse dédiée (ou range le mail sous le
            label), et Parade OS en fait une réunion : pièce jointe texte, PDF ou audio (transcrit
            par Whisper), ou à défaut le corps du mail. L'extraction LLM suit, puis le mail passe
            sous <span className="font-mono">…/Traité</span>. Cron toutes les 15 min — sync manuel
            disponible.
          </p>
        </div>
        {labelName ? (
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-emerald-700 text-xs dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            Surveillé
          </span>
        ) : (
          <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 text-xs dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Non configuré
          </span>
        )}
      </header>
      {scopesOk ? (
        <EmailTranscriptsForm
          currentLabel={labelName}
          currentAddress={address}
          suggestedLabel={SUGGESTED_MEETINGS_EMAIL_LABEL}
          gmailAddress={account?.email ?? null}
        />
      ) : (
        <p className="text-muted-foreground text-xs">
          Connecte Gmail (section ci-dessus) avec la permission de lecture et de libellés avant
          d'activer l'ingestion par mail.
        </p>
      )}
    </section>
  );
}
