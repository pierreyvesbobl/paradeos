/**
 * Expéditeurs automatiques : un reçu Stripe, une alerte Supabase, des notes
 * Gemini ne portent ni tâche, ni contact, ni projet à proposer. L'extraction
 * CRM les saute ; le classement des factures et les règles de liaison, eux,
 * continuent de lire ces mails (le reçu reste une pièce comptable).
 *
 * Règles pures, sans DB : partie locale de l'adresse, domaine (sous-domaines
 * compris), nom d'affichage, et — quand l'appelant les a — la catégorie Gmail
 * et le lien de désinscription. Ces deux derniers attrapent l'envoi en masse
 * qui se déguise en personne (`mickael@linkavista.fr`, « L'équipe Linkavista »).
 */

const LOCAL_PART_PATTERNS = [
  /^(no|do-?not|dont)[-_.]?reply/,
  /^noreply/,
  // `microsoft-noreply`, `azure-noreply`, `data-studio-noreply` : préfixe de service.
  /[-_.](?:no|do-?not)[-_.]?reply\b/,
  /^notifications?$/,
  /^notify$/,
  /^alerts?$/,
  /^alertes?$/,
  /^mailer(-daemon)?$/,
  /^postmaster$/,
  /^bounces?/,
  /^newsletters?$/,
  /^news$/,
  /^digest$/,
  /^updates?$/,
  /^receipts?/,
  /^billing/,
  /^invoices?\b/,
  /^statements?\b/,
  /^ship$/,
  /^marketing/,
  /^(?:no|ne-pas)-?repondre/,
  /^avisage/,
  /^powiadomienia$/,
  // Guichets : un ticket, une annonce, un prélèvement. Jamais une demande CRM.
  /^support\b/,
  /^(?:pole|service|equipe|team)-/,
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

/**
 * Sous-domaines d'envoi : `news.ovhcloud.com`, `info.vercel.com`,
 * `em1.cloudflare.com`, `newsletter.radiofrance.fr`, `contact.maxicoffee.com`.
 * Une entreprise qui écrit à la main le fait depuis son domaine nu.
 */
const SENDING_SUBDOMAIN =
  /^(?:news|newsletters?|info|infos|mail|mails|email|emails|e|em\d*|marketing|notifications?|alerts?|alertes?|ship|updates?|go|hi|hello|contact|send|mta\d*|bounce|mailer|m|t)\./;

const NAME_PATTERNS = [
  /\bno-?reply\b/i,
  /\bnotifications?\b/i,
  /\bne pas r[ée]pondre\b/i,
  /\(via [^)]+\)\s*$/i,
  // « Isabelle de Dougs », « Marie from Qonto » : la convention des
  // newsletters, un prénom suivi d'une marque. Une personne signe de son nom.
  /^[\p{Lu}][\p{L}'-]+ (?:de|from|chez|at|@) [\p{Lu}][\p{L}\d.&-]*$/u,
  // « PROMEOM », « STELLO » : une marque en capitales, sans personne derrière.
  /^[\p{Lu}\d&.' -]{4,}$/u,
  // « L'équipe Linkavista », « Équipe Qonto », « Team Notion », « The Linear Team ».
  /^(?:l['’]\s*)?(?:[ée]quipe|team)\s/iu,
  /\bteam$/i,
];

/**
 * Onglets Gmail réservés à l'envoi en masse. `CATEGORY_UPDATES` n'en fait pas
 * partie : Gmail y range aussi des échanges réels (confirmations, suivis).
 */
const BULK_GMAIL_CATEGORIES = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
]);

/**
 * Lien de désinscription : la marque légale d'un envoi en masse. On ne regarde
 * que les liens du HTML (texte cliquable ou URL) — le mot seul apparaît dans
 * de vrais échanges (« la désinscription des utilisateurs » dans un cahier des
 * charges).
 */
const UNSUBSCRIBE_LINK =
  /<a\b[^>]*>[^<]*(?:unsubscribe|d[ée]sinscri|d[ée]sabonn|ne\s+plus\s+recevoir)[^<]*<\/a>|href=["'][^"']*(?:unsubscribe|desinscri|d%C3%A9sinscri|desabonn|opt-?out)/i;

export type SenderLike = {
  fromEmail: string | null | undefined;
  fromName?: string | null | undefined;
  /** Libellés Gmail du message, quand l'appelant les a chargés. */
  labels?: readonly string[] | null | undefined;
  /** Corps HTML du message, quand l'appelant l'a chargé. */
  bodyHtml?: string | null | undefined;
};

/**
 * Vrai quand l'adresse, le nom, l'onglet Gmail ou le corps dit « machine » ou
 * « envoi en masse » : aucune extraction CRM.
 */
export function isAutomatedSender(sender: SenderLike): boolean {
  const email = sender.fromEmail?.trim().toLowerCase() ?? "";
  const at = email.lastIndexOf("@");
  if (at > 0) {
    const local = email.slice(0, at);
    const domain = email.slice(at + 1);
    if (LOCAL_PART_PATTERNS.some((re) => re.test(local))) return true;
    if (AUTOMATED_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) return true;
    if (SENDING_SUBDOMAIN.test(domain)) return true;
  }
  const name = sender.fromName?.trim() ?? "";
  if (name && NAME_PATTERNS.some((re) => re.test(name))) return true;
  if (sender.labels?.some((l) => BULK_GMAIL_CATEGORIES.has(l))) return true;
  if (sender.bodyHtml && UNSUBSCRIBE_LINK.test(sender.bodyHtml)) return true;
  return false;
}
