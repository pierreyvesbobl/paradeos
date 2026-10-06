/**
 * L'INSEE stocke les libellés en capitales sans accents
 * ("4 BOULEVARD DE MONS", "VILLENEUVE-D'ASCQ"). Tel quel sur une facture
 * ou dans une fiche, ça crie. On recapitalise à la française : particules
 * en minuscules, sigles d'adresse préservés, séparateurs (espace, tiret,
 * apostrophe) conservés à l'identique.
 *
 * Les accents manquants ne sont pas devinés : "SAINT-CLEMENT" ressort
 * "Saint-Clement". Mieux vaut une lettre manquante qu'une invention.
 */

/** Minuscules sauf en tête de libellé. */
const PARTICLES = new Set([
  "a",
  "au",
  "aux",
  "d",
  "de",
  "des",
  "du",
  "en",
  "es",
  "et",
  "l",
  "la",
  "le",
  "les",
  "sous",
  "sur",
]);

/** Sigles d'adresse qui restent en capitales. */
const ACRONYMS = new Set([
  "BP",
  "CCI",
  "CS",
  "CEDEX",
  "HLM",
  "RN",
  "TSA",
  "ZA",
  "ZAC",
  "ZAE",
  "ZI",
  "ZUP",
]);

export function toFrenchTitleCase(input: string): string {
  let first = true;
  // On ne capture que les suites de lettres/chiffres : tout le reste
  // (espaces, tirets, apostrophes, parenthèses, virgules) est un séparateur
  // rendu à l'identique. Sinon "(BOBL)" ressortirait "(bobl)".
  return input.replace(/[\p{L}\p{N}]+/gu, (word) => {
    const wasFirst = first;
    // Un token purement numérique ("4", "1945") ne consomme pas la
    // position de tête : "4 BOULEVARD" doit donner "4 Boulevard".
    if (/\p{L}/u.test(word)) first = false;

    const upper = word.toUpperCase();
    if (ACRONYMS.has(upper)) return upper;

    const lower = word.toLowerCase();
    if (!wasFirst && PARTICLES.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  });
}
