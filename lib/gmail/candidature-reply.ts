/**
 * Texte de la réponse automatique aux candidatures. Module pur.
 *
 * Le corps est un réglage (`CANDIDATURE_REPLY_BODY`) avec ce texte pour
 * défaut ; `{prenom}` y est remplacé par le prénom du candidat quand on
 * le connaît. La réponse est volontairement courte et définitive : pas de
 * poste, pas de vivier, pas de « nous gardons votre CV » qu'on ne
 * tiendrait pas.
 */

export const DEFAULT_CANDIDATURE_REPLY_BODY = `Bonjour {prenom},

Merci pour votre message et pour l'intérêt que vous portez à Automato.

Nous n'avons actuellement aucun poste ouvert, ni en emploi, ni en stage, ni en alternance, et nous ne prévoyons pas de recrutement à court terme. Nous ne pourrons donc pas donner suite à votre candidature.

Nous ne conservons pas les candidatures reçues. Si une offre venait à s'ouvrir, elle serait publiée sur notre site : n'hésitez pas à nous réécrire à ce moment-là.

Bonne continuation dans vos recherches.

Pierre-Yves
Automato`;

/** Expéditeur par défaut : l'alias Automato déjà utilisé pour les clients. */
export const DEFAULT_CANDIDATURE_REPLY_FROM = "Pierre-Yves d'Automato <pierreyves@automato.tech>";

/**
 * Remplace `{prenom}` par le prénom, ou retire la virgule qui le précède
 * quand on ne le connaît pas (« Bonjour, » plutôt que « Bonjour , »).
 */
export function renderCandidatureReply(template: string, firstName: string | null): string {
  const body = firstName
    ? template.replaceAll("{prenom}", firstName)
    : template.replace(/\s*\{prenom\}/g, "");
  return body.trim();
}

/** Sujet de la réponse : « Re: » devant le sujet d'origine, une seule fois. */
export function candidatureReplySubject(subject: string | null): string {
  const base = (subject ?? "").trim() || "Votre candidature";
  return /^re\s*:/i.test(base) ? base : `Re: ${base}`;
}
