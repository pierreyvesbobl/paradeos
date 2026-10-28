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

const SUBJECT_PATTERNS = [
  /\binvitations?\b/i,
  /\binvitation mise à jour\b/i,
  /\bupdated invitation\b/i,
  /^(re: |fwd?: |tr: )?(rappel|reminder|notification)\s*:/i,
  /^(re: |fwd?: |tr: )?(accept[ée]|accepted|refus[ée]|declined|annul[ée]|cancel+ed|tentative|peut-être|maybe)\s*:/i,
  /\b(rendez-vous|rdv|appointment|booking|meeting)\b.*\b(between|entre|avec|with|confirm)/i,
  /\b(nouvel événement|new event|event (updated|cancel+ed|reminder)|événement (mis à jour|annulé))\b/i,
  /\bzoom meeting\b/i,
];

export type MailLike = { fromEmail: string | null | undefined; subject: string | null | undefined };

/** Vrai pour un mail qui porte un rendez-vous ou un rappel d'agenda. */
export function isCalendarMail(mail: MailLike): boolean {
  const from = mail.fromEmail?.trim() ?? "";
  if (from && SENDER_PATTERNS.some((re) => re.test(from))) return true;
  const subject = mail.subject?.trim() ?? "";
  return subject !== "" && SUBJECT_PATTERNS.some((re) => re.test(subject));
}
