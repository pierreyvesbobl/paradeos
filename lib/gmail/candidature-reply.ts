/**
 * Textes des réponses automatiques aux sollicitations. Module pur.
 *
 * Deux gabarits, un par type de sollicitation (cf. `SollicitationKind`) :
 *   - candidature : « pas de poste ouvert » ;
 *   - prestation : « pas de renfort ni de sous-traitance ».
 * Chacun est un réglage (`CANDIDATURE_REPLY_BODY`,
 * `CANDIDATURE_PRESTATAIRE_REPLY_BODY`) avec ces textes pour défaut ;
 * `{prenom}` y est remplacé par le prénom de l'auteur quand on le connaît.
 * Les réponses sont volontairement courtes et définitives : pas de vivier,
 * pas de « nous gardons votre CV » qu'on ne tiendrait pas.
 */

/** Ce que le LLM a reconnu : une candidature, une offre de prestation. */
export type SollicitationKind = "candidature" | "prestation";

export const DEFAULT_CANDIDATURE_REPLY_BODY = `Bonjour {prenom},

Merci pour votre message et pour l'intérêt que vous portez à Automato.

Nous n'avons actuellement aucun poste ouvert, ni en emploi, ni en stage, ni en alternance, et nous ne prévoyons pas de recrutement à court terme. Nous ne pourrons donc pas donner suite à votre candidature.

Nous ne conservons pas les candidatures reçues. Si une offre venait à s'ouvrir, elle serait publiée sur notre site : n'hésitez pas à nous réécrire à ce moment-là.

Bonne continuation dans vos recherches.

Pierre-Yves
Automato`;

export const DEFAULT_PRESTATAIRE_REPLY_BODY = `Bonjour {prenom},

Merci pour votre message et pour l'intérêt que vous portez à Automato.

Nous travaillons en équipe réduite et réalisons nos missions en interne : nous ne faisons pas appel à des renforts, sous-traitants ou partenaires extérieurs, et nous ne prévoyons pas de changer d'organisation à court terme. Nous ne pourrons donc pas donner suite à votre proposition.

Nous ne conservons pas les propositions reçues. Si notre façon de travailler évoluait, nous le ferions savoir sur notre site.

Bonne continuation.

Pierre-Yves
Automato`;

/** Expéditeur par défaut : l'alias Automato déjà utilisé pour les clients. */
export const DEFAULT_CANDIDATURE_REPLY_FROM = "Pierre-Yves d'Automato <pierreyves@automato.tech>";

export function defaultReplyBodyFor(kind: SollicitationKind): string {
  return kind === "prestation" ? DEFAULT_PRESTATAIRE_REPLY_BODY : DEFAULT_CANDIDATURE_REPLY_BODY;
}

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
export function candidatureReplySubject(
  subject: string | null,
  kind: SollicitationKind = "candidature",
): string {
  const fallback = kind === "prestation" ? "Votre proposition" : "Votre candidature";
  const base = (subject ?? "").trim() || fallback;
  return /^re\s*:/i.test(base) ? base : `Re: ${base}`;
}
