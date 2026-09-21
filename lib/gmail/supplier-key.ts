/**
 * Clé de rapprochement des fournisseurs. Module pur (pas de
 * `server-only`) : utilisé par le classement Drive et testable.
 *
 * Objectif : "Eleven Labs", "ElevenLabs Inc.", "ELEVENLABS" doivent
 * tomber sur la même clé, sinon on crée un dossier Drive par variante
 * de nom retournée par le LLM.
 */

/**
 * Formes juridiques retirées en fin (ou en début) de nom. Triées par
 * longueur décroissante pour que "pteltd" parte avant "ltd".
 *
 * On ne met ici que des formes juridiques sans ambiguïté : pas de "co"
 * ni de "as" (couperaient "Cisco", "Atlas"). `MIN_KEY_LEN` protège en
 * plus les noms courts.
 */
const LEGAL_FORMS = [
  "incorporated",
  "corporation",
  "limited",
  "selarl",
  "pteltd",
  "ptyltd",
  "sarlu",
  "gmbh",
  "sasu",
  "sarl",
  "scic",
  "scop",
  "eurl",
  "corp",
  "srl",
  "spa",
  "llc",
  "ltd",
  "inc",
  "plc",
  "pte",
  "pty",
  "sas",
  "sci",
  "snc",
  "sa",
  "bv",
].sort((a, b) => b.length - a.length);

/** En dessous, on ne rogne plus : le reste ne serait plus discriminant. */
const MIN_KEY_LEN = 3;

/**
 * Normalisation "match fournisseur" : accents supprimés, alnum only,
 * lowercased, formes juridiques retirées (FR et internationales).
 *
 *   "Orange", "Orange SA", "ORANGE"          → "orange"
 *   "Eleven Labs", "ElevenLabs Inc."         → "elevenlabs"
 *   "Supabase Pte Ltd"                       → "supabase"
 *
 * Le retrait est itératif : "Supabase Pte Ltd" perd "ltd" puis "pte".
 */
export function normalizeSupplierKey(name: string): string {
  let key = name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

  let stripped = true;
  while (stripped) {
    stripped = false;
    for (const form of LEGAL_FORMS) {
      if (key.length - form.length < MIN_KEY_LEN) continue;
      if (key.endsWith(form)) {
        key = key.slice(0, -form.length);
        stripped = true;
        break;
      }
      if (key.startsWith(form)) {
        key = key.slice(form.length);
        stripped = true;
        break;
      }
    }
  }
  return key;
}
