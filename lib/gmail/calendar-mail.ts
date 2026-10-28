import { words, wordsThen } from "./word-match";

/**
 * Mails d'agenda : invitations, mises à jour, acceptations, rappels
 * d'événement, confirmations de rendez-vous (Google Agenda, Cal.com,
 * Calendly, Zoom…). Ils viennent de robots, mais ils portent un
 * rendez-vous : l'archivage automatique des notifications les laisse en
 * boîte, c'est à l'utilisateur de les ranger.
 *
 * Règles pures : expéditeur et objet. Le doute profite au maintien en
 * boîte (une « invitation » à rejoindre un outil reste, sans dommage).
 */

const SENDER_PATTERNS = [
  /^calendar-notification@/i,
  /^calendar-server@/i,
  /@calendar\.google\.com$/i,
];

const SUBJECT_PATTERNS: RegExp[] = [
  words("invitations?"),
  words("invitation mise à jour|updated invitation"),
  /^(?:re: |fwd?: |tr: )?(?:rappel|reminder|notification)\s*:/iu,
  /^(?:re: |fwd?: |tr: )?(?:accept[ée]e?|accepted|refus[ée]e?|declined|annul[ée]e?|cancel+ed|tentative|peut-être|maybe)\s*:/iu,
  wordsThen("rendez-vous|rdv|appointment|booking|meeting", "between|entre|avec|with|confirm"),
  words(
    "nouvel événement|new event|event (?:updated|cancel+ed|reminder)|événement (?:mis à jour|annulé)",
  ),
  words("zoom meeting"),
];

export type MailLike = { fromEmail: string | null | undefined; subject: string | null | undefined };

/** Vrai pour un mail qui porte un rendez-vous ou un rappel d'agenda. */
export function isCalendarMail(mail: MailLike): boolean {
  const from = mail.fromEmail?.trim() ?? "";
  if (from && SENDER_PATTERNS.some((re) => re.test(from))) return true;
  const subject = mail.subject?.trim() ?? "";
  return subject !== "" && SUBJECT_PATTERNS.some((re) => re.test(subject));
}
