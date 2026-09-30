import {
  compactNameKey,
  emailLocalPart,
  normalizeEmail,
  normalizeNameKey,
  personCompactKey,
  personNameKey,
} from "@/lib/crm/name-key";
import { trigramSimilarity } from "@/lib/crm/similarity";
import { formatPersonName } from "@/lib/format";

/**
 * Rapprochement d'un nom extrait (LLM, import, saisie) avec un record
 * déjà en base. C'est le garde-fou anti-doublon partagé par tous les
 * pipelines : extraction meeting, extraction email, acceptation de
 * proposition, rattachement LinkedIn.
 *
 * Deux étages, dans cet ordre :
 *
 *  1. **Égalité de clé** (`lib/crm/name-key.ts`) — accent, casse,
 *     ponctuation, forme juridique et mots vides neutralisés. Une égalité
 *     ici vaut identité : confiance 1. C'est ce qui rattrape les doublons
 *     que le trigram brut notait sous le seuil ("MKP Doctor" ≡ "mkpdoctor"
 *     = 0.615, "Bobl" ≡ "Bobl SAS" = 0.556).
 *  2. **Trigram sur clés normalisées** (`lib/crm/similarity.ts`) — pour
 *     les écarts orthographiques réels ("a paris consulting" ↔ "Aparisi
 *     Consulting").
 *
 * Les seuils sont ceux calibrés du temps où la comparaison se faisait en
 * SQL sur le texte brut ; la normalisation les rend simplement plus
 * sensibles, dans le bon sens.
 */
export type Match = { id: string; name: string; confidence: number } | null;

/**
 * Seuils de similarité par famille. Plus le nom est court et structuré
 * (nom de société), plus on peut être exigeant ; un titre de tâche
 * reformulé par le LLM demande d'être plus permissif.
 */
export const MATCH_THRESHOLD = {
  entity: 0.6,
  contact: 0.55,
  project: 0.55,
  user: 0.35,
  task: 0.5,
} as const;

/**
 * Rapprochement **certain** : email identique, ou nom strictement
 * équivalent après normalisation (confiance 1). Les pipelines d'extraction
 * ne proposent alors rien du tout — il n'y a aucune décision humaine à
 * prendre, et c'est précisément ce que l'utilisateur voyait comme un
 * doublon dans la file.
 *
 * Les rapprochements approximatifs (seuil → 0.99) restent proposés avec
 * leur `matchedId` : ils atterrissent dans « Déjà en base », où une
 * mauvaise fiche peut être corrigée.
 */
export function isCertainMatch(match: Match): boolean {
  return match !== null && match.confidence >= 1;
}

type Named = { id: string; name: string | null };

/**
 * Élit le meilleur candidat pour un nom donné. Pure — testable sans base.
 */
export function pickBestMatch(candidates: Named[], needle: string, threshold: number): Match {
  const needleKey = normalizeNameKey(needle);
  if (!needleKey) return null;
  const needleCompact = compactNameKey(needle);

  let best: Match = null;
  for (const c of candidates) {
    if (!c.name) continue;
    if (compactNameKey(c.name) === needleCompact) {
      return { id: c.id, name: c.name, confidence: 1 };
    }
    const score = trigramSimilarity(normalizeNameKey(c.name), needleKey);
    if (score > threshold && (best === null || score > best.confidence)) {
      best = { id: c.id, name: c.name, confidence: score };
    }
  }
  return best;
}

type ContactCandidate = { id: string; firstName: string; lastName: string; email: string | null };

export type ContactIdentity = {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  email?: string | null;
};

/**
 * Élit le meilleur contact pour une identité extraite. L'email primme sur
 * le nom : c'est la seule preuve d'identité forte dans un mail.
 *
 * Confiances : 1 pour un email identique ou un nom de clé identique, 0.95
 * pour une partie locale d'email identique (même personne, boîte changée),
 * puis le score trigram. Un nom identique avec des emails qui se
 * contredisent reste un match mais descend à 0.9 — l'UI le montre comme
 * « déjà en base » et l'humain peut le dissocier.
 */
export function pickBestContact(
  candidates: ContactCandidate[],
  identity: ContactIdentity,
  threshold: number = MATCH_THRESHOLD.contact,
): Match {
  const email = normalizeEmail(identity.email);
  const local = emailLocalPart(email);
  const nameKey = personNameKey(identity.firstName, identity.lastName);
  const compact = personCompactKey(identity.firstName, identity.lastName);

  const label = (c: ContactCandidate) => formatPersonName(c.firstName, c.lastName);

  if (email) {
    const exact = candidates.find((c) => normalizeEmail(c.email) === email);
    if (exact) return { id: exact.id, name: label(exact), confidence: 1 };
  }

  if (compact) {
    const sameName = candidates.filter(
      (c) => personCompactKey(c.firstName, c.lastName) === compact,
    );
    const first = sameName[0];
    if (first) {
      // Emails renseignés des deux côtés et différents → même nom, preuve
      // d'identité affaiblie : on lie quand même (c'est presque toujours
      // un changement d'adresse) mais on le signale par la confiance.
      const contradicted = email !== "" && sameName.every((c) => c.email && c.email !== email);
      return { id: first.id, name: label(first), confidence: contradicted ? 0.9 : 1 };
    }
  }

  if (local) {
    const sameLocal = candidates.find((c) => emailLocalPart(c.email) === local);
    if (sameLocal) return { id: sameLocal.id, name: label(sameLocal), confidence: 0.95 };
  }

  if (!nameKey) return null;

  // Prénom seul (signature « Frédéric », « À bientôt, Amine ») : le
  // trigram passe juste sous le seuil face à un nom complet. On accepte le
  // rapprochement quand le prénom ne désigne qu'une seule personne en base
  // — s'il y a homonymie, on préfère ne rien lier.
  if (!nameKey.includes(" ")) {
    const sameFirstName = candidates.filter((c) => normalizeNameKey(c.firstName) === nameKey);
    const only = sameFirstName.length === 1 ? sameFirstName[0] : null;
    if (only) return { id: only.id, name: label(only), confidence: 0.8 };
  }

  return pickBestMatch(
    candidates.map((c) => ({ id: c.id, name: formatPersonName(c.firstName, c.lastName, "") })),
    nameKey,
    threshold,
  );
}
