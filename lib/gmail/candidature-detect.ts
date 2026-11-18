/**
 * Détection des mails de sollicitation entrante : candidatures (spontanée,
 * stage, alternance, réponse à une offre) et propositions de prestation
 * (freelance ou agence qui offre ses services, un renfort, de la
 * sous-traitance, une « collaboration »). Module pur, partagé par le sync
 * Gmail et le rattrapage, testable.
 *
 * C'est un pré-filtre bon marché sur les métadonnées : il décide si on
 * télécharge le corps du mail. La confirmation finale, et le choix entre
 * les deux réponses types, sont faits par le LLM (cf.
 * `candidature-classify.ts`) avant tout envoi — un faux positif ici ne
 * coûte qu'un `format=full`, un faux positif là-bas enverrait un refus à
 * un client.
 */

/**
 * Sujets qui nomment la démarche. « stage » et « poste » seuls sont trop
 * ambigus (« stage de formation », « poste de travail ») : on exige la
 * forme complète (« demande de stage », « stage de fin d'études »).
 */
const CANDIDATURE_SUBJECT_RE =
  /(candidature|candidat\b|alternan[ct]e?s?|apprentissage|apprenti|\bstage de fin|demande de stage|recherche (de |d'un |d'une )?(stage|alternance|emploi)|opportunit[ée]s? de (stage|d'alternance|stage|emploi)|offre d'emploi|recrutement|\bcv\b|curriculum|lettre de motivation|internship|\bintern\b|apprenticeship|job application|applying for|cover letter|\bresume\b|\bcandidacy\b|open position|job opportunity)/i;

/**
 * Sujets d'une offre de prestation : quelqu'un propose de travailler POUR
 * nous (renfort, sous-traitance, freelance en quête de missions, agence
 * offshore, « proposition de collaboration »). « collaboration » et
 * « partenariat » seuls sont trop fréquents dans les échanges avec les
 * clients : on exige la tournure de la proposition.
 */
const PRESTATION_SUBJECT_RE =
  /(sous[- ]?trait|\brenfort|free-?lance|prestataire|\bmes services\b|proposer (mes|nos) services|mise [àa] disposition|(proposition|proposer|offre|opportunit[ée]s?|demande|id[ée]e|projet) (de |d'une? )?(collaboration|partenariat)|(collaboration|partenariat) (free-?lance|en sous[- ]?traitance|commercial|technique|strat[ée]gique)|(recherche|en qu[êe]te) de (nouvelles )?missions|disponible pour (de nouvelles |des |vos )?missions|renfort sur vos missions|white[- ]label|marque blanche|subcontract|outsourc|partnership (proposal|opportunity)|offer (my|our) services|available for (new )?(projects|missions)|staff augmentation|dedicated developers?)/i;

/**
 * Libellé Gmail (dernier segment) qui range le recrutement : « RH »,
 * « Candidatures », « Recrutement ». Posé par un filtre Gmail dès la
 * réception, c'est un signal suffisant pour aller lire le corps.
 */
const CANDIDATURE_LABEL_RE = /^(rh|candidatures?|recrutement|recruiting|jobs?|careers?)$/i;

/**
 * Boîtes dont on ne répond jamais aux mails : les nôtres (une réponse
 * irait à nous-mêmes), et les automates.
 */
const OWN_DOMAINS = new Set(["automato.tech", "bobl.fr", "parade-os.com"]);
const AUTOMATED_SENDER_RE =
  /^(no-?reply|noreply|ne-pas-repondre|do-?not-?reply|mailer-daemon|postmaster|notifications?|bounce)([+._-]|@|$)/i;

export function isOwnOrAutomatedSender(fromEmail: string | null): boolean {
  if (!fromEmail) return true;
  const email = fromEmail.trim().toLowerCase();
  const [local, domain] = email.split("@");
  if (!local || !domain) return true;
  if (OWN_DOMAINS.has(domain)) return true;
  return AUTOMATED_SENDER_RE.test(local);
}

/**
 * Vrai si le mail ressemble à une candidature OU à une offre de
 * prestation : les deux suivent le même chemin (file, LLM, réponse type),
 * seul le texte de la réponse change.
 */
export function looksLikeCandidatureMessage(args: {
  subject: string | null;
  fromEmail: string | null;
  /** Noms des libellés Gmail du message (pas les ids). */
  labelNames: string[];
}): boolean {
  if (isOwnOrAutomatedSender(args.fromEmail)) return false;
  if (args.subject && CANDIDATURE_SUBJECT_RE.test(args.subject)) return true;
  if (args.subject && PRESTATION_SUBJECT_RE.test(args.subject)) return true;
  return args.labelNames.some((name) =>
    CANDIDATURE_LABEL_RE.test(name.split("/").pop()?.trim() ?? ""),
  );
}

/** Prénom probable depuis un `From: Prénom Nom <…>`, ou null. */
export function firstNameFromSender(fromName: string | null): string | null {
  if (!fromName) return null;
  const cleaned = fromName.replace(/["<>]/g, "").trim();
  if (!cleaned || cleaned.includes("@")) return null;
  const first = cleaned.split(/\s+/)[0] ?? "";
  // « DUPUIS Candice » : un premier mot tout en capitales est un nom de
  // famille à la française ; on prend le mot suivant.
  const parts = cleaned.split(/\s+/);
  const candidate = /^[A-ZÀ-Ý'-]{2,}$/.test(first) && parts[1] ? parts[1] : first;
  if (candidate.length < 2) return null;
  return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
}
