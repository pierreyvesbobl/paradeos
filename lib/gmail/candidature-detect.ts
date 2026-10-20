/**
 * Détection des mails de candidature (spontanée, stage, alternance,
 * réponse à une offre). Module pur, partagé par le sync Gmail et le
 * rattrapage, testable.
 *
 * C'est un pré-filtre bon marché sur les métadonnées : il décide si on
 * télécharge le corps du mail. La confirmation finale est faite par le
 * LLM (cf. `candidature-classify.ts`) avant tout envoi de réponse — un
 * faux positif ici ne coûte qu'un `format=full`, un faux positif là-bas
 * enverrait un refus à un client.
 */

/**
 * Sujets qui nomment la démarche. « stage » et « poste » seuls sont trop
 * ambigus (« stage de formation », « poste de travail ») : on exige la
 * forme complète (« demande de stage », « stage de fin d'études »).
 */
const CANDIDATURE_SUBJECT_RE =
  /(candidature|candidat\b|alternan[ct]e?s?|apprentissage|apprenti|\bstage de fin|demande de stage|recherche (de |d'un |d'une )?(stage|alternance|emploi)|opportunit[ée]s? de (stage|d'alternance|stage|emploi)|offre d'emploi|recrutement|\bcv\b|curriculum|lettre de motivation|internship|\bintern\b|apprenticeship|job application|applying for|cover letter|\bresume\b|\bcandidacy\b|open position|job opportunity)/i;

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

export function looksLikeCandidatureMessage(args: {
  subject: string | null;
  fromEmail: string | null;
  /** Noms des libellés Gmail du message (pas les ids). */
  labelNames: string[];
}): boolean {
  if (isOwnOrAutomatedSender(args.fromEmail)) return false;
  if (args.subject && CANDIDATURE_SUBJECT_RE.test(args.subject)) return true;
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
