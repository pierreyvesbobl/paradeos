/**
 * Clés de comparaison de noms — le socle du dédoublonnage.
 *
 * Pourquoi : `similarity()` (pg_trgm) travaille sur le texte brut. Il est
 * accent-sensible et il pénalise les différences de ponctuation et
 * d'espaces, si bien que des doublons évidents passaient sous le seuil :
 *
 *   similarity('MKP Doctor', 'mkpdoctor')   = 0.615  (seuil entité 0.6 → limite)
 *   similarity('Bobl', 'Bobl SAS')          = 0.556  → raté
 *   similarity('Lacoëntre', 'Lacoentre')    → pénalisé par l'accent
 *
 * On ramène donc les deux côtés à une **clé** avant de comparer :
 *  - `normalizeNameKey` : sans accent, minuscule, sans ponctuation, forme
 *    juridique retirée, espaces normalisés. Sert de base au trigram.
 *  - `compactNameKey`   : la même, espaces compris retirés. L'égalité sur
 *    cette clé est une preuve de doublon suffisante pour lier sans
 *    demander à l'humain ("MKP Doctor" ≡ "mkpdoctor" ≡ "M.K.P. DOCTOR").
 *
 * Ces fonctions sont pures et dupliquées côté SQL par les helpers de
 * `lib/crm/name-key-sql.ts` — les deux implémentations doivent rester
 * alignées (cf. tests).
 */

/**
 * Formes juridiques et suffixes de raison sociale. Retirés avant
 * comparaison : "Bobl" et "Bobl SAS" désignent la même société, et le
 * suffixe est justement ce que le LLM écrit ou omet au hasard selon la
 * signature du mail.
 */
const LEGAL_FORMS = new Set([
  "sas",
  "sasu",
  "sarl",
  "eurl",
  "sa",
  "sci",
  "scp",
  "scop",
  "snc",
  "selarl",
  "sel",
  "gie",
  "ei",
  "eirl",
  "asso",
  "association",
  "auto",
  "micro",
  "inc",
  "llc",
  "ltd",
  "limited",
  "plc",
  "gmbh",
  "ag",
  "bv",
  "nv",
  "srl",
  "spa",
  "oy",
  "ab",
  "corp",
  "corporation",
  "co",
  "company",
  "group",
  "groupe",
  "holding",
  "france",
]);

/** Mots vides ignorés dans une raison sociale. */
const STOP_WORDS = new Set(["le", "la", "les", "l", "de", "du", "des", "d", "et", "the", "and"]);

/** Retire les diacritiques (NFD + suppression des marques combinantes). */
export function stripDiacritics(value: string): string {
  return value.normalize("NFD").replace(/\p{Mn}/gu, "");
}

/**
 * Clé de comparaison d'un nom : minuscule, sans accent, sans ponctuation,
 * sans forme juridique ni mot vide, espaces normalisés.
 *
 * Retourne "" si rien de significatif ne reste — l'appelant doit traiter
 * la chaîne vide comme "pas de clé" et ne jamais la comparer.
 */
export function normalizeNameKey(value: string | null | undefined): string {
  if (!value) return "";
  const base = stripDiacritics(value)
    .toLowerCase()
    // & → et : "Dupont & Fils" ≡ "Dupont et Fils".
    .replace(/&/g, " et ")
    // Tout ce qui n'est ni lettre ni chiffre devient un espace : points des
    // acronymes, tirets, apostrophes, guillemets…
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (!base) return "";
  const words = mergeAcronymRuns(base.split(" ").filter((w) => w.length > 0));
  const kept = words.filter((w) => !LEGAL_FORMS.has(w) && !STOP_WORDS.has(w));
  // Garde-fou : une société qui ne s'appelle QUE par un mot filtré
  // ("Groupe", "Le Comptoir"…) ne doit pas se réduire à "".
  const useful = kept.length > 0 ? kept : words;
  return useful.join(" ");
}

/**
 * Recolle les suites de lettres isolées : "M.K.P. Doctor" est découpé en
 * `m k p doctor` par la suppression de la ponctuation, alors que la base
 * contient "MKP Doctor". On refusionne donc les runs de tokens d'un seul
 * caractère — un acronyme pointé redevient un mot.
 */
function mergeAcronymRuns(words: string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  const flush = () => {
    if (run.length > 1) out.push(run.join(""));
    else if (run.length === 1 && run[0]) out.push(run[0]);
    run = [];
  };
  for (const w of words) {
    if (w.length === 1) run.push(w);
    else {
      flush();
      out.push(w);
    }
  }
  flush();
  return out;
}

/**
 * Clé compacte : `normalizeNameKey` sans les espaces. L'égalité de deux
 * clés compactes vaut identité — c'est ce qui rattrape les noms collés
 * ("mkpdoctor" ≡ "MKP Doctor") que le trigram note sous le seuil.
 */
export function compactNameKey(value: string | null | undefined): string {
  return normalizeNameKey(value).replace(/ /g, "");
}

/**
 * Clé d'une personne. Prénom et nom sont concaténés puis normalisés, donc
 * l'inversion "Garcia-Brotons Raphaël" / "Raphael Garcia Brotons" produit
 * des clés différentes : c'est le trigram (insensible à l'ordre des mots)
 * qui rattrape ce cas, pas la clé compacte.
 */
export function personNameKey(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return normalizeNameKey([firstName ?? "", lastName ?? ""].join(" "));
}

/** Variante compacte de `personNameKey`. */
export function personCompactKey(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string {
  return compactNameKey([firstName ?? "", lastName ?? ""].join(" "));
}

/** Email normalisé pour comparaison exacte (casse + espaces). */
export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Partie locale d'un email. Sert de signal faible d'identité quand deux
 * adresses diffèrent par le domaine (changement de boîte) :
 * `julien.lacoentre@nextase.fr` ↔ `julien.lacoentre@cephalopode.com`.
 */
export function emailLocalPart(value: string | null | undefined): string {
  const email = normalizeEmail(value);
  const at = email.indexOf("@");
  if (at <= 0) return "";
  return email.slice(0, at).replace(/\+.*$/, "");
}
