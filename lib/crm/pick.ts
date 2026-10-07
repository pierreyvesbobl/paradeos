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
  /**
   * Projet comparé **à l'intérieur d'un même client**, nom du client
   * retiré des deux côtés (cf. `pickBestProject`).
   *
   * Bien plus bas que `project` (0.55), et ce n'est pas un relâchement :
   * c'est le même signal mesuré sans son bruit. Tant que le nom du client
   * restait dans la comparaison, « Avenir Focus - Mirror Lab » et « Avenir
   * Focus - Echolab » — deux projets distincts — scoraient 0.67, autant
   * que « Automatisation devis et facturation ETC » et « Automatisation
   * process - ETC », qui sont le même. Les deux familles étaient
   * inséparables, et le seuil haut tranchait en faveur du « nouveau
   * projet » à chaque fois.
   *
   * Sur le reste, une fois le client retiré, les deux familles se
   * séparent : les vrais doublons tombent à 0.38 et au-dessus, les projets
   * réellement distincts à 0.36 et en dessous (mesuré sur les 15 paires de
   * la base, cf. `pick.test.ts`).
   */
  projectWithinEntity: 0.35,
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

/**
 * Mots qui désignent un projet sans le nommer. Un modèle qui n'a pas trouvé
 * le nom du projet dans un transcript écrit « Projet en cours » ou « Suivi
 * de projet » — ce n'est pas un nom, c'est un aveu, et il ne doit jamais
 * créer de fiche.
 */
const GENERIC_PROJECT_WORDS = new Set([
  "projet",
  "projets",
  "project",
  "dossier",
  "mission",
  "chantier",
  "en",
  "cours",
  "suivi",
  "point",
  "divers",
  "general",
  "generale",
  "nouveau",
  "nouvelle",
  "autre",
  "autres",
  "a",
  "definir",
  "preciser",
  "venir",
  "tbd",
  "wip",
  "na",
  "inconnu",
  "sans",
  "nom",
  "titre",
  "client",
]);

/**
 * Vrai si le nom proposé ne contient aucun mot distinctif : « Projet en
 * cours », « Suivi de projet », « À définir ». L'appelant ne doit pas en
 * faire un projet.
 *
 * `entityName` est retiré avant l'examen, sans quoi « Flow Boreal - Projet
 * en cours » passerait pour un nom : le client ne distingue pas un projet
 * de ses voisins, et c'est précisément ce que le modèle écrit quand il n'a
 * trouvé que le client.
 */
export function isGenericProjectName(
  name: string | null | undefined,
  entityName: string | null = null,
): boolean {
  if (!name) return true;
  const tokens = distinctiveTokens(name, entityName);
  const entityTokens = new Set(
    entityName ? normalizeNameKey(entityName).split(" ").filter(Boolean) : [],
  );
  if (tokens.length === 0) return true;
  // `distinctiveTokens` rend le nom complet quand tout serait retiré : un
  // projet qui s'appelle comme son client porte bien un nom.
  if (tokens.every((t) => entityTokens.has(t))) return false;
  return tokens.every((t) => GENERIC_PROJECT_WORDS.has(t));
}

/**
 * Mots du nom, le nom du client retiré.
 *
 * Scopé à un client, ses propres mots ne distinguent plus rien : ils sont
 * dans tous ses projets. Les garder, c'est noter « Avenir Focus - Echolab »
 * et « Avenir Focus - Mirror Lab » comme proches à cause de « Avenir
 * Focus ». On retombe sur le nom complet si tout disparaît — un projet qui
 * s'appelle exactement comme son client.
 */
function distinctiveTokens(name: string, entityName: string | null): string[] {
  const entityTokens = new Set(
    entityName ? normalizeNameKey(entityName).split(" ").filter(Boolean) : [],
  );
  const tokens = normalizeNameKey(name).split(" ").filter(Boolean);
  const kept = tokens.filter((t) => !entityTokens.has(t));
  return kept.length > 0 ? kept : tokens;
}

