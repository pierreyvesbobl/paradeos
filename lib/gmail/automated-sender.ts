/**
 * Expéditeurs automatiques : un reçu Stripe, une alerte Supabase, des notes
 * Gemini ne portent ni tâche, ni contact, ni projet à proposer. L'extraction
 * CRM les saute ; le classement des factures et les règles de liaison, eux,
 * continuent de lire ces mails (le reçu reste une pièce comptable).
 *
 * Règles pures, sans DB : partie locale de l'adresse, domaine (sous-domaines
 * compris), nom d'affichage.
 */

const LOCAL_PART_PATTERNS = [
  /^(no|do-?not|dont)[-_.]?reply/,
  /^noreply/,
  /^notifications?$/,
  /^notify$/,
  /^alerts?$/,
  /^alertes?$/,
  /^mailer(-daemon)?$/,
  /^postmaster$/,
  /^bounces?/,
  /^newsletters?$/,
  /^digest$/,
  /^updates?$/,
  /^receipts?$/,
  /^billing$/,
  /^robot$/,
  /^automated?$/,
  /^system$/,
];

/**
 * Services dont tout le courrier est généré par une machine. Un domaine
 * couvre ses sous-domaines (`mail.granola.ai`, `services.ovhcloud.com`).
 */
const AUTOMATED_DOMAINS = [
  "stripe.com",
  "supabase.com",
  "supabase.io",
  "google.com",
  "granola.ai",
  "substack.com",
  "github.com",
  "cron-job.org",
  "vercel.com",
  "ovhcloud.com",
  "ovh.com",
  "swisstransfer.com",
  "fromsmash.com",
  "wetransfer.com",
  "linkedin.com",
  "notion.so",
  "slack.com",
  "atlassian.net",
  "figma.com",
  "calendly.com",
  "docusign.net",
  "yousign.com",
  "qonto.com",
  "openai.com",
  "anthropic.com",
  "openrouter.ai",
  "sentry.io",
  "apple.com",
  "amazon.fr",
  "amazon.com",
];

const NAME_PATTERNS = [/\bno-?reply\b/i, /\bnotifications?\b/i, /\bne pas r[ée]pondre\b/i];

export type SenderLike = {
  fromEmail: string | null | undefined;
  fromName?: string | null | undefined;
};

/** Vrai quand l'adresse ou le nom dit « machine » : aucune extraction CRM. */
export function isAutomatedSender(sender: SenderLike): boolean {
  const email = sender.fromEmail?.trim().toLowerCase() ?? "";
  const at = email.lastIndexOf("@");
  if (at > 0) {
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (LOCAL_PART_PATTERNS.some((re) => re.test(local))) return true;
    if (AUTOMATED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
  }
  const name = sender.fromName?.trim() ?? "";
  if (name && NAME_PATTERNS.some((re) => re.test(name))) return true;
  return false;
}
