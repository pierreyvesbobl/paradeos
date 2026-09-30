import { createHash } from "node:crypto";
import { stripDiacritics } from "@/lib/crm/name-key";

/**
 * Les deux clés qui servent à reconnaître deux fiches pour une même
 * réunion. Pures et testables, à part de la requête qui les consomme
 * (cf. `dedupe.ts`) — même découpage que `proposal-keys` / `proposal-dedupe`.
 */

/**
 * Seuil de matière en dessous duquel on ne calcule pas d'empreinte.
 * Aligné sur le minimum d'ingestion : deux transcripts quasi vides se
 * ressemblent trop pour qu'une égalité prouve quoi que ce soit.
 */
const MIN_CHARS_FOR_FINGERPRINT = 50;

/**
 * Empreinte du transcript, insensible à la mise en forme des blancs
 * (un export Drive et un export Gmail du même texte ne replient pas les
 * retours à la ligne pareil). Volontairement **sensible à la casse** :
 * une copie est identique, et le pendant SQL du backfill
 * (`0072_meeting_dedupe.sql`) doit rester calculable à l'identique — ce
 * qu'un `lower()` dépendant de la locale Postgres ne garantit pas.
 */
export function transcriptFingerprint(transcript: string | null | undefined): string | null {
  if (!transcript) return null;
  const normalized = transcript.replace(/[ \t\n\r\f\v]+/g, " ").trim();
  if (normalized.length < MIN_CHARS_FOR_FINGERPRINT) return null;
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

/**
 * Clé de comparaison d'un titre de réunion : sans accent, minuscule,
 * ponctuation réduite à des espaces.
 *
 * On n'utilise pas `normalizeNameKey` : il retire les formes juridiques
 * et les mots vides, ce qui a du sens pour une raison sociale et pas
 * pour un titre — « Point France » et « Point » y deviendraient la même
 * réunion.
 */
export function meetingTitleKey(title: string | null | undefined): string {
  return stripDiacritics(title ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