/**
 * Élit le projet existant que désigne un nom proposé, à l'intérieur d'un
 * même client.
 *
 * Deux verdicts seulement, et surtout pas de recouvrement de mots dans le
 * score : c'est lui qui produisait les faux positifs, « Pilotes TV clips
 * IA » et « Zapping IA » partageant « IA » comme seul mot commun.
 *
 *  1. **Certain** (confiance 1, aucune proposition n'est créée) : les mots
 *     distinctifs de l'un sont tous dans l'autre — « APKI - Refonte charte
 *     + Landing » est « Flow Boreal - APKI - Refonte charte + Landing »
 *     écrit plus court. On exige deux mots au moins : un seul mot commun ne
 *     prouve rien, et « Lab » ⊂ « Mirror Lab » serait un faux doublon.
 *     Même verdict pour un trigram très haut, qui est une faute de frappe.
 *  2. **Candidat** (confiance = le score) : au-dessus du seuil, la
 *     proposition reste mais porte le projet existant, donc /inbox la
 *     montre comme « déjà en base » au lieu d'un projet neuf.
 */
export function pickBestProject(
  candidates: Named[],
  needle: string,
  entityName: string | null,
  threshold: number = MATCH_THRESHOLD.projectWithinEntity,
): Match {
  const needleKey = normalizeNameKey(needle);
  if (!needleKey) return null;
  const needleCompact = compactNameKey(needle);
  const needleTokens = distinctiveTokens(needle, entityName);

  let best: Match = null;
  for (const c of candidates) {
    if (!c.name) continue;
    if (compactNameKey(c.name) === needleCompact) {
      return { id: c.id, name: c.name, confidence: 1 };
    }

    const candTokens = distinctiveTokens(c.name, entityName);
    const needleSet = new Set(needleTokens);
    const candSet = new Set(candTokens);
    const needleInCand = needleTokens.every((t) => candSet.has(t));
    const candInNeedle = candTokens.every((t) => needleSet.has(t));
    const shorter = Math.min(needleTokens.length, candTokens.length);
    if (shorter >= 2 && (needleInCand || candInNeedle)) {
      return { id: c.id, name: c.name, confidence: 1 };
    }

    const score = trigramSimilarity(needleTokens.join(" "), candTokens.join(" "));
    if (score >= CERTAIN_PROJECT_TRIGRAM) {
      return { id: c.id, name: c.name, confidence: 1 };
    }
    if (score > threshold && (best === null || score > best.confidence)) {
      best = { id: c.id, name: c.name, confidence: score };
    }
  }
  return best;
}

/**
 * Au-delà, deux noms de projet d'un même client ne diffèrent plus que par
 * l'orthographe (« Ecolab » / « Echolab » valent 0.50 — une lettre sur un
 * mot court coûte cher en trigram, d'où un seuil qui peut sembler bas).
 * Le plus haut score observé entre deux projets réellement distincts est
 * 0.36, on garde donc une marge large.
 */
const CERTAIN_PROJECT_TRIGRAM = 0.7;

type ContactCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  /** Adresse principale (`contacts.email`). */
  email: string | null;
  /** Adresses secondaires (`contact_emails`), facultatives. */
  emails?: string[];
};

/** Toutes les adresses d'un candidat, normalisées, sans vide ni doublon. */
function candidateEmails(c: ContactCandidate): string[] {
  const out = new Set<string>();
  for (const raw of [c.email, ...(c.emails ?? [])]) {
    const email = normalizeEmail(raw);
    if (email) out.add(email);
  }
  return [...out];
}

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
 *
 * Un candidat porte toutes ses adresses (principale + secondaires) : une
 * personne qui écrit depuis sa boîte perso est reconnue au même titre.
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
    const exact = candidates.find((c) => candidateEmails(c).includes(email));
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
      const contradicted =
        email !== "" &&
        sameName.every((c) => {
          const known = candidateEmails(c);
          return known.length > 0 && !known.includes(email);
        });
      return { id: first.id, name: label(first), confidence: contradicted ? 0.9 : 1 };
    }
  }

  if (local) {
    const sameLocal = candidates.find((c) =>
      candidateEmails(c).some((e) => emailLocalPart(e) === local),
    );
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
